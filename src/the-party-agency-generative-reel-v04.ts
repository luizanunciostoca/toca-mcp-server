import { createHash } from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { GoogleMetadataAccessTokenResolver } from './providers/gcp/google-metadata-access-token-resolver.js';
import { GoogleServiceIdentityOAuthResolver } from './providers/gcp/google-service-identity-oauth-resolver.js';
import { GcsPublicationAssetStager } from './providers/gcp/gcs-publication-asset-stager.js';
import { VertexVeoSceneContinuationVideoProvider } from './providers/gcp/vertex-veo-scene-continuation-video-provider.js';
import { GoogleDriveCreativeVideoSourceLoader } from './providers/google-drive/creative-video-source-loader.js';

const execFile = promisify(execFileCb);
const PRODUCTION_ID = 'VID-TP-20260904-AGENCY-GEN-004' as const;
const EDITION_ID = 'TP-20260904' as const;
const VISUAL_STANDARD = 'THE_PARTY_HYBRID_MINIMALIST_V1' as const;
const MODEL = 'veo-3.1-generate-001' as const;
const GOLD = '0xFFC629';
const WIDTH = 720;
const HEIGHT = 1280;
const SHOT_SECONDS = 4 as const;
const TARGET_SECONDS = 18;

const SOURCES = [
  {
    sourceAssetId: 'TP-0048',
    driveFileId: '1q0zeVdDPzA_odab4cDbi_CY8hRFVFROT',
    sha256: '1c8e62431be258cce8f77af7336b7c8a6cab0ef0c1fd82ba19d21aaa30fd3c01',
    headline: 'A NOITE COMEÇA AQUI.',
    support: 'Morro de São Paulo',
    prompt:
      'Create an elegant cinematic continuation of this real entrance photograph. Preserve the exact entrance, physical Toca and Corona signs, vegetation, materials, people and lighting. Use only a restrained forward camera push, subtle natural walking and body motion from the people already present, tiny foliage movement and realistic warm light breathing. Do not add people, do not invent venue geometry, do not alter signs or architecture, and do not make the entrance look like another venue.',
  },
  {
    sourceAssetId: 'TP-0087',
    driveFileId: '119XngFf39R1b9JhgDxhketwWRnZE0crm',
    sha256: 'f02b570987134e150a98d56bb12ecf141efee6c364571017bd92bacb8871fd55',
    headline: 'GENTE QUE FAZ A NOITE.',
    support: 'Encontro. Presença. Experiência.',
    prompt:
      'Create a premium cinematic continuation of this real friends-with-drinks nightlife photograph. Preserve each existing person and their identity, face, clothing, body proportions and drinks. Generate only physically plausible micro-expressions, breathing, tiny head and hand motion, subtle drink movement, shallow depth breathing and restrained ambient light movement. Do not add or remove people, do not morph faces, do not change bodies, and do not invent background architecture.',
  },
  {
    sourceAssetId: 'TP-0071',
    driveFileId: '1VjJHnQTpZrs3gTIZQImYrMK9vdqbg0VW',
    sha256: 'd4bdb6462f4963c97a84fe21ba76682d03b3f121eea5b2e4b2d7b4bef8cf7f6d',
    headline: 'O SOM TOMA CONTA.',
    support: 'Ritmo. Luz. Movimento.',
    prompt:
      'Create a realistic cinematic continuation of this real DJ performance photograph. Preserve the same DJ, booth, equipment, crowd and spatial layout. Animate only restrained DJ shoulder and hand movement, realistic mixer and deck LEDs, subtle crowd sway, haze and blue/purple light breathing, with a controlled micro push-in. Do not invent equipment, people, signage, stage elements or architecture. No warped hands and no aggressive camera movement.',
  },
  {
    sourceAssetId: 'TP-0130',
    driveFileId: '1wRkNvKPwA9c8y39yQgD7-ioswR-ewGbQ',
    sha256: 'ef92beddf5d56c18639992ff79631e24706c48daf878cf7a752412d924d5ca71',
    headline: 'A PISTA RESPONDE.',
    support: 'Duas pistas. Uma só noite.',
    prompt:
      'Create a cinematic continuation of this exact real packed dance-floor photograph. Preserve the existing people, ceiling, columns, DJ booth, drinks and venue geometry. Animate natural dancing, small hand and drink movement, subtle crowd rhythm, realistic light changes and a restrained push-in. Do not add new crowd members, do not morph faces or bodies, and do not invent architecture, ceiling height, equipment or stage geometry.',
  },
] as const;

