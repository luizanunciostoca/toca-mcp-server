import { createPublicKey, verify as verifySignature } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { TextDecoder } from 'node:util';
import type { AppGatewayAuthorize, AppGatewayPrincipal } from './http-boundary.js';

const DEFAULT_MAX_TOKEN_BYTES = 16 * 1024;
const ABSOLUTE_MAX_TOKEN_BYTES = 64 * 1024;
const DEFAULT_JWKS_TIMEOUT_MS = 5_000;
const MAX_JWKS_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_JWKS_BYTES = 256 * 1024;
const ABSOLUTE_MAX_JWKS_BYTES = 1024 * 1024;
const DEFAULT_JWKS_CACHE_TTL_MS = 5 * 60_000;
const MAX_JWKS_CACHE_TTL_MS = 60 * 60_000;
const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_JWKS_KEYS = 100;
const MAX_KID_LENGTH = 256;
const MAX_SUBJECT_LENGTH = 512;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export type OidcVerificationErrorCode =
  | 'OIDC_CONFIGURATION_INVALID'
  | 'OIDC_BEARER_MISSING'
  | 'OIDC_TOKEN_TOO_LARGE'
  | 'OIDC_TOKEN_MALFORMED'
  | 'OIDC_ALGORITHM_REJECTED'
  | 'OIDC_KID_REQUIRED'
  | 'OIDC_HEADER_UNSUPPORTED'
  | 'OIDC_JWKS_FETCH_FAILED'
  | 'OIDC_JWKS_TOO_LARGE'
  | 'OIDC_JWKS_INVALID'
  | 'OIDC_KEY_NOT_FOUND'
  | 'OIDC_KEY_INVALID'
  | 'OIDC_SIGNATURE_INVALID'
  | 'OIDC_ISSUER_MISMATCH'
  | 'OIDC_AUDIENCE_MISMATCH'
  | 'OIDC_TOKEN_EXPIRED'
  | 'OIDC_TOKEN_NOT_ACTIVE'
  | 'OIDC_SUBJECT_REQUIRED'
  | 'OIDC_CLAIMS_INVALID'
  | 'OIDC_PRINCIPAL_REJECTED'
  | 'OIDC_PRINCIPAL_MAPPING_FAILED';

export class OidcVerificationError extends Error {
  readonly code: OidcVerificationErrorCode;

  constructor(code: OidcVerificationErrorCode) {
    super(code);
    this.name = 'OidcVerificationError';
    this.code = code;
  }
}

export interface VerifiedOidcIdentity {
  readonly subject: string;
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly expiresAt: number;
}

export interface OidcJwksFetchOptions {
  readonly timeoutMs: number;
  readonly maximumBytes: number;
}

export type OidcJwksTransport = (jwksUri: string, options: OidcJwksFetchOptions) => Promise<string>;

export type OidcPrincipalMapper = (
  identity: VerifiedOidcIdentity,
) => Promise<AppGatewayPrincipal | undefined> | AppGatewayPrincipal | undefined;

export interface OidcBearerVerifierOptions {
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly jwksUri: string;
  readonly transport?: OidcJwksTransport;
  readonly nowEpochSeconds?: () => number;
  readonly clockSkewSeconds?: number;
  readonly maximumTokenBytes?: number;
  readonly jwksTimeoutMs?: number;
  readonly maximumJwksBytes?: number;
  readonly jwksCacheTtlMs?: number;
}

export interface OidcAppGatewayAuthorizeOptions extends OidcBearerVerifierOptions {
  readonly mapPrincipal: OidcPrincipalMapper;
  readonly onFailure?: (code: OidcVerificationErrorCode) => void;
}

export interface OidcBearerVerifier {
  verify(token: string): Promise<VerifiedOidcIdentity>;
}

interface NormalizedOptions {
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly jwksUri: string;
  readonly transport: OidcJwksTransport;
  readonly nowEpochSeconds: () => number;
  readonly clockSkewSeconds: number;
  readonly maximumTokenBytes: number;
  readonly jwksTimeoutMs: number;
  readonly maximumJwksBytes: number;
  readonly jwksCacheTtlMs: number;
}

interface ParsedJwt {
  readonly signingInput: string;
  readonly signature: Buffer;
  readonly header: Readonly<Record<string, unknown>>;
  readonly claims: Readonly<Record<string, unknown>>;
}

interface JwksKeyRecord extends Record<string, unknown> {
  readonly kid?: unknown;
  readonly kty?: unknown;
  readonly alg?: unknown;
  readonly use?: unknown;
  readonly key_ops?: unknown;
  readonly n?: unknown;
  readonly e?: unknown;
  readonly d?: unknown;
}

interface CachedJwks {
  readonly keys: readonly JwksKeyRecord[];
  readonly expiresAtMs: number;
}

