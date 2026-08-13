import { readFile, writeFile } from 'node:fs/promises';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { OpenAiImageEditProvider } from './providers/openai/openai-image-edit-provider.js';

const args = parseArgs(process.argv.slice(2));
const apiKeyEnvKey = process.env.OPENAI_API_KEY_ENV_KEY?.trim();
if (!apiKeyEnvKey) throw new Error('OPENAI_API_KEY_ENV_KEY_REQUIRED');

const sourceBytes = await readFile(args.source);
const provider = new OpenAiImageEditProvider({
  secretResolver: new EnvironmentSecretResolver(process.env),
  apiKeyReference: { provider: 'env', key: apiKeyEnvKey },
});

const result = await provider.edit({
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
    inputFidelity: result.inputFidelity,
    requestedQuality: result.requestedQuality,
    requestedSize: result.requestedSize,
    requestedOutputFormat: result.requestedOutputFormat,
    outputContentType: result.outputContentType,
    outputSizeBytes: result.outputBytes.byteLength,
    outputPath: args.output,
  })}\n`,
);

interface CliArgs {
  readonly source: string;
  readonly output: string;
  readonly sourceAssetId: string;
  readonly sourceDriveFileId: string;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
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

  return {
    source,
    output,
    sourceAssetId,
    sourceDriveFileId,
    contentType: rawContentType as CliArgs['contentType'],
  };
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`IMAGE_EDIT_ARG_REQUIRED:${key}`);
  return value;
}
