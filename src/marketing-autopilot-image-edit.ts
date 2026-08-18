import { readFile, writeFile } from 'node:fs/promises';
import { TOCA_CREATIVE_TRUTH_POLICY_ID } from './contracts/creative-truth.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { LocalPhotoEnhancer } from './providers/local/local-photo-enhancer.js';
import { CreativeTruthOpenAiImageEnhancer } from './providers/openai/creative-truth-openai-image-enhancer.js';
import { OpenAiImageEditProvider } from './providers/openai/openai-image-edit-provider.js';

const args = parseArgs(process.argv.slice(2));
const sourceBytes = await readFile(args.source);

const result =
  args.provider === 'openai'
    ? await editWithOpenAi(args, sourceBytes)
    : await new LocalPhotoEnhancer().enhance({
        sourceAssetId: args.sourceAssetId,
        sourceDriveFileId: args.sourceDriveFileId,
        imageBytes: sourceBytes,
        contentType: args.contentType,
        creativeTruth: {
          policyId: TOCA_CREATIVE_TRUTH_POLICY_ID,
          creativeMode: 'REAL_PLUS_ENHANCEMENT',
        },
      });

await writeFile(args.output, result.outputBytes);

process.stdout.write(
  `${JSON.stringify({
    sourceAssetId: result.sourceAssetId,
    sourceDriveFileId: result.sourceDriveFileId,
    sourceSha256: result.sourceSha256,
    outputSha256: result.outputSha256,
    sourceImageBound: result.sourceImageBound,
    editMode: result.editMode,
    editorProvider: result.editorProvider,
    pipelineVersion: 'pipelineVersion' in result ? result.pipelineVersion : undefined,
    restorationPolicyId:
      'restorationPolicyId' in result ? result.restorationPolicyId : undefined,
    restorationProfile:
      'restorationProfile' in result ? result.restorationProfile : undefined,
    requestedScale: 'requestedScale' in result ? result.requestedScale : undefined,
    outputLongEdgePixels:
      'outputLongEdgePixels' in result ? result.outputLongEdgePixels : undefined,
    stillMasterFormat: 'stillMasterFormat' in result ? result.stillMasterFormat : undefined,
    proResApplicability:
      'proResApplicability' in result ? result.proResApplicability : undefined,
    identityLock: 'identityLock' in result ? result.identityLock : undefined,
    compositionLock: 'compositionLock' in result ? result.compositionLock : undefined,
    structureLock: 'structureLock' in result ? result.structureLock : undefined,
    backgroundLock: 'backgroundLock' in result ? result.backgroundLock : undefined,
    generativeDetailSynthesisUsed:
      'generativeDetailSynthesisUsed' in result ? result.generativeDetailSynthesisUsed : undefined,
    semanticAlterationDetected:
      'semanticAlterationDetected' in result ? result.semanticAlterationDetected : undefined,
    restorationConfidence:
      'restorationConfidence' in result ? result.restorationConfidence : undefined,
    textDetailConfidence:
      'textDetailConfidence' in result ? result.textDetailConfidence : undefined,
    iconDetailConfidence:
      'iconDetailConfidence' in result ? result.iconDetailConfidence : undefined,
    microDetailConfidence:
      'microDetailConfidence' in result ? result.microDetailConfidence : undefined,
    reviewRequiredReason:
      'reviewRequiredReason' in result ? result.reviewRequiredReason : undefined,
    promotionEligible: 'promotionEligible' in result ? result.promotionEligible : undefined,
    inputFidelity: 'inputFidelity' in result ? result.inputFidelity : undefined,
    requestedQuality: 'requestedQuality' in result ? result.requestedQuality : undefined,
    requestedSize: 'requestedSize' in result ? result.requestedSize : undefined,
    requestedOutputFormat:
      'requestedOutputFormat' in result ? result.requestedOutputFormat : 'jpeg',
    outputContentType: result.outputContentType,
    outputSizeBytes: result.outputBytes.byteLength,
    outputPath: args.output,
    creativeTruthPolicyId: result.policyId,
    creativeTruthBound: result.creativeTruthBound,
    creativeMode: result.creativeMode,
    requiresVenueFidelityGate: result.requiresVenueFidelityGate,
    venueFidelityGateRequired: true,
  })}\n`,
);

async function editWithOpenAi(args: CliArgs, sourceBytes: Uint8Array) {
  const apiKeyEnvKey = process.env.OPENAI_API_KEY_ENV_KEY?.trim();
  if (!apiKeyEnvKey) throw new Error('OPENAI_API_KEY_ENV_KEY_REQUIRED');

  const provider = new OpenAiImageEditProvider({
    secretResolver: new EnvironmentSecretResolver(process.env),
    apiKeyReference: { provider: 'env', key: apiKeyEnvKey },
  });
  const enhancer = new CreativeTruthOpenAiImageEnhancer(provider);

  return enhancer.enhance({
    sourceAssetId: args.sourceAssetId,
    sourceDriveFileId: args.sourceDriveFileId,
    imageBytes: sourceBytes,
    contentType: args.contentType,
  });
}

interface CliArgs {
  readonly source: string;
  readonly output: string;
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly provider: 'local' | 'openai';
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('IMAGE_EDIT_ARGS_INVALID');
    values.set(key.slice(2), value);
  }

  const source = required(values, 'source');
  const output = required(values, 'output');
  const sourceAssetId = required(values, 'source-asset-id');
  const sourceDriveFileId = required(values, 'source-drive-file-id');
  const rawContentType = required(values, 'content-type');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(rawContentType)) {
    throw new Error(`IMAGE_EDIT_CONTENT_TYPE_UNSUPPORTED:${rawContentType}`);
  }

  const rawProvider = values.get('provider')?.trim().toLowerCase() ?? 'local';
  if (!['local', 'openai'].includes(rawProvider)) {
    throw new Error(`IMAGE_EDIT_PROVIDER_UNSUPPORTED:${rawProvider}`);
  }

  return {
    source,
    output,
    sourceAssetId,
    sourceDriveFileId,
    contentType: rawContentType as CliArgs['contentType'],
    provider: rawProvider as CliArgs['provider'],
  };
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`IMAGE_EDIT_ARG_REQUIRED:${key}`);
  return value;
}