const BRAND = {
  logo: {
    driveFileId: '1V09F8w1BcgwzONnZk1ROpOJACuDF2dPF',
    sha256: 'feb5a7db499640de9904432411d47f2c319e19129c09752f2c1402ae8ceff948',
  },
  footer: {
    driveFileId: '1hOq6jtk4jsuJLDPfO046qZCS5T1lv0g1',
    sha256: '4d4498d0b839bc5fe7a313b0743040106c43d127142018160cbeb8348c16c67b',
  },
} as const;

const projectId = requiredEnv('GCP_PROJECT_ID');
const bucketName = requiredEnv('INSTAGRAM_PUBLICATION_ASSET_BUCKET');
const driveResolver = new GoogleServiceIdentityOAuthResolver();
const driveTokenReference = { provider: 'gcp-service-identity-oauth', key: 'video-workspace' } as const;
const sourceLoader = new GoogleDriveCreativeVideoSourceLoader({
  secretResolver: driveResolver,
  accessTokenReference: driveTokenReference,
});
const cloudResolver = new GoogleMetadataAccessTokenResolver();
const provider = new VertexVeoSceneContinuationVideoProvider({
  projectId,
  artifactBucket: bucketName,
  accessTokenResolver: cloudResolver,
  accessTokenReference: { provider: 'gcp-metadata-oauth', key: 'cloud-platform' },
  location: 'us-central1',
  model: MODEL,
  pollIntervalMs: 15_000,
  maxPolls: 100,
});
const stager = new GcsPublicationAssetStager({
  projectId,
  bucketName,
  signedUrlTtlSeconds: 6 * 60 * 60,
});

