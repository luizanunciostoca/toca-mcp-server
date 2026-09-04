import { createHash } from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GoogleMetadataAccessTokenResolver } from './providers/gcp/google-metadata-access-token-resolver.js';
import { GoogleServiceIdentityOAuthResolver } from './providers/gcp/google-service-identity-oauth-resolver.js';
import { GcsPublicationAssetStager } from './providers/gcp/gcs-publication-asset-stager.js';
import { GoogleDriveCreativeVideoSourceLoader } from './providers/google-drive/creative-video-source-loader.js';

const execFile = promisify(execFileCb);
const PRODUCTION_ID = 'VID-TP-20260904-AGENCY-GEN-004' as const;
const WIDTH = 720;
const HEIGHT = 1280;
const GOLD = '0xFFC629';
const TARGET_SECONDS = 18;
const RAW_PREFIX = 'instagram/the-party-agency-gen-v04-shots/';

const SHOTS = [
  { assetId: 'TP-AGENCY-V04-S01', sourceAssetId: 'TP-0048', headline: 'A NOITE COMEÇA AQUI.', support: 'Morro de São Paulo' },
  { assetId: 'TP-AGENCY-V04-S02', sourceAssetId: 'TP-0087', headline: 'GENTE QUE FAZ A NOITE.', support: 'Encontro. Presença. Experiência.' },
  { assetId: 'TP-AGENCY-V04-S03', sourceAssetId: 'TP-0071', headline: 'O SOM TOMA CONTA.', support: 'Ritmo. Luz. Movimento.' },
  { assetId: 'TP-AGENCY-V04-S04', sourceAssetId: 'TP-0130', headline: 'A PISTA RESPONDE.', support: 'Duas pistas. Uma só noite.' },
] as const;

const BRAND = {
  logo: { driveFileId: '1V09F8w1BcgwzONnZk1ROpOJACuDF2dPF', expectedSha256: 'feb5a7db499640de9904432411d47f2c319e19129c09752f2c1402ae8ceff948' },
  footer: { driveFileId: '1hOq6jtk4jsuJLDPfO046qZCS5T1lv0g1', expectedSha256: '4d4498d0b839bc5fe7a313b0743040106c43d127142018160cbeb8348c16c67b' },
} as const;

const projectId = requiredEnv('GCP_PROJECT_ID');
const bucketName = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const driveResolver = new GoogleServiceIdentityOAuthResolver();
const driveRef = { provider: 'gcp-service-identity-oauth', key: 'video-workspace' } as const;
const sourceLoader = new GoogleDriveCreativeVideoSourceLoader({ secretResolver: driveResolver, accessTokenReference: driveRef });
const cloudResolver = new GoogleMetadataAccessTokenResolver();
const cloudRef = { provider: 'gcp-metadata-oauth', key: 'cloud-platform' } as const;
const stager = new GcsPublicationAssetStager({ projectId, bucketName, signedUrlTtlSeconds: 6 * 60 * 60 });

