import { readFile, writeFile } from 'node:fs/promises';
import { artistAssetSchema } from './contracts/artist-integrity.js';
import { LocalMultiLayerCreativeComposer } from './providers/local/local-multilayer-creative-composer.js';

const args = parseArgs(process.argv.slice(2));
const [artistBytes, venueBytes, maskBytes, registryJson] = await Promise.all([
  readFile(args.artist),
  readFile(args.venue),
  readFile(args.mask),
  readFile(args.artistRegistry, 'utf8'),
]);
const registry = artistAssetSchema.parse(JSON.parse(registryJson));

const composer = new LocalMultiLayerCreativeComposer();
const result = await composer.compose({
  artist: {
    assetId: registry.sourceAssetId,
    driveFileId: registry.sourceDriveFileId,
    bytes: artistBytes,
    contentType: args.artistContentType,
    registry,
  },
  venue: {
    assetId: args.venueAssetId,
    driveFileId: args.venueDriveFileId,
    bytes: venueBytes,
    contentType: args.venueContentType,
  },
  artistProtectionMaskBytes: maskBytes,
  maskContentType: args.maskContentType,
  canvas: args.canvas,
  venueOpacityPercent: args.opacity,
  orangeTint: args.orangeTint,
  fadeDirection: args.fadeDirection,
});
await writeFile(args.output, result.outputBytes);
process.stdout.write(`${JSON.stringify({ ...result, outputBytes: undefined, outputPath: args.output })}\n`);

type CT = 'image/jpeg' | 'image/png' | 'image/webp';
type Canvas = '1080x1350' | '1080x1920' | '1080x1080';
type Fade = 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT' | 'TOP_TO_BOTTOM' | 'BOTTOM_TO_TOP';
interface Args {
  artist: string; venue: string; mask: string; artistRegistry: string; output: string;
  artistContentType: CT; venueContentType: CT; maskContentType: CT;
  venueAssetId: string; venueDriveFileId: string; canvas: Canvas; opacity: number;
  orangeTint: string; fadeDirection: Fade;
}
function parseArgs(argv: readonly string[]): Args {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]; const v = argv[i + 1];
    if (!k?.startsWith('--') || !v) throw new Error('ARTIST_COMPOSITE_ARGS_INVALID');
    m.set(k.slice(2), v);
  }
  const req = (k: string) => { const v = m.get(k)?.trim(); if (!v) throw new Error(`ARTIST_COMPOSITE_ARG_REQUIRED:${k}`); return v; };
  const ct = (k: string): CT => { const v = req(k); if (!['image/jpeg','image/png','image/webp'].includes(v)) throw new Error(`CONTENT_TYPE_UNSUPPORTED:${v}`); return v as CT; };
  const canvas = (m.get('canvas') ?? '1080x1350') as Canvas;
  if (!['1080x1350','1080x1920','1080x1080'].includes(canvas)) throw new Error(`CANVAS_UNSUPPORTED:${canvas}`);
  const fadeDirection = (m.get('fade-direction') ?? 'RIGHT_TO_LEFT') as Fade;
  if (!['LEFT_TO_RIGHT','RIGHT_TO_LEFT','TOP_TO_BOTTOM','BOTTOM_TO_TOP'].includes(fadeDirection)) throw new Error(`FADE_UNSUPPORTED:${fadeDirection}`);
  const opacity = Number(m.get('opacity') ?? '55');
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 100) throw new Error('OPACITY_INVALID');
  return {
    artist: req('artist'), venue: req('venue'), mask: req('mask'), artistRegistry: req('artist-registry'), output: req('output'),
    artistContentType: ct('artist-content-type'), venueContentType: ct('venue-content-type'), maskContentType: ct('mask-content-type'),
    venueAssetId: req('venue-asset-id'), venueDriveFileId: req('venue-drive-file-id'), canvas, opacity,
    orangeTint: m.get('orange-tint') ?? '#d96b16', fadeDirection,
  };
}
