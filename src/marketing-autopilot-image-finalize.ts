import { readFile, writeFile } from 'node:fs/promises';
import { operationScopedGenerativeCandidateManifestSchema } from './contracts/operation-scoped-generative-candidate.js';
import { fidelityEvidenceSchema } from './contracts/creative-truth.js';
import { ControlledOperationScopedGenerativeFinalizationService } from './creative/controlled-operation-scoped-generative-finalization.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import {
  GoogleDriveCreativeTruthBrandAssetLoader,
  type LoadedCreativeTruthBrandAsset,
} from './providers/google-drive/creative-truth-brand-asset-loader.js';
import { GoogleSheetsRestClient } from './providers/google-sheets/client.js';
import { GoogleSheetsOperationScopedGenerativeRegistry } from './providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import { GoogleSheetsThePartyContentOrchestration } from './providers/google-sheets/the-party-content-orchestration.js';
import { LocalOperationScopedGenerativeComposer } from './providers/local/local-operation-scoped-generative-composer.js';

const args = parseArgs(process.argv.slice(2));
const candidateManifest = operationScopedGenerativeCandidateManifestSchema.parse(
  JSON.parse(await readFile(args.candidateManifest, 'utf8')),
);
const fidelityEvidence = fidelityEvidenceSchema.parse(
  JSON.parse(await readFile(args.fidelityEvidence, 'utf8')),
);
const candidateImageBytes = await readFile(args.candidate);

const secrets = new EnvironmentSecretResolver(process.env);
const sheetsTokenEnvKey = requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
const driveTokenEnvKey = process.env.GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY?.trim() || sheetsTokenEnvKey;
const sheets = new GoogleSheetsRestClient(secrets, {
  tokenReference: { provider: 'env', key: sheetsTokenEnvKey },
});
const registry = new GoogleSheetsOperationScopedGenerativeRegistry(sheets);
const brandLoader = new GoogleDriveCreativeTruthBrandAssetLoader({
  secretResolver: secrets,
  accessTokenReference: { provider: 'env', key: driveTokenEnvKey },
});

const standard = await requiredStandard(registry, args.standardId);
const visualStandard = args.visualStandardId
  ? await requiredStandard(registry, args.visualStandardId)
  : undefined;
const thePartyContext =
  candidateManifest.operation === 'THE_PARTY'
    ? await new GoogleSheetsThePartyContentOrchestration(sheets).get(candidateManifest.contentItemId)
    : undefined;
assertCanonicalThePartyFinalizationContext(
  candidateManifest.operation,
  standard,
  visualStandard,
  thePartyContext,
);

const requiredBrands = resolveRequiredBrands(
  candidateManifest.operation,
  args.additionalBrands,
);
const brandAssets: LoadedCreativeTruthBrandAsset[] = [];
for (const brand of requiredBrands) {
  const canonicalBrand = await registry.getBrandAsset(brand, args.brandVariant);
  if (!canonicalBrand) throw new Error(`IMAGE_FINALIZE_BRAND_NOT_FOUND:${brand}`);
  brandAssets.push(await brandLoader.load(canonicalBrand));
}

const finalizer = new ControlledOperationScopedGenerativeFinalizationService({
  registry,
  composer: new LocalOperationScopedGenerativeComposer(),
});
const result = await finalizer.finalize({
  candidateManifest,
  candidateImageBytes,
  candidateContentType: candidateManifest.outputContentType,
  creativeId: args.creativeId,
  standard,
  ...(visualStandard ? { visualStandard } : {}),
  fidelityEvidence,
  canvas: args.canvas,
  ...(args.headline ? { headline: args.headline } : {}),
  ...(args.supportCopy ? { supportCopy: args.supportCopy } : {}),
  ...(args.cta ? { cta: args.cta } : {}),
  ...(args.functionalInfo ? { functionalInfo: args.functionalInfo } : {}),
  ...(thePartyContext?.environment ? { partyEnvironment: thePartyContext.environment } : {}),
  requiredBrands,
  brandAssets,
});