const workspace = await mkdtemp(join(tmpdir(), 'toca-party-agency-v04-'));
try {
  const logo = await sourceLoader.load(BRAND.logo);
  const footer = await sourceLoader.load(BRAND.footer);
  const logoPath = join(workspace, 'the-party-logo.png');
  const footerPath = join(workspace, 'the-party-footer.png');
  await writeFile(logoPath, logo.bytes);
  await writeFile(footerPath, footer.bytes);

  const shotEvidence: Array<Record<string, unknown>> = [];
  const processedShotPaths: string[] = [];

  for (let index = 0; index < SOURCES.length; index += 1) {
    const sourceDef = SOURCES[index]!;
    const source = await sourceLoader.load({
      driveFileId: sourceDef.driveFileId,
      expectedSha256: sourceDef.sha256,
    });
    const contentItemId = `${PRODUCTION_ID}-S${String(index + 1).padStart(2, '0')}`;
    const approval = {
      exceptionId: `EXC-${PRODUCTION_ID}-S${String(index + 1).padStart(2, '0')}`,
      contentItemId,
      productId: 'THE_PARTY',
      operation: 'THE_PARTY',
      sourceAssetId: sourceDef.sourceAssetId,
      sourceSha256: sourceDef.sha256,
      requestedBy: 'luizanunciostoca',
      approvedBy: 'luizanunciostoca',
      approvalRef: 'https://github.com/luizanunciostoca/toca-mcp-server/issues/622',
      allowSceneContinuation: true as const,
      allowEnvironmentExpansion: false,
      allowArchitecturalInvention: false as const,
      allowAiLogoGeneration: false as const,
      peopleConsentConfirmed: false,
      status: 'APPROVED' as const,
      createdAt: new Date().toISOString(),
    };

    const result = await generateWithQuotaBackoff(() =>
      provider.generate({
        contentItemId,
        sourceAssetId: sourceDef.sourceAssetId,
        operation: 'THE_PARTY',
        productId: 'THE_PARTY',
        inheritedVisualStandardId: VISUAL_STANDARD,
        source,
        approval,
        prompt: sourceDef.prompt,
        seconds: SHOT_SECONDS,
        size: '720x1280',
        thePartyEditionId: EDITION_ID,
      }),
    );

    const shotRawPath = join(workspace, `shot-${index + 1}-raw.mp4`);
    const shotBrandedPath = join(workspace, `shot-${index + 1}-branded.mp4`);
    await writeFile(shotRawPath, result.outputBytes);
    await renderBrandedShot({
      inputPath: shotRawPath,
      logoPath,
      outputPath: shotBrandedPath,
      headline: sourceDef.headline,
      support: sourceDef.support,
      workspace,
      index,
    });
    processedShotPaths.push(shotBrandedPath);

    const shotStage = await stager.stage({
      assetId: `TP-AGENCY-V04-S${String(index + 1).padStart(2, '0')}`,
      correlationId: 'the-party-agency-gen-v04-shots',
      sourcePath: shotRawPath,
      contentType: 'video/mp4',
    });
    await assertExactReadback(shotStage.publicUrl, shotStage.sha256);
    shotEvidence.push({
      shot: index + 1,
      contentItemId,
      sourceAssetId: sourceDef.sourceAssetId,
      sourceDriveFileId: sourceDef.driveFileId,
      sourceSha256: sourceDef.sha256,
      outputSha256: result.outputSha256,
      provider: result.provider,
      providerModel: result.providerModel,
      providerJobId: result.providerJobId,
      stagedShotSha256: shotStage.sha256,
      stagedShotUrl: shotStage.publicUrl,
      headline: sourceDef.headline,
      support: sourceDef.support,
      requiresPostGenerationHumanReview: true,
    });
  }

  const sequencePath = join(workspace, 'sequence.mp4');
  await createShotSequence(processedShotPaths, sequencePath);

  const lastFramePath = join(workspace, 'end-bg.png');
  await runFfmpeg([
    '-y',
    '-sseof',
    '-0.10',
    '-i',
    processedShotPaths.at(-1)!,
    '-frames:v',
    '1',
    lastFramePath,
  ]);

  const endcardPath = join(workspace, 'endcard.mp4');
  await renderEndcard({
    backgroundPath: lastFramePath,
    logoPath,
    footerPath,
    outputPath: endcardPath,
    workspace,
  });

  const silentFinalPath = join(workspace, 'final-silent.mp4');
  await concatSequenceAndEndcard(sequencePath, endcardPath, silentFinalPath);

  const audioPath = join(workspace, 'original-club-track.wav');
  await writeSyntheticClubTrack(audioPath, TARGET_SECONDS, 124);

  const approvalPath = join(workspace, 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_APPROVAL.mp4');
  await runFfmpeg([
    '-y',
    '-i',
    silentFinalPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-af',
    'loudnorm=I=-17.5:TP=-2.8:LRA=7',
    '-shortest',
    '-t',
    String(TARGET_SECONDS),
    '-movflags',
    '+faststart',
    approvalPath,
  ]);

  const masterPath = join(workspace, 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_MASTER.mp4');
  await runFfmpeg([
    '-y',
    '-i',
    approvalPath,
    '-vf',
    'scale=1080:1920:flags=lanczos',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '17',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    masterPath,
  ]);

  const coverPath = join(workspace, 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_COVER.jpg');
  await runFfmpeg([
    '-y',
    '-ss',
    '16.4',
    '-i',
    masterPath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    coverPath,
  ]);

  const contactSheetPath = join(
    workspace,
    'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_CONTACT_SHEET.jpg',
  );
  await runFfmpeg([
    '-y',
    '-i',
    approvalPath,
    '-vf',
    "fps=1/3,scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2:black,tile=3x2",
    '-frames:v',
    '1',
    '-q:v',
    '2',
    contactSheetPath,
  ]);

  const technical = await probeVideo(approvalPath);
  const loudness = await measureLoudness(approvalPath);

  const approvalStage = await stager.stage({
    assetId: 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_APPROVAL',
    correlationId: 'the-party-agency-gen-v04',
    sourcePath: approvalPath,
    contentType: 'video/mp4',
  });
  const masterStage = await stager.stage({
    assetId: 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_MASTER',
    correlationId: 'the-party-agency-gen-v04',
    sourcePath: masterPath,
    contentType: 'video/mp4',
  });
  const coverStage = await stager.stage({
    assetId: 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_COVER',
    correlationId: 'the-party-agency-gen-v04',
    sourcePath: coverPath,
    contentType: 'image/jpeg',
  });
  const contactStage = await stager.stage({
    assetId: 'TOCA_THEPARTY_REEL_AGENCY_GENERATIVE_9x16_18s_v04_CONTACT_SHEET',
    correlationId: 'the-party-agency-gen-v04',
    sourcePath: contactSheetPath,
    contentType: 'image/jpeg',
  });

  for (const stage of [approvalStage, masterStage, coverStage, contactStage]) {
    await assertExactReadback(stage.publicUrl, stage.sha256);
  }

  process.stdout.write(
    `THE_PARTY_AGENCY_GEN_V04_RESULT=${JSON.stringify({
      schemaVersion: 1,
      productionId: PRODUCTION_ID,
      status: 'GENERATED_REVIEW_REQUIRED',
      provider: 'GOOGLE_VERTEX_VEO',
      providerModel: MODEL,
      editionId: EDITION_ID,
      visualStandardId: 'THE_PARTY_VIDEO_EDITORIAL_V1',
      baseFamily: VISUAL_STANDARD,
      sourceCount: SOURCES.length,
      shots: shotEvidence,
      outputs: {
        approval: stageSummary(approvalStage),
        master: stageSummary(masterStage),
        cover: stageSummary(coverStage),
        contactSheet: stageSummary(contactStage),
      },
      technical,
      loudness,
      rightsStatus: 'UNVERIFIED_BLOCKED_FOR_MARKETING',
      publicationAuthorized: false,
      schedulingAuthorized: false,
      marketingReadyAuthorized: false,
      paidMediaAuthorized: false,
      exactReadback: true,
      authorizationRef: 'https://github.com/luizanunciostoca/toca-mcp-server/issues/622',
    })}\n`,
  );
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function generateWithQuotaBackoff<T>(operation: () => Promise<T>): Promise<T> {
  const delays = [0, 60_000, 120_000, 180_000];
  let lastError: unknown;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]! > 0) await sleep(delays[attempt]!);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = String((error as { message?: unknown })?.message ?? error);
      const quotaError = /429|RESOURCE_EXHAUSTED|PROVIDER_RATE_LIMITED|RATE_LIMIT/iu.test(message);
      if (!quotaError || attempt + 1 >= delays.length) throw error;
      process.stdout.write(
        `THE_PARTY_AGENCY_GEN_V04_QUOTA_BACKOFF=${JSON.stringify({ attempt: attempt + 1, nextDelayMs: delays[attempt + 1] })}\n`,
      );
    }
  }
  throw lastError;
}