class OidcBearerVerifierImpl implements OidcBearerVerifier {
  private cache: CachedJwks | undefined;

  constructor(private readonly options: NormalizedOptions) {}

  async verify(token: string): Promise<VerifiedOidcIdentity> {
    const parsed = parseJwt(token, this.options.maximumTokenBytes);
    const kid = validateHeader(parsed.header);
    const key = await this.resolvePublicKey(kid);

    const signatureValid = verifySignature(
      'RSA-SHA256',
      Buffer.from(parsed.signingInput, 'ascii'),
      key,
      parsed.signature,
    );
    if (!signatureValid) throw new OidcVerificationError('OIDC_SIGNATURE_INVALID');

    return validateClaims(parsed.claims, this.options);
  }

  private async resolvePublicKey(kid: string): Promise<ReturnType<typeof createPublicKey>> {
    const first = await this.loadJwks(false);
    let matches = matchingKeys(first.keys, kid);

    if (matches.length === 0 && first.fromCache) {
      const refreshed = await this.loadJwks(true);
      matches = matchingKeys(refreshed.keys, kid);
    }

    if (matches.length === 0) throw new OidcVerificationError('OIDC_KEY_NOT_FOUND');
    if (matches.length !== 1) throw new OidcVerificationError('OIDC_KEY_INVALID');

    const jwk = matches[0];
    if (!jwk) throw new OidcVerificationError('OIDC_KEY_NOT_FOUND');
    validateRsaVerificationJwk(jwk);

    try {
      return createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
    } catch {
      throw new OidcVerificationError('OIDC_KEY_INVALID');
    }
  }

  private async loadJwks(
    forceRefresh: boolean,
  ): Promise<{ readonly keys: readonly JwksKeyRecord[]; readonly fromCache: boolean }> {
    const nowMs = this.options.nowEpochSeconds() * 1000;
    if (!forceRefresh && this.cache && this.cache.expiresAtMs > nowMs) {
      return { keys: this.cache.keys, fromCache: true };
    }

    let body: string;
    try {
      body = await this.options.transport(this.options.jwksUri, {
        timeoutMs: this.options.jwksTimeoutMs,
        maximumBytes: this.options.maximumJwksBytes,
      });
    } catch (error) {
      if (error instanceof OidcVerificationError) throw error;
      throw new OidcVerificationError('OIDC_JWKS_FETCH_FAILED');
    }

    if (Buffer.byteLength(body, 'utf8') > this.options.maximumJwksBytes) {
      throw new OidcVerificationError('OIDC_JWKS_TOO_LARGE');
    }

    const keys = parseJwks(body);
    this.cache = {
      keys,
      expiresAtMs: nowMs + this.options.jwksCacheTtlMs,
    };
    return { keys, fromCache: false };
  }
}

export function createOidcBearerVerifier(options: OidcBearerVerifierOptions): OidcBearerVerifier {
  return new OidcBearerVerifierImpl(normalizeOptions(options));
}

export function createOidcAppGatewayAuthorize(
  options: OidcAppGatewayAuthorizeOptions,
): AppGatewayAuthorize {
  const verifier = createOidcBearerVerifier(options);

  return async (request: IncomingMessage): Promise<AppGatewayPrincipal | undefined> => {
    const token = bearerTokenFromRequest(request);
    if (!token) {
      options.onFailure?.('OIDC_BEARER_MISSING');
      return undefined;
    }

    let identity: VerifiedOidcIdentity;
    try {
      identity = await verifier.verify(token);
    } catch (error) {
      const code = safeVerificationCode(error);
      options.onFailure?.(code);
      return undefined;
    }

    try {
      const principal = await options.mapPrincipal(identity);
      if (!principal?.subject.trim()) {
        options.onFailure?.('OIDC_PRINCIPAL_REJECTED');
        return undefined;
      }
      return principal;
    } catch {
      options.onFailure?.('OIDC_PRINCIPAL_MAPPING_FAILED');
      return undefined;
    }
  };
}

export const defaultOidcJwksTransport: OidcJwksTransport = async (
  jwksUri,
  options,
): Promise<string> => {
  validateHttpsJwksUri(jwksUri);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(jwksUri, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new OidcVerificationError('OIDC_JWKS_FETCH_FAILED');
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null) {
      const declaredLength = Number(contentLength);
      if (!Number.isFinite(declaredLength) || declaredLength < 0) {
        throw new OidcVerificationError('OIDC_JWKS_FETCH_FAILED');
      }
      if (declaredLength > options.maximumBytes) {
        throw new OidcVerificationError('OIDC_JWKS_TOO_LARGE');
      }
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > options.maximumBytes) {
        controller.abort();
        throw new OidcVerificationError('OIDC_JWKS_TOO_LARGE');
      }
      chunks.push(Buffer.from(result.value));
    }
    return Buffer.concat(chunks, totalBytes).toString('utf8');
  } catch (error) {
    if (error instanceof OidcVerificationError) throw error;
    throw new OidcVerificationError('OIDC_JWKS_FETCH_FAILED');
  } finally {
    clearTimeout(timer);
  }
};

