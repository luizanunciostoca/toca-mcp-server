import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_PATHS = [
  'src/http-server.ts',
  'src/http.ts',
  'src/server.ts',
  'src/core/identity.ts',
  'src/runtime/tenant-identity.ts',
  'src/app-gateway/oidc-verifier.ts',
];

/**
 * Offline inventory, never an authentication verifier or a deployment gate.
 * A known source shape is an observation, not proof of a reachable/authenticated runtime.
 * No network, environment-variable inspection, credential access or side effects.
 */
export function inspectMcpReadonlyConnection(
  root = fileURLToPath(new URL('../', import.meta.url)),
) {
  const sources = new Map();
  const sourceEvidence = SOURCE_PATHS.map((sourcePath) => {
    try {
      const bytes = readFileSync(path.join(root, sourcePath));
      sources.set(sourcePath, bytes.toString('utf8'));
      return {
        path: sourcePath,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    } catch {
      return { path: sourcePath, error: 'SOURCE_UNAVAILABLE' };
    }
  });
  const http = sources.get('src/http-server.ts') ?? '';
  // Recognize the complete current normalization block. Any change becomes UNKNOWN,
  // rather than inferring that an added "auth" token proves authentication.
  const knownNormalization =
    /const normalizedRequest: NodeIncomingMessageLike = \{\s*method,\s*url: requestUrl,\s*headers: request.headers,\s*\[Symbol\.asyncIterator\]: \(\) => request\[Symbol\.asyncIterator\]\(\),\s*\};\s*void handleMcp\(normalizedRequest, response\)/;
  return {
    mode: 'OFFLINE_SOURCE_ONLY',
    status: 'NOT_INTEGRATED',
    sourceEvidence,
    observations: {
      httpHandoff: knownNormalization.test(http)
        ? 'KNOWN_NORMALIZATION_WITHOUT_AUTH_INFO'
        : 'UNKNOWN_REQUIRES_REVIEW',
      existingOidcVerifier: sources
        .get('src/app-gateway/oidc-verifier.ts')
        ?.includes('export function createOidcBearerVerifier(')
        ? 'SOURCE_PRESENT_NOT_RUNTIME_PROVEN'
        : 'UNKNOWN_REQUIRES_REVIEW',
    },
    requiredRuntimeEvidence: [
      'CORE_SERVICE_URL_REVISION_SHA_DIGEST_AND_PRIVATE_INGRESS',
      'CALLER_VERIFIER_ISSUER_AUDIENCE_AND_AUTHORIZED_TENANT_SCOPE_MAPPING',
      'SERVER_ENFORCED_READ_ONLY_SURFACE_WITHOUT_SERVICE_FALLBACK_DOWNGRADE',
      'SUPPORTED_INSTALLED_PLUGIN_AVAILABLE_TO_THIS_CONVERSATION',
      'MCP_INITIALIZE_TOOLS_LIST_AND_READINESS',
      'SCOPED_AUTHENTICATED_READ_AND_NEGATIVE_AUTHORIZATION_TESTS',
    ],
    warning:
      'Source inspection cannot prove authentication, runtime readiness or provider connectivity.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(inspectMcpReadonlyConnection(), null, 2));
  // Intentional: this offline diagnostic can never certify a live connection.
  process.exitCode = 2;
}