async function renderBrandedShot(input: {
  inputPath: string;
  logoPath: string;
  outputPath: string;
  headline: string;
  support: string;
  workspace: string;
  index: number;
}): Promise<void> {
  const headlinePath = join(input.workspace, `headline-${input.index}.txt`);
  const supportPath = join(input.workspace, `support-${input.index}.txt`);
  await writeFile(headlinePath, input.headline, 'utf8');
  await writeFile(supportPath, input.support, 'utf8');
  const filter = [
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=30,format=yuv420p[base]`,
    `[1:v]scale=250:-1[logo]`,
    `[base][logo]overlay=(W-w)/2:36[branded]`,
    `[branded]drawbox=x=(w-120)/2:y=h-282:w=120:h=2:color=${GOLD}@0.92:t=fill[rule]`,
    `[rule]drawtext=font='DejaVu Serif':textfile='${headlinePath}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h-252:shadowcolor=black@0.85:shadowx=2:shadowy=2[headline]`,
    `[headline]drawtext=font='DejaVu Sans':textfile='${supportPath}':fontcolor=white@0.90:fontsize=22:x=(w-text_w)/2:y=h-178:shadowcolor=black@0.75:shadowx=1:shadowy=1[outv]`,
  ].join(';');
  await runFfmpeg([
    '-y',
    '-i',
    input.inputPath,
    '-i',
    input.logoPath,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-an',
    '-t',
    String(SHOT_SECONDS),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    input.outputPath,
  ]);
}

