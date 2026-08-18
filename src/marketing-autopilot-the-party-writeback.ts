import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { GoogleSheetsRestClient } from './providers/google-sheets/client.js';
import { GoogleSheetsThePartyContentWriteback } from './providers/google-sheets/the-party-content-writeback.js';

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(await readFile(args.manifest, 'utf8')) as unknown;
const outputBytes = await readFile(args.output);
const observedOutputSha256 = createHash('sha256').update(outputBytes).digest('hex');

const sheetsTokenEnvKey = requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
const secrets = new EnvironmentSecretResolver(process.env);
const sheets = new GoogleSheetsRestClient(secrets, {
  tokenReference: { provider: 'env', key: sheetsTokenEnvKey },
});
const writeback = new GoogleSheetsThePartyContentWriteback(sheets);

const result = await writeback.writeFinalCreativeTruthEvidence({
  contentItemId: args.contentItemId,
  manifest,
  observedOutputSha256,
});

process.stdout.write(
  `${JSON.stringify({
    ...result,
    outputPath: args.output,
    manifestPath: args.manifest,
    observedOutputSizeBytes: outputBytes.byteLength,
    publicationAuthorized: false,
  })}\n`,
);

interface CliArgs {
  readonly contentItemId: string;
  readonly manifest: string;
  readonly output: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error('THE_PARTY_WRITEBACK_ARGS_INVALID');
    }
    values.set(key.slice(2), value);
  }

  return {
    contentItemId: required(values, 'content-item-id'),
    manifest: required(values, 'manifest'),
    output: required(values, 'output'),
  };
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`THE_PARTY_WRITEBACK_ARG_REQUIRED:${key}`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`THE_PARTY_WRITEBACK_ENV_REQUIRED:${key}`);
  return value;
}
