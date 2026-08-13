import { readFile, writeFile } from 'node:fs/promises';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { LocalPhotoEnhancer } from './providers/local/local-photo-enhancer.js';
import { OpenAiImageEditProvider } from './providers/openai/openai-image-edit-provider.js';

const args = parseArgs(process.argv.slice(2));
const sourceBytes = await readFile(args.source);
const provider = args.provider ?? 'local';

const result =
  provider === 'openai'
    ? await editWithOpenAi(args, sourceBytes)
    : await new LocalPhotoEnhancer().enhance({
        sourceAssetId: args.sourceAssetId,
        sourceDriveFileId: args.sourceDriveFileId,
        imageBytes: sourceBytes,
        contentType: args.contentType,
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
    requestedScale: 'requestedScale' in result ? result.requestedScale : undefined,
    inputFidelity: 'inputFidelity' in result ? result.inputFidelity : undefined,
    requestedQuality: 'requestedQuality' in result ? result.requestedQuality : undefined,
    requestedSize: 'requestedSize' in result ? result.requestedSize : undefined,
    requestedOutputFormat:
      'requestedOutputFormat' in result ? result.requestedOutputFormat : 'jpeg',
    outputContentType: result.outputContentType,
    outputSizeBytes: result.outputBytes.byteLength,
    outputPath: args.output,
  })}\n`,
);

async function editWithOpenAi(args: CliArgs, sourceBytes: Uint8Array) {
  const apiKeyEnvKey = process.env.OPENAI_API_KEY_ENV_KEY?.trim();
  if (!apiKeyEnvKey) throw new Error('OPENAI_API_KEY_ENV_KEY_REQUIRED');

  const provider = new OpenAiImageEditProvider({
    secretResolver: new EnvironmentSecretResolver(process.env),
    apiKeyReference: { provider: 'env', key: apiKeyEnvKey },
  });

  return provider.edit({
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
  readonly provider?: 'local' | 'openai';
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

  const rawProvider = values.get('provider')?.trim().toLowerCase();
  if (rawProvider && !['local', 'openai'].includes(rawProvider)) {
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
