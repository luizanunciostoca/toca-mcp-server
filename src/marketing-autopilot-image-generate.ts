import { readFile, writeFile } from 'node:fs/promises';
import { ControlledOperationScopedStaticImageGenerationService } from './creative/controlled-operation-scoped-static-image-generation.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { GoogleDriveCreativeTruthReferenceLoader } from './providers/google-drive/creative-truth-reference-loader.js';
import { GoogleSheetsRestClient } from './providers/google-sheets/client.js';
import { GoogleSheetsOperationScopedGenerativeRegistry } from './providers/google-sheets/creative-truth-operation-scoped-generative-registry.js';
import { CreativeTruthOperationScopedImageGenerator } from './providers/openai/creative-truth-operation-scoped-image-generator.js';

const args = parseArgs(process.argv.slice(2));
const prompt = await resolvePrompt(args);
const secrets = new EnvironmentSecretResolver(process.env);
const sheetsTokenEnvKey = requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
const driveTokenEnvKey = process.env.GOOGLE_DRIVE_ACCESS_TOKEN_ENV_KEY?.trim() || sheetsTokenEnvKey;
const openAiApiKeyEnvKey = requiredEnv('OPENAI_API_KEY_ENV_KEY');
const responseModel = process.env.OPENAI_CREATIVE_RESPONSE_MODEL?.trim();

const sheets = new GoogleSheetsRestClient(secrets, {
  tokenReference: { provider: 'env', key: sheetsTokenEnvKey },
});
const registry = new GoogleSheetsOperationScopedGenerativeRegistry(sheets);
const referenceLoader = new GoogleDriveCreativeTruthReferenceLoader({
  secretResolver: secrets,
  accessTokenReference: { provider: 'env', key: driveTokenEnvKey },
});
const generator = new CreativeTruthOperationScopedImageGenerator({
  secretResolver: secrets,
  apiKeyReference: { provider: 'env', key: openAiApiKeyEnvKey },
  registry,
  ...(responseModel ? { responseModel } : {}),
});
const service = new ControlledOperationScopedStaticImageGenerationService({
  registry,
  referenceLoader,
  generator,
});

const result = await service.generate({
  contentItemId: args.contentItemId,
  prompt,
  ...(args.nowIso ? { nowIso: args.nowIso } : {}),
});

await writeFile(args.output, result.outputBytes);
await writeFile(
  args.manifest,
  `${JSON.stringify(
    {
      status: 'GENERATED_REVIEW_REQUIRED',
      contentItemId: args.contentItemId,
      creativeMode: result.creativeMode,
      policyId: result.policyId,
      operation: result.operation,
      referenceSetId: result.referenceSetId,
      exceptionId: result.exceptionId,
      approvalRef: result.approvalRef,
      candidateSha256: result.candidateSha256,
      referenceAssetIds: result.referenceAssetIds,
      referenceSha256s: result.referenceSha256s,
      provider: result.provider,
      generationMode: result.generationMode,
      responseModel: result.responseModel,
      imageToolModelSelection: result.imageToolModelSelection,
      outputContentType: result.outputContentType,
      outputSizeBytes: result.outputBytes.byteLength,
      outputPath: args.output,
      requiresPostGenerationHumanReview: result.requiresPostGenerationHumanReview,
      requiresVenueFidelityGate: result.requiresVenueFidelityGate,
      readyForFinalComposition: result.readyForFinalComposition,
      publicationEligible: false,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

process.stdout.write(
  `${JSON.stringify({
    status: 'GENERATED_REVIEW_REQUIRED',
    contentItemId: args.contentItemId,
    operation: result.operation,
    referenceSetId: result.referenceSetId,
    candidateSha256: result.candidateSha256,
    outputPath: args.output,
    manifestPath: args.manifest,
    referenceAssetIds: result.referenceAssetIds,
    exceptionId: result.exceptionId,
    approvalRef: result.approvalRef,
    responseModel: result.responseModel,
    imageToolModelSelection: result.imageToolModelSelection,
    requiresPostGenerationHumanReview: true,
    requiresVenueFidelityGate: true,
    readyForFinalComposition: false,
    publicationEligible: false,
  })}\n`,
);

interface CliArgs {
  readonly contentItemId: string;
  readonly prompt?: string;
  readonly promptFile?: string;
  readonly output: string;
  readonly manifest: string;
  readonly nowIso?: string;
}

async function resolvePrompt(args: CliArgs): Promise<string> {
  if (args.prompt) return args.prompt;
  if (!args.promptFile) throw new Error('IMAGE_GENERATE_PROMPT_SOURCE_MISSING');
  const prompt = (await readFile(args.promptFile, 'utf8')).trim();
  if (!prompt) throw new Error('IMAGE_GENERATE_PROMPT_EMPTY');
  return prompt;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error('IMAGE_GENERATE_ARGS_INVALID');
    values.set(key.slice(2), value);
  }
  const contentItemId = required(values, 'content-item-id');
  const output = required(values, 'output');
  const prompt = values.get('prompt')?.trim();
  const promptFile = values.get('prompt-file')?.trim();
  if ((prompt ? 1 : 0) + (promptFile ? 1 : 0) !== 1) {
    throw new Error('IMAGE_GENERATE_EXACTLY_ONE_PROMPT_SOURCE_REQUIRED');
  }
  const manifest = values.get('manifest')?.trim() || `${output}.manifest.json`;
  const nowIso = values.get('now-iso')?.trim();
  if (nowIso && !Number.isFinite(Date.parse(nowIso))) throw new Error('IMAGE_GENERATE_NOW_ISO_INVALID');
  return {
    contentItemId,
    ...(prompt ? { prompt } : {}),
    ...(promptFile ? { promptFile } : {}),
    output,
    manifest,
    ...(nowIso ? { nowIso } : {}),
  };
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`IMAGE_GENERATE_ARG_REQUIRED:${key}`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`IMAGE_GENERATE_ENV_REQUIRED:${key}`);
  return value;
}