await writeFile(args.output, result.outputBytes);
await writeFile(args.finalManifest, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');

process.stdout.write(
  `${JSON.stringify({
    status: 'FINALIZED_CREATIVE_TRUTH_PASSED',
    contentItemId: candidateManifest.contentItemId,
    creativeId: args.creativeId,
    operation: candidateManifest.operation,
    referenceSetId: candidateManifest.referenceSetId,
    outputSha256: result.outputSha256,
    outputPath: args.output,
    finalManifestPath: args.finalManifest,
    brandAssetIds: result.manifest.brandAssetIds,
    exactAssetBinding: result.manifest.exactAssetBinding,
    gates: result.manifest.gates.map((gate) => ({ gate: gate.gate, status: gate.status })),
    publicationAuthorized: false,
  })}\n`,
);

interface CliArgs {
  readonly candidate: string;
  readonly candidateManifest: string;
  readonly fidelityEvidence: string;
  readonly creativeId: string;
  readonly standardId: string;
  readonly visualStandardId?: string;
  readonly canvas: '1080x1350' | '1080x1080' | '1080x1920';
  readonly output: string;
  readonly finalManifest: string;
  readonly brandVariant: string;
  readonly additionalBrands: readonly string[];
  readonly headline?: string;
  readonly supportCopy?: string;
  readonly cta?: string;
  readonly functionalInfo?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('IMAGE_FINALIZE_ARGS_INVALID');
    values.set(key.slice(2), value);
  }
  if (values.has('now-iso') || values.has('party-environment')) {
    throw new Error('IMAGE_FINALIZE_CALLER_CANONICAL_CONTEXT_FORBIDDEN');
  }
  const output = required(values, 'output');
  const canvas = required(values, 'canvas');
  if (!['1080x1350', '1080x1080', '1080x1920'].includes(canvas)) {
    throw new Error(`IMAGE_FINALIZE_CANVAS_UNSUPPORTED:${canvas}`);
  }
  const additionalBrands = parseCsv(values.get('additional-brands'));
  return {
    candidate: required(values, 'candidate'),
    candidateManifest: required(values, 'candidate-manifest'),
    fidelityEvidence: required(values, 'fidelity-evidence'),
    creativeId: required(values, 'creative-id'),
    standardId: required(values, 'standard-id'),
    ...(values.get('visual-standard-id')?.trim()
      ? { visualStandardId: values.get('visual-standard-id')!.trim() }
      : {}),
    canvas: canvas as CliArgs['canvas'],
    output,
    finalManifest: values.get('final-manifest')?.trim() || `${output}.manifest.json`,
    brandVariant: values.get('brand-variant')?.trim() || 'WHITE',
    additionalBrands,
    ...(values.get('headline')?.trim() ? { headline: values.get('headline')!.trim() } : {}),
    ...(values.get('support-copy')?.trim()
      ? { supportCopy: values.get('support-copy')!.trim() }
      : {}),
    ...(values.get('cta')?.trim() ? { cta: values.get('cta')!.trim() } : {}),
    ...(values.get('functional-info')?.trim()
      ? { functionalInfo: values.get('functional-info')!.trim() }
      : {}),
  };
}

async function requiredStandard(
  registry: GoogleSheetsOperationScopedGenerativeRegistry,
  standardId: string,
) {
  const standard = await registry.getCreativeStandard(standardId);
  if (!standard) throw new Error(`IMAGE_FINALIZE_STANDARD_NOT_FOUND:${standardId}`);
  return standard;
}

function assertCanonicalThePartyFinalizationContext(
  operation: 'SUNSET' | 'THE_PARTY',
  outputStandard: Awaited<ReturnType<typeof requiredStandard>>,
  visualStandard: Awaited<ReturnType<typeof requiredStandard>> | undefined,
  context: Awaited<ReturnType<GoogleSheetsThePartyContentOrchestration['get']>> | undefined,
): void {
  if (operation !== 'THE_PARTY') return;
  if (!context) throw new Error('IMAGE_FINALIZE_THE_PARTY_CONTEXT_REQUIRED');
  const effectiveVisualStandard = outputStandard.operation === 'ALL' ? visualStandard : outputStandard;
  if (!effectiveVisualStandard || effectiveVisualStandard.standardId !== context.standardId) {
    throw new Error('IMAGE_FINALIZE_THE_PARTY_STANDARD_CONTEXT_MISMATCH');
  }
  if (
    context.standardId === 'THE_PARTY_HYBRID_NETWORKS_V1' &&
    (!context.environment || context.visualStandardStatus === 'BLOCKED_NEEDS_ENVIRONMENT')
  ) {
    throw new Error('THE_PARTY_ENVIRONMENT_REQUIRED');
  }
}

function resolveRequiredBrands(
  operation: 'SUNSET' | 'THE_PARTY',
  additionalBrands: readonly string[],
): readonly string[] {
  const mandatory = operation === 'THE_PARTY' ? 'THE_PARTY' : 'TOCA_DO_MORCEGO';
  const brands = [mandatory, ...additionalBrands];
  if (brands.some((brand) => !brand.trim()) || new Set(brands).size !== brands.length) {
    throw new Error('IMAGE_FINALIZE_REQUIRED_BRANDS_INVALID');
  }
  return brands;
}

function parseCsv(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`IMAGE_FINALIZE_ARG_REQUIRED:${key}`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`IMAGE_FINALIZE_ENV_REQUIRED:${key}`);
  return value;
}