async function createShotSequence(paths: string[], outputPath: string): Promise<void> {
  if (paths.length !== 4) throw new Error('THE_PARTY_AGENCY_GEN_V04_SHOT_COUNT_INVALID');
  const args = ['-y'];
  for (const path of paths) args.push('-i', path);
  const filter = [
    '[0:v]settb=AVTB[v0]',
    '[1:v]settb=AVTB[v1]',
    '[2:v]settb=AVTB[v2]',
    '[3:v]settb=AVTB[v3]',
    '[v0][v1]xfade=transition=fade:duration=0.20:offset=3.80[v01]',
    '[v01][v2]xfade=transition=fade:duration=0.20:offset=7.60[v012]',
    '[v012][v3]xfade=transition=fade:duration=0.20:offset=11.40[outv]',
  ].join(';');
  args.push(
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  );
  await runFfmpeg(args);
}

async function renderEndcard(input: {
  backgroundPath: string;
  logoPath: string;
  footerPath: string;
  outputPath: string;
  workspace: string;
}): Promise<void> {
  const line1 = join(input.workspace, 'end-line-1.txt');
  const line2 = join(input.workspace, 'end-line-2.txt');
  const time = join(input.workspace, 'end-time.txt');
  const location = join(input.workspace, 'end-location.txt');
  const cta = join(input.workspace, 'end-cta.txt');
  await Promise.all([
    writeFile(line1, 'DUAS PISTAS.', 'utf8'),
    writeFile(line2, 'UMA SÓ NOITE.', 'utf8'),
    writeFile(time, '23:59H ÀS 06H', 'utf8'),
    writeFile(location, 'MORRO DE SÃO PAULO', 'utf8'),
    writeFile(cta, 'VIVA AS DUAS', 'utf8'),
  ]);
  const filter = [
    `[0:v]scale=${WIDTH}:${HEIGHT},boxblur=12:2,eq=brightness=-0.38:saturation=0.70,drawbox=color=black@0.28:t=fill[bg]`,
    '[1:v]scale=300:-1[logo]',
    '[2:v]scale=560:-1[footer]',
    '[bg][logo]overlay=(W-w)/2:58[b1]',
    `[b1]drawtext=font='DejaVu Serif':textfile='${line1}':fontcolor=white:fontsize=62:x=(w-text_w)/2:y=420:shadowcolor=black@0.85:shadowx=2:shadowy=2[b2]`,
    `[b2]drawtext=font='DejaVu Serif':textfile='${line2}':fontcolor=${GOLD}:fontsize=62:x=(w-text_w)/2:y=492:shadowcolor=black@0.85:shadowx=2:shadowy=2[b3]`,
    `[b3]drawbox=x=(w-160)/2:y=585:w=160:h=2:color=${GOLD}@0.92:t=fill[b4]`,
    `[b4]drawtext=font='DejaVu Sans':textfile='${time}':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=620[b5]`,
    `[b5]drawtext=font='DejaVu Sans':textfile='${location}':fontcolor=white@0.92:fontsize=22:x=(w-text_w)/2:y=672[b6]`,
    `[b6]drawbox=x=(w-250)/2:y=742:w=250:h=62:color=black@0.35:t=fill:color=${GOLD}@0.85[b7]`,
    `[b7]drawtext=font='DejaVu Serif':textfile='${cta}':fontcolor=${GOLD}:fontsize=28:x=(w-text_w)/2:y=758[b8]`,
    '[b8][footer]overlay=(W-w)/2:H-h-66[outv]',
  ].join(';');
  await runFfmpeg([
    '-y',
    '-loop',
    '1',
    '-i',
    input.backgroundPath,
    '-i',
    input.logoPath,
    '-i',
    input.footerPath,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-an',
    '-t',
    '2.60',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    input.outputPath,
  ]);
}

async function concatSequenceAndEndcard(
  sequencePath: string,
  endcardPath: string,
  outputPath: string,
): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    sequencePath,
    '-i',
    endcardPath,
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1:a=0[outv]',
    '-map',
    '[outv]',
    '-an',
    '-t',
    String(TARGET_SECONDS),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
}