function normalizeOptions(options: OidcBearerVerifierOptions): NormalizedOptions {
  const issuer = options.issuer;
  if (!issuer || issuer.trim() !== issuer) configurationError();

  const audiences = normalizeAudienceConfiguration(options.audience);
  const jwksUri = validateHttpsJwksUri(options.jwksUri);
  const clockSkewSeconds = boundedInteger(
    options.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS,
    0,
    MAX_CLOCK_SKEW_SECONDS,
  );
  const maximumTokenBytes = boundedInteger(
    options.maximumTokenBytes ?? DEFAULT_MAX_TOKEN_BYTES,
    1,
    ABSOLUTE_MAX_TOKEN_BYTES,
  );
  const jwksTimeoutMs = boundedInteger(
    options.jwksTimeoutMs ?? DEFAULT_JWKS_TIMEOUT_MS,
    1,
    MAX_JWKS_TIMEOUT_MS,
  );
  const maximumJwksBytes = boundedInteger(
    options.maximumJwksBytes ?? DEFAULT_MAX_JWKS_BYTES,
    1,
    ABSOLUTE_MAX_JWKS_BYTES,
  );
  const jwksCacheTtlMs = boundedInteger(
    options.jwksCacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS,
    0,
    MAX_JWKS_CACHE_TTL_MS,
  );

  return {
    issuer,
    audiences,
    jwksUri,
    transport: options.transport ?? defaultOidcJwksTransport,
    nowEpochSeconds: options.nowEpochSeconds ?? (() => Date.now() / 1000),
    clockSkewSeconds,
    maximumTokenBytes,
    jwksTimeoutMs,
    maximumJwksBytes,
    jwksCacheTtlMs,
  };
}

function normalizeAudienceConfiguration(value: string | readonly string[]): readonly string[] {
  const values = typeof value === 'string' ? [value] : [...value];
  if (values.length === 0 || values.some((item) => !item || item.trim() !== item)) {
    configurationError();
  }
  return [...new Set(values)];
}

function validateHttpsJwksUri(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) {
      configurationError();
    }
    return url.toString();
  } catch (error) {
    if (error instanceof OidcVerificationError) throw error;
    configurationError();
  }
}

function configurationError(): never {
  throw new OidcVerificationError('OIDC_CONFIGURATION_INVALID');
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) configurationError();
  return value;
}

function bearerTokenFromRequest(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return match?.[1];
}

function parseJwt(token: string, maximumTokenBytes: number): ParsedJwt {
  if (!token || Buffer.byteLength(token, 'utf8') > maximumTokenBytes) {
    if (token) throw new OidcVerificationError('OIDC_TOKEN_TOO_LARGE');
    throw new OidcVerificationError('OIDC_TOKEN_MALFORMED');
  }

  const segments = token.split('.');
  if (segments.length !== 3) throw new OidcVerificationError('OIDC_TOKEN_MALFORMED');
  const headerSegment = segments[0];
  const claimsSegment = segments[1];
  const signatureSegment = segments[2];
  if (!headerSegment || !claimsSegment || !signatureSegment) {
    throw new OidcVerificationError('OIDC_TOKEN_MALFORMED');
  }

  const header = decodeJsonObject(headerSegment);
  const claims = decodeJsonObject(claimsSegment);
  const signature = decodeBase64Url(signatureSegment);
  if (signature.length === 0) throw new OidcVerificationError('OIDC_TOKEN_MALFORMED');

  return {
    signingInput: `${headerSegment}.${claimsSegment}`,
    signature,
    header,
    claims,
  };
}

function decodeJsonObject(segment: string): Readonly<Record<string, unknown>> {
  const bytes = decodeBase64Url(segment);
  try {
    const decoded = UTF8_DECODER.decode(bytes);
    const value = JSON.parse(decoded) as unknown;
    if (!isRecord(value)) throw new OidcVerificationError('OIDC_TOKEN_MALFORMED');
    return value;
  } catch (error) {
    if (error instanceof OidcVerificationError) throw error;
    throw new OidcVerificationError('OIDC_TOKEN_MALFORMED');
  }
}

function decodeBase64Url(segment: string): Buffer {
  if (!BASE64URL_SEGMENT.test(segment)) {
    throw new OidcVerificationError('OIDC_TOKEN_MALFORMED');
  }
  try {
    const decoded = Buffer.from(segment, 'base64url');
    if (decoded.toString('base64url') !== segment) {
      throw new OidcVerificationError('OIDC_TOKEN_MALFORMED');
    }
    return decoded;
  } catch (error) {
    if (error instanceof OidcVerificationError) throw error;
    throw new OidcVerificationError('OIDC_TOKEN_MALFORMED');
  }
}