const workspace = await mkdtemp(join(tmpdir(), 'toca-party-agency-v04-recovery-'));
try {
  const logo = await sourceLoader.load(BRAND.logo);
  const footer = await sourceLoader.load(BRAND.footer);
  const logoPath = join(workspace, 'the-party-logo.png');
  const footerPath = join(workspace, 'the-party-footer.png');
  await writeFile(logoPath, logo.bytes);
  await writeFile(footerPath, footer.bytes);

  const recovered: Array<{ shot: number; sourceAssetId: string; objectName: string; sha256: string; sizeBytes: number }> = [];
  const brandedPaths: string[] = [];
  for (let index = 0; index < SHOTS.length; index += 1) {
    const shot = SHOTS[index]!;
    const raw = await loadUniquePersistedShot(shot.assetId);
    const rawPath = join(workspace, `shot-${index + 1}-raw.mp4`);
    const brandedPath = join(workspace, `shot-${index + 1}-branded.mp4`);
    await writeFile(rawPath, raw.bytes);
    await renderBrandedShot({ inputPath: rawPath, logoPath, outputPath: brandedPath, headline: shot.headline, support: shot.support, workspace, index });
    brandedPaths.push(brandedPath);
    recovered.push({ shot: index + 1, sourceAssetId: shot.sourceAssetId, objectName: raw.objectName, sha256: raw.sha256, sizeBytes: raw.bytes.byteLength });
  }

  const sequencePath = join(workspace, 'sequence-16s.mp4');
  await concatCopy(brandedPaths, sequencePath, 'shots');

  const lastFramePath = join(workspace, 'end-bg.png');
  await runFfmpeg(['-y', '-threads', '1', '-sseof', '-0.10', '-i', brandedPaths.at(-1)!, '-frames:v', '1', lastFramePath], 'lastFrame');

  const endcardPath = join(workspace, 'endcard-2s.mp4');
  await renderEndcard({ backgroundPath: lastFramePath, logoPath, footerPath, outputPath: endcardPath, workspace });

  const silentFinalPath = join(workspace, 'final-silent-18s.mp4');
  await concatCopy([sequencePath, endcardPath], silentFinalPath, 'sequenceEndcard');

  const audioPath = join(workspace, 'original-club-track.wav');
  await writeSyntheticClubTrack(audioPath);

  const approvalPath = join(workspace, 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_APPROVAL.mp4');
  await runFfmpeg([
    '-y', '-threads', '1', '-i', silentFinalPath, '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-af', 'loudnorm=I=-17.5:TP=-2.8:LRA=7', '-shortest', '-t', String(TARGET_SECONDS), '-movflags', '+faststart', approvalPath,
  ], 'approval');

  const masterPath = join(workspace, 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_MASTER.mp4');
  await runFfmpeg([
    '-y', '-threads', '1', '-i', approvalPath, '-vf', 'scale=1080:1920:flags=lanczos',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', masterPath,
  ], 'master');

  const coverPath = join(workspace, 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_COVER.jpg');
  await runFfmpeg(['-y', '-threads', '1', '-ss', '16.4', '-i', masterPath, '-frames:v', '1', '-q:v', '2', coverPath], 'cover');

  const contactPath = join(workspace, 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_CONTACT_SHEET.jpg');
  await runFfmpeg([
    '-y', '-threads', '1', '-i', approvalPath,
    '-vf', 'fps=1/3,scale=240:426:force_original_aspect_ratio=decrease,pad=240:426:(ow-iw)/2:(oh-ih)/2:black,tile=3x2',
    '-frames:v', '1', '-q:v', '3', contactPath,
  ], 'contactSheet');

  const technical = await probeVideo(approvalPath);
  const loudness = await measureLoudness(approvalPath);
  const outputs = {
    approval: await stageAndVerify('TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_APPROVAL', approvalPath, 'video/mp4'),
    master: await stageAndVerify('TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_MASTER', masterPath, 'video/mp4'),
    cover: await stageAndVerify('TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_COVER', coverPath, 'image/jpeg'),
    contactSheet: await stageAndVerify('TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_CONTACT_SHEET', contactPath, 'image/jpeg'),
  };

  process.stdout.write(`THE_PARTY_AGENCY_GEN_V04_RECOVERY_RESULT=${JSON.stringify({
    schemaVersion: 1,
    productionId: PRODUCTION_ID,
    status: 'GENERATED_REVIEW_REQUIRED',
    recoveryMode: 'POST_ONLY_FROM_PERSISTED_VEO_SHOTS',
    newProviderCalls: 0,
    provider: 'GOOGLE_VERTEX_VEO',
    providerModel: 'veo-3.1-generate-001',
    recoveredShots: recovered,
    outputs,
    technical,
    loudness,
    rightsStatus: 'UNVERIFIED_BLOCKED_FOR_MARKETING',
    publicationAuthorized: false,
    schedulingAuthorized: false,
    marketingReadyAuthorized: false,
    paidMediaAuthorized: false,
    exactReadback: true,
    authorizationRef: 'https://github.com/luizanunciostoca/toca-mcp-server/issues/622',
  })}\n`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function loadUniquePersistedShot(assetId: string): Promise<{ objectName: string; bytes: Uint8Array; sha256: string }> {
  const token = await cloudResolver.resolve(cloudRef);
  const prefix = `${RAW_PREFIX}${assetId}-`;
  const listUrl = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o`);
  listUrl.searchParams.set('prefix', prefix);
  listUrl.searchParams.set('fields', 'items(name,size),nextPageToken');
  const listed = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listed.ok) throw new Error(`RECOVERY_GCS_LIST_FAILED:${assetId}:${listed.status}`);
  const payload = (await listed.json()) as { items?: Array<{ name?: unknown; size?: unknown }>; nextPageToken?: unknown };
  const matches = (payload.items ?? []).filter((item): item is { name: string; size?: unknown } => typeof item.name === 'string' && item.name.startsWith(prefix) && item.name.endsWith('.mp4'));
  if (payload.nextPageToken || matches.length !== 1) throw new Error(`RECOVERY_RAW_SHOT_CARDINALITY:${assetId}:${matches.length}`);
  const objectName = matches[0]!.name;
  const mediaUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectName)}?alt=media`;
  const response = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`RECOVERY_GCS_DOWNLOAD_FAILED:${assetId}:${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isMp4(bytes)) throw new Error(`RECOVERY_RAW_SHOT_INVALID_MP4:${assetId}`);
  return { objectName, bytes, sha256: sha256(bytes) };
}

async function renderBrandedShot(input: { inputPath: string; logoPath: string; outputPath: string; headline: string; support: string; workspace: string; index: number }): Promise<void> {
  const headlinePath = join(input.workspace, `headline-${input.index}.txt`);
  const supportPath = join(input.workspace, `support-${input.index}.txt`);
  await writeFile(headlinePath, input.headline, 'utf8');
  await writeFile(supportPath, input.support, 'utf8');
  const filter = [
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=30,format=yuv420p[base]`,
    '[1:v]scale=250:-1[logo]',
    '[base][logo]overlay=(W-w)/2:36[branded]',
    `[branded]drawbox=x=(w-120)/2:y=h-282:w=120:h=2:color=${GOLD}@0.92:t=fill[rule]`,
    `[rule]drawtext=font='DejaVu Serif':textfile='${headlinePath}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-252:shadowcolor=black@0.85:shadowx=2:shadowy=2[headline]`,
    `[headline]drawtext=font='DejaVu Sans':textfile='${supportPath}':fontcolor=white@0.90:fontsize=22:x=(w-text_w)/2:y=h-178:shadowcolor=black@0.75:shadowx=1:shadowy=1[copy]`,
    `[copy]drawbox=x=0:y=0:w=w:h=h:color=white@0.30:t=fill:enable='between(t,3.92,4.00)'[outv]`,
  ].join(';');
  await runFfmpeg(['-y', '-threads', '1', '-i', input.inputPath, '-i', input.logoPath, '-filter_complex', filter, '-map', '[outv]', '-an', '-t', '4', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', input.outputPath], `brandShot${input.index + 1}`);
}

async function renderEndcard(input: { backgroundPath: string; logoPath: string; footerPath: string; outputPath: string; workspace: string }): Promise<void> {
  const line1 = join(input.workspace, 'end-line-1.txt');
  const line2 = join(input.workspace, 'end-line-2.txt');
  const time = join(input.workspace, 'end-time.txt');
  const location = join(input.workspace, 'end-location.txt');
  const cta = join(input.workspace, 'end-cta.txt');
  await Promise.all([
    writeFile(line1, 'DUAS PISTAS.', 'utf8'), writeFile(line2, 'UMA SÓ NOITE.', 'utf8'),
    writeFile(time, '23:59H ÀS 06H', 'utf8'), writeFile(location, 'MORRO DE SÃO PAULO', 'utf8'), writeFile(cta, 'VIVA AS DUAS', 'utf8'),
  ]);
  const filter = [
    `[0:v]scale=${WIDTH}:${HEIGHT},boxblur=10:1,eq=brightness=-0.40:saturation=0.72,drawbox=color=black@0.30:t=fill[bg]`,
    '[1:v]scale=300:-1[logo]', '[2:v]scale=560:-1[footer]', '[bg][logo]overlay=(W-w)/2:58[b1]',
    `[b1]drawtext=font='DejaVu Serif':textfile='${line1}':fontcolor=white:fontsize=62:x=(w-text_w)/2:y=420:shadowcolor=black@0.85:shadowx=2:shadowy=2[b2]`,
    `[b2]drawtext=font='DejaVu Serif':textfile='${line2}':fontcolor=${GOLD}:fontsize=62:x=(w-text_w)/2:y=492:shadowcolor=black@0.85:shadowx=2:shadowy=2[b3]`,
    `[b3]drawbox=x=(w-160)/2:y=585:w=160:h=2:color=${GOLD}@0.92:t=fill[b4]`,
    `[b4]drawtext=font='DejaVu Sans':textfile='${time}':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=620[b5]`,
    `[b5]drawtext=font='DejaVu Sans':textfile='${location}':fontcolor=white@0.92:fontsize=22:x=(w-text_w)/2:y=672[b6]`,
    `[b6]drawbox=x=(w-250)/2:y=742:w=250:h=62:color=black@0.35:t=fill[b7]`,
    `[b7]drawbox=x=(w-250)/2:y=742:w=250:h=62:color=${GOLD}@0.88:t=2[b8]`,
    `[b8]drawtext=font='DejaVu Serif':textfile='${cta}':fontcolor=${GOLD}:fontsize=28:x=(w-text_w)/2:y=758[b9]`,
    '[b9][footer]overlay=(W-w)/2:H-h-66[outv]',
  ].join(';');
  await runFfmpeg(['-y', '-threads', '1', '-loop', '1', '-i', input.backgroundPath, '-i', input.logoPath, '-i', input.footerPath, '-filter_complex', filter, '-map', '[outv]', '-an', '-t', '2', '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', input.outputPath], 'endcard');
}

async function concatCopy(paths: string[], outputPath: string, label: string): Promise<void> {
  const listPath = join(workspace, `concat-${label}.txt`);
  await writeFile(listPath, `${paths.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join('\n')}\n`, 'utf8');
  await runFfmpeg(['-y', '-threads', '1', '-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', listPath, '-an', '-c:v', 'copy', '-movflags', '+faststart', outputPath], `concat:${label}`);
}

async function writeSyntheticClubTrack(outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=55:sample_rate=48000:duration=18',
    '-f', 'lavfi', '-i', 'sine=frequency=110:sample_rate=48000:duration=18',
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.025:sample_rate=48000:duration=18',
    '-filter_complex', '[0:a]tremolo=f=2.0667:d=0.90,volume=0.34[k];[1:a]tremolo=f=4.1333:d=0.55,volume=0.10[b];[2:a]highpass=f=6500,tremolo=f=4.1333:d=0.70,volume=0.07[h];[k][b][h]amix=inputs=3:normalize=0,alimiter=limit=0.72,loudnorm=I=-17.5:TP=-2.8:LRA=7[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', outputPath,
  ], 'syntheticAudio');
}

async function stageAndVerify(assetId: string, sourcePath: string, contentType: 'video/mp4' | 'image/jpeg') {
  const stage = await stager.stage({ assetId, correlationId: 'the-party-agency-gen-v04-recovery', sourcePath, contentType });
  await assertExactReadback(stage.publicUrl, stage.sha256);
  return { objectName: stage.objectName, url: stage.publicUrl, sha256: stage.sha256, sizeBytes: stage.sizeBytes, contentType: stage.contentType };
}

async function assertExactReadback(url: string, expectedSha: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`RECOVERY_READBACK_HTTP:${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== expectedSha) throw new Error('RECOVERY_READBACK_SHA_MISMATCH');
}

async function probeVideo(path: string): Promise<unknown> {
  const { stdout } = await execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_name,codec_type,width,height,r_frame_rate,sample_rate,channels', '-of', 'json', path], { maxBuffer: 1024 * 1024 * 4 });
  return JSON.parse(stdout);
}

async function measureLoudness(path: string): Promise<Record<string, unknown>> {
  try {
    const { stderr } = await execFile('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 1024 * 1024 * 8 });
    const integrated = [...stderr.matchAll(/I:\s*(-?[0-9.]+) LUFS/g)].at(-1)?.[1] ?? null;
    const peak = [...stderr.matchAll(/Peak:\s*(-?[0-9.]+) dBFS/g)].at(-1)?.[1] ?? null;
    return { integratedLufs: integrated ? Number(integrated) : null, truePeakDbfs: peak ? Number(peak) : null };
  } catch (error) {
    return { measurementError: String(error) };
  }
}

async function runFfmpeg(args: string[], label: string): Promise<void> {
  try {
    await execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 16 });
  } catch (error) {
    throw new Error(`FFMPEG_RECOVERY_FAILED:${label}:${String(error)}`);
  }
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function isMp4(bytes: Uint8Array): boolean { return bytes.byteLength >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'; }
function requiredEnv(key: string): string { const value = process.env[key]?.trim(); if (!value) throw new Error(`ENV_REQUIRED:${key}`); return value; }