async function writeSyntheticClubTrack(path: string, seconds: number, bpm: number): Promise<void> {
  const sampleRate = 48_000;
  const totalSamples = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(totalSamples * 2 * 2);
  const beat = 60 / bpm;
  let seed = 0x5a17f00d >>> 0;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const beatIndex = Math.floor(t / beat);
    const beatPhase = t - beatIndex * beat;
    const eighth = beat / 2;
    const eighthPhase = t - Math.floor(t / eighth) * eighth;
    let sample = 0;

    if (beatPhase < 0.20) {
      const env = Math.exp(-beatPhase * 20);
      const freq = 48 + 70 * Math.exp(-beatPhase * 30);
      sample += Math.sin(2 * Math.PI * freq * beatPhase) * env * 0.78;
    }

    if (beatIndex % 4 === 1 || beatIndex % 4 === 3) {
      if (beatPhase < 0.11) {
        const env = Math.exp(-beatPhase * 30);
        sample += (random() * 2 - 1) * env * 0.22;
        sample += Math.sin(2 * Math.PI * 190 * beatPhase) * env * 0.08;
      }
    }

    if (eighthPhase < 0.045) {
      const env = Math.exp(-eighthPhase * 70);
      sample += (random() * 2 - 1) * env * 0.08;
    }

    const bassPhase = (t + beat * 0.5) % (beat * 2);
    if (bassPhase < beat * 0.72) {
      const env = Math.min(1, bassPhase * 30) * Math.exp(-bassPhase * 1.7);
      const notes = [55, 55, 65.41, 49];
      const note = notes[Math.floor(t / (beat * 2)) % notes.length]!;
      sample += Math.sin(2 * Math.PI * note * t) * env * 0.22;
    }

    for (const impact of [3.8, 7.6, 11.4, 15.4]) {
      const d = t - impact;
      if (d >= 0 && d < 0.18) {
        const env = Math.exp(-d * 18);
        sample += Math.sin(2 * Math.PI * 42 * d) * env * 0.45;
        sample += (random() * 2 - 1) * env * 0.10;
      }
    }

    const introGain = Math.min(1, t / 1.4);
    const outroGain = Math.min(1, Math.max(0, (seconds - t) / 0.6));
    sample *= introGain * outroGain;
    sample = Math.max(-0.92, Math.min(0.92, sample));
    const left = Math.round(sample * 32767);
    const right = Math.round(sample * (0.96 + 0.04 * Math.sin(t * 0.7)) * 32767);
    const offset = i * 4;
    data.writeInt16LE(left, offset);
    data.writeInt16LE(right, offset + 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  await writeFile(path, Buffer.concat([header, data]));
}

async function probeVideo(path: string): Promise<Record<string, unknown>> {
  const { stdout } = await execFile('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=index,codec_type,codec_name,width,height,r_frame_rate',
    '-of',
    'json',
    path,
  ]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function measureLoudness(path: string): Promise<Record<string, string | null>> {
  const result = await execFile('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-af',
    'loudnorm=I=-17.5:TP=-2.8:LRA=7:print_format=json',
    '-f',
    'null',
    '-',
  ]).catch((error: unknown) => error as { stderr?: string });
  const stderr = String((result as { stderr?: unknown })?.stderr ?? '');
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/u);
  if (!match) return { integratedLufs: null, truePeakDbfs: null };
  const parsed = JSON.parse(match[0]) as { input_i?: string; input_tp?: string };
  return {
    integratedLufs: parsed.input_i ?? null,
    truePeakDbfs: parsed.input_tp ?? null,
  };
}

async function assertExactReadback(url: string, expectedSha256: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`THE_PARTY_AGENCY_GEN_V04_READBACK_FAILED:${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const observed = sha256(bytes);
  if (observed !== expectedSha256.toLowerCase()) {
    throw new Error('THE_PARTY_AGENCY_GEN_V04_READBACK_HASH_MISMATCH');
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const detail = String((error as { stderr?: unknown })?.stderr ?? error).slice(0, 1800);
    throw new Error(`THE_PARTY_AGENCY_GEN_V04_FFMPEG_FAILED:${detail}`);
  }
}

function stageSummary(stage: {
  objectName: string;
  publicUrl: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
}) {
  return {
    objectName: stage.objectName,
    url: stage.publicUrl,
    contentType: stage.contentType,
    sizeBytes: stage.sizeBytes,
    sha256: stage.sha256,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`THE_PARTY_AGENCY_GEN_V04_ENV_REQUIRED:${key}`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