function validateHeader(header: Readonly<Record<string, unknown>>): string {
  if (header.alg !== 'RS256') throw new OidcVerificationError('OIDC_ALGORITHM_REJECTED');

  const kid = header.kid;
  if (typeof kid !== 'string' || !kid || kid.trim() !== kid || kid.length > MAX_KID_LENGTH) {
    throw new OidcVerificationError('OIDC_KID_REQUIRED');
  }

  if (header.jku !== undefined || header.jwk !== undefined || header.x5u !== undefined) {
    throw new OidcVerificationError('OIDC_HEADER_UNSUPPORTED');
  }
  if (header.crit !== undefined) {
    throw new OidcVerificationError('OIDC_HEADER_UNSUPPORTED');
  }

  return kid;
}

function parseJwks(body: string): readonly JwksKeyRecord[] {
  try {
    const value = JSON.parse(body) as unknown;
    if (!isRecord(value) || !Array.isArray(value.keys)) {
      throw new OidcVerificationError('OIDC_JWKS_INVALID');
    }
    if (value.keys.length === 0 || value.keys.length > MAX_JWKS_KEYS) {
      throw new OidcVerificationError('OIDC_JWKS_INVALID');
    }
    if (!value.keys.every(isRecord)) throw new OidcVerificationError('OIDC_JWKS_INVALID');
    return value.keys as readonly JwksKeyRecord[];
  } catch (error) {
    if (error instanceof OidcVerificationError) throw error;
    throw new OidcVerificationError('OIDC_JWKS_INVALID');
  }
}

function matchingKeys(keys: readonly JwksKeyRecord[], kid: string): JwksKeyRecord[] {
  return keys.filter((key) => key.kid === kid);
}

function validateRsaVerificationJwk(jwk: JwksKeyRecord): void {
  if (
    jwk.kty !== 'RSA' ||
    typeof jwk.n !== 'string' ||
    !jwk.n ||
    typeof jwk.e !== 'string' ||
    !jwk.e ||
    jwk.d !== undefined
  ) {
    throw new OidcVerificationError('OIDC_KEY_INVALID');
  }
  if (jwk.alg !== undefined && jwk.alg !== 'RS256') {
    throw new OidcVerificationError('OIDC_KEY_INVALID');
  }
  if (jwk.use !== undefined && jwk.use !== 'sig') {
    throw new OidcVerificationError('OIDC_KEY_INVALID');
  }
  if (
    jwk.key_ops !== undefined &&
    (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify'))
  ) {
    throw new OidcVerificationError('OIDC_KEY_INVALID');
  }
}

function validateClaims(
  claims: Readonly<Record<string, unknown>>,
  options: NormalizedOptions,
): VerifiedOidcIdentity {
  if (claims.iss !== options.issuer) {
    throw new OidcVerificationError('OIDC_ISSUER_MISMATCH');
  }

  const audiences = parseTokenAudiences(claims.aud);
  if (!audiences.some((audience) => options.audiences.includes(audience))) {
    throw new OidcVerificationError('OIDC_AUDIENCE_MISMATCH');
  }

  const subject = claims.sub;
  if (
    typeof subject !== 'string' ||
    !subject ||
    subject.trim() !== subject ||
    subject.length > MAX_SUBJECT_LENGTH
  ) {
    throw new OidcVerificationError('OIDC_SUBJECT_REQUIRED');
  }

  const expiresAt = numericDate(claims.exp);
  const notBefore = claims.nbf === undefined ? undefined : numericDate(claims.nbf);
  const now = options.nowEpochSeconds();
  if (!Number.isFinite(now) || now < 0) {
    throw new OidcVerificationError('OIDC_CLAIMS_INVALID');
  }

  if (now - options.clockSkewSeconds >= expiresAt) {
    throw new OidcVerificationError('OIDC_TOKEN_EXPIRED');
  }
  if (notBefore !== undefined && now + options.clockSkewSeconds < notBefore) {
    throw new OidcVerificationError('OIDC_TOKEN_NOT_ACTIVE');
  }

  return {
    subject,
    issuer: options.issuer,
    audiences,
    expiresAt,
  };
}

function parseTokenAudiences(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    if (!value) throw new OidcVerificationError('OIDC_CLAIMS_INVALID');
    return [value];
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    throw new OidcVerificationError('OIDC_CLAIMS_INVALID');
  }
  return [...new Set(value as string[])];
}

function numericDate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new OidcVerificationError('OIDC_CLAIMS_INVALID');
  }
  return value;
}

function safeVerificationCode(error: unknown): OidcVerificationErrorCode {
  return error instanceof OidcVerificationError ? error.code : 'OIDC_PRINCIPAL_MAPPING_FAILED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
