import type { CreativeMode } from './contracts/creative-truth.js';
import { EnvironmentSecretResolver } from './core/secrets.js';
import { THE_PARTY_HYBRID_NETWORKS_STANDARD_ID } from './creative/the-party-visual-family-resolver.js';
import { GoogleSheetsRestClient } from './providers/google-sheets/client.js';
import { GoogleSheetsThePartyContentOrchestration } from './providers/google-sheets/the-party-content-orchestration.js';

const args = parseArgs(process.argv.slice(2));
const sheetsTokenEnvKey = requiredEnv('GOOGLE_SHEETS_ACCESS_TOKEN_ENV_KEY');
const secrets = new EnvironmentSecretResolver(process.env);
const sheets = new GoogleSheetsRestClient(secrets, {
  tokenReference: { provider: 'env', key: sheetsTokenEnvKey },
});
const orchestration = new GoogleSheetsThePartyContentOrchestration(sheets);
const record = await orchestration.get(args.contentItemId);

if (record.standardId === THE_PARTY_HYBRID_NETWORKS_STANDARD_ID && !record.environment) {
  process.stdout.write(
    `${JSON.stringify({
      status: 'BLOCKED_NEEDS_ENVIRONMENT',
      contentItemId: record.contentItemId,
      editionId: record.editionId,
      thePartyIntent: record.intent,
      creativeStandardId: record.standardId,
      creativeStandardVersion: record.standardVersion,
      visualStandardStatus: record.visualStandardStatus,
      environmentStatus: record.editionEnvironmentStatus,
      executableCreativeTruthResolution: false,
      publicationAuthorized: false,
    })}\n`,
  );
  process.exit(0);
}

const resolverInput = await orchestration.buildCreativeTruthResolutionInput(record.contentItemId, {
  ...(args.requestedMode ? { requestedMode: args.requestedMode } : {}),
});

process.stdout.write(
  `${JSON.stringify({
    status: 'READY_FOR_CREATIVE_TRUTH_RESOLUTION',
    contentItemId: record.contentItemId,
    editionId: record.editionId,
    persistedVisualStandardStatus: record.persistedVisualStandardStatus,
    effectiveVisualStandardStatus: record.visualStandardStatus,
    environmentSource: record.environmentSource ?? null,
    resolverInput,
    creativeTruthGatesSatisfied: false,
    publicationAuthorized: false,
  })}\n`,
);

interface CliArgs {
  readonly contentItemId: string;
  readonly requestedMode?: CreativeMode;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error('THE_PARTY_CONTEXT_ARGS_INVALID');
    }
    values.set(key.slice(2), value);
  }

  const requestedMode = values.get('requested-mode')?.trim();
  return {
    contentItemId: required(values, 'content-item-id'),
    ...(requestedMode ? { requestedMode: parseCreativeMode(requestedMode) } : {}),
  };
}

function parseCreativeMode(value: string): CreativeMode {
  if (
    value === 'REAL_COMPOSITE' ||
    value === 'REAL_PLUS_ENHANCEMENT' ||
    value === 'GENERATIVE_EXCEPTION'
  ) {
    return value;
  }
  throw new Error('THE_PARTY_CONTEXT_REQUESTED_MODE_INVALID');
}

function required(values: ReadonlyMap<string, string>, key: string): string {
  const value = values.get(key)?.trim();
  if (!value) throw new Error(`THE_PARTY_CONTEXT_ARG_REQUIRED:${key}`);
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`THE_PARTY_CONTEXT_ENV_REQUIRED:${key}`);
  return value;
}
