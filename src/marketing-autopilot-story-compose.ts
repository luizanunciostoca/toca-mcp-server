import { readFile, writeFile } from 'node:fs/promises';
import { LocalStoryComposer } from './providers/local/local-story-composer.js';

const args = parseArgs(process.argv.slice(2));
const sourceBytes = await readFile(args.source);
const result = await new LocalStoryComposer().compose({
  contentItemId: args.contentItemId,
  storyCreativeId: args.storyCreativeId,
  masterAssetId: args.masterAssetId,
  masterDriveFileId: args.masterDriveFileId,
  imageBytes: sourceBytes,
  contentType: args.contentType,
  ...(args.templateId ? { templateId: args.templateId } : {}),
  ...(args.headline ? { headline: args.headline } : {}),
  ...(args.body ? { body: args.body } : {}),
  ...(args.cta ? { cta: args.cta } : {}),
});

await writeFile(args.output, result.outputBytes);
process.stdout.write(
  `${JSON.stringify({
    contentItemId: result.contentItemId,
    storyCreativeId: result.storyCreativeId,
    masterAssetId: result.masterAssetId,
    masterDriveFileId: result.masterDriveFileId,
    sourceSha256: result.sourceSha256,
    outputSha256: result.outputSha256,
    sourceImageBound: result.sourceImageBound,
    renderMode: result.renderMode,
    editorProvider: result.editorProvider,
    pipelineVersion: result.pipelineVersion,
    templateId: result.templateId,
    dimensions: result.dimensions,
    outputContentType: result.outputContentType,
    outputSizeBytes: result.outputBytes.byteLength,
    outputPath: args.output,
  })}\n`,
);

interface CliArgs {
  readonly source: string;
  readonly output: string;
  readonly contentItemId: string;
  readonly storyCreativeId: string;
  readonly masterAssetId: string;
  readonly masterDriveFileId: string;
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly templateId?: string;
  readonly headline?: string;
  readonly body?: string;
  readonly cta?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('STORY_COMPOSE_ARGS_INVALID');
    }
    values.set(key.slice(2), value);
  }
  const rawContentType = required(values, 'content-type');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(rawContentType)) {
    throw new Error(
      `STORY_COMPOSE_CONTENT_TYPE_UNSUPPORTED:${rawContentType}`,
    );
  }
  return {
    source: required(values, 'source'),
    output: required(values, 'output'),
    contentItemId: required(values, 'content-item-id'),
    storyCreativeId: required(values, 'story-creative-id'),
    masterAssetId: required(values, 'master-asset-id'),
    masterDriveFileId: required(values, 'master-drive-file-id'),
    contentType: rawContentType as CliArgs['contentType'],
    ...(values.get('template-id')
      ? { templateId: values.get('template-id') }
      : {}),
    ...(values.get('headline')
      ? { headline: values.get('headline') }
      : {}),
    ...(values.get('body') ? { body: values.get('body') } : {}),
    ...(values.get('cta') ? { cta: values.get('cta') } : {}),
  };
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`STORY_COMPOSE_ARG_REQUIRED:${key}`);
  return value;
}
