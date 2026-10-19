import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const script = join(repoRoot, 'scripts/marketing-autopilot-registry.mjs');
const contentItemId = 'MKT-20260917-SUNSET-FEED-0900';
const correlationId = 'CORR-MKT-20260917-SUNSET-FEED-0900-ROLLOVER-V1';
const idempotencyKey = `GCP-AUTOPILOT-${contentItemId}-a495fa29db54-V1`;
const driveFileId = '1uFK4y1fqUHi-m4qn6m-TB-ehBC0Y7JOK';
const assetSha = 'a495fa29db54dc2af24700b0556e8a6d1fb01472c333067c91ee6d613525e4e6';
const providerId = '17899999999999999';
const openServers = new Set<ReturnType<typeof createServer>>();

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  openServers.clear();
});

type Row = Record<string, string>;

type MockOptions = {
  mode?: 'reconcile-publication' | 'record-precheck';
  row?: Row;
  rowOverrides?: Row;
  staleReadback?: boolean;
  publicationOverrides?: Record<string, unknown>;
  reconciliationOverrides?: Record<string, unknown>;
};

function canonicalRow(overrides: Row = {}): Row {
  return {
    content_item_id: contentItemId,
    status: 'PRODUCED',
    approval_status: 'APPROVED',
    approval_mode: 'EXPLICIT_APPROVAL',
    publication_id: '',
    provider_external_id: '',
    execution_id: '',
    correlation_id: correlationId,
    last_error: '',
    updated_at: '2026-09-12T18:10:00-03:00',
    command_id: '',
    permalink: '',
    prepared_request_sha256: '',
    production_idempotency_key: '',
    registry_revision: '',
    decision_reason: '',
    scheduled_run_id: '',
    scheduling_mode: '',
    scheduling_status: '',
    scheduling_evidence: '',
    scheduling_policy: '',
    publication_intent: '',
    toca_scheduled_at: '',
    scheduler_backend: '',
    provider_status: '',
    master_drive_file_id: driveFileId,
    output_sha256: assetSha,
    ...overrides,
  };
}

function futureCanaryRow(overrides: Row = {}): Row {
  // CONTENT_ITEMS row 387 with the scheduling status required for the parent handoff.
  return {
    content_item_id: 'MKT-20261019-SUNSET-FEED-1500',
    scheduled_at: '2026-10-19T15:00:00-03:00',
    timezone: 'America/Bahia',
    operation: 'SUNSET',
    channel: 'INSTAGRAM',
    format: 'FEED',
    message:
      'O sol encontra o horizonte e o mar guarda cada tom desse encontro. Simples assim, extraordinário assim. 🌅 #TocaDoMorcego #PorDoSol #MorroDeSaoPaulo',
    cta: 'Planeje seu próximo fim de tarde na Toca.',
    status: 'PRODUCED',
    approval_status: 'APPROVED',
    approval_mode: 'EXPLICIT_APPROVAL',
    creative_id: 'CR-MKT-20261019-SUNSET-FEED-1500-PHOTO4X5-CANDIDATE-V1',
    copy_id: 'CP-MKT-20261019-SUNSET-FEED-1500-V1',
    correlation_id: 'CORR-MKT-20261019-SUNSET-FEED-1500-V1',
    master_asset_id: 'MM-SUN-0002-FEED4X5-202610-JPG-V1',
    master_drive_file_id: '1ZEAfWGayrkWLLsldsIM_OBFwIstnSAyA',
    master_status: 'MASTER_READY',
    creative_standard_id: 'SUNSET_FEED_V1',
    creative_standard_version: '1.0',
    creative_truth_policy_id: 'TOCA_CREATIVE_TRUTH_POLICY_V1',
    brand_integrity_status: 'PASSED',
    venue_fidelity_status: 'PASSED',
    quality_gate_status: 'PASSED',
    exact_asset_binding: 'TRUE',
    output_sha256: '2b92b4c79c9e34040f65133a0b92957a59236a6d560c4e325bdd3743939b3f18',
    scheduling_status: 'CANARY_READY',
    scheduling_policy: '',
    publication_id: '',
    provider_external_id: '',
    provider_status: '',
    ...overrides,
  };
}

function hashSnapshot(row: Row): string {
  const entries = Object.entries(row)
    .map(([key, value]) => [key, value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(entries)))
    .digest('hex');
}

function columnIndex(column: string): number {
  return [...column].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0) - 1;
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  return body;
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

async function executeReconciliation(options: MockOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'toca-registry-reconcile-'));
  const baselineRow = options.row ?? canonicalRow();
  let liveRow = { ...baselineRow, ...options.rowOverrides };
  const headers = Object.keys(baselineRow);
  let batchUpdateCount = 0;
  let appendCount = 0;
  const appendedRows: unknown[][] = [];

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('Content-Type', 'application/json');

    if (request.method === 'GET' && url.pathname.includes('/values/')) {
      response.end(
        JSON.stringify({ values: [headers, headers.map((header) => liveRow[header] ?? '')] }),
      );
      return;
    }

    if (request.method === 'POST' && url.pathname.endsWith('/values:batchUpdate')) {
      batchUpdateCount += 1;
      const payload = JSON.parse(await readBody(request)) as {
        data?: Array<{ range?: string; values?: unknown[][] }>;
      };
      if (!options.staleReadback) {
        const next = { ...liveRow };
        for (const update of payload.data ?? []) {
          const match = update.range?.match(/!([A-Z]+)\d+$/);
          if (!match) continue;
          const column = match[1];
          if (!column) continue;
          const header = headers[columnIndex(column)];
          if (!header) continue;
          const value = update.values?.[0]?.[0];
          next[header] = cellText(value);
        }
        liveRow = next;
      }
      response.end(JSON.stringify({ totalUpdatedCells: payload.data?.length ?? 0 }));
      return;
    }

    if (request.method === 'POST' && url.pathname.includes(':append')) {
      appendCount += 1;
      const payload = JSON.parse(await readBody(request)) as { values?: unknown[][] };
      appendedRows.push(...(payload.values ?? []));
      response.end(JSON.stringify({ updates: { updatedRows: 1 } }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : 'mock failure' }),
      );
    });
  });
  openServers.add(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  const policyPath = join(directory, 'policy.json');
  const commandPath = join(directory, 'command.json');
  const publicationPath = join(directory, 'publication.json');
  const reconciliationPath = join(directory, 'reconciliation.json');
  writeFileSync(
    policyPath,
    JSON.stringify({
      schemaVersion: 1,
      policyId: 'TEST_AUTOPILOT_POLICY',
      spreadsheetId: 'test-sheet',
      contentSheet: 'CONTENT_ITEMS',
      schedulerExecutionLogSheet: 'SCHEDULER_EXECUTION_LOG',
      canonicalWriter: { workflow: '.github/workflows/marketing-publish-now.yml' },
    }),
  );
  writeFileSync(
    commandPath,
    JSON.stringify({
      schemaVersion: 1,
      commandId: 'autopilot-test-command',
      action: 'PUBLISH_NOW',
      contentItemId,
      correlationId,
      idempotencyKey,
      driveFileId,
      expectedAssetSha256: assetSha,
      scheduledAt: '2026-09-17T09:00:00-03:00',
      schedulerBinding: {
        source: 'MARKETING_AUTOPILOT_GCP',
        sourceRunId: '777001',
        registrySnapshotSha256: hashSnapshot(baselineRow),
      },
    }),
  );
  writeFileSync(
    publicationPath,
    JSON.stringify({
      status: 'PUBLISHED',
      publicationId: providerId,
      correlationId,
      idempotencyKey,
      permalink: 'https://www.instagram.com/p/test/',
      ...options.publicationOverrides,
    }),
  );
  writeFileSync(
    reconciliationPath,
    JSON.stringify({
      outcome: 'PUBLISHED_VERIFIED',
      providerReadbackAttempted: true,
      readbackExitCode: 0,
      writeCapabilityDisabledAfterAttempt: true,
      finalWriteCapabilityDisabled: true,
      finalDisableVerificationExitCode: 0,
      approvedRequestSha256: 'b'.repeat(64),
      ...options.reconciliationOverrides,
    }),
  );

  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(process.execPath, [script, options.mode ?? 'reconcile-publication'], {
        cwd: directory,
        env: {
          ...process.env,
          GOOGLE_ACCESS_TOKEN: 'test-token',
          MARKETING_AUTOPILOT_POLICY_PATH: policyPath,
          MARKETING_AUTOPILOT_COMMAND_PATH: commandPath,
          MARKETING_AUTOPILOT_CONTENT_ITEM_ID: baselineRow.content_item_id ?? contentItemId,
          MARKETING_AUTOPILOT_PUBLICATION_EVIDENCE: publicationPath,
          MARKETING_AUTOPILOT_RECONCILIATION_EVIDENCE: reconciliationPath,
          MARKETING_AUTOPILOT_SHEETS_BASE_URL: `http://127.0.0.1:${address.port}`,
          GITHUB_RUN_ID: '888002',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += String(chunk)));
      child.stderr.on('data', (chunk) => (stderr += String(chunk)));
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    },
  );

  const evidence = JSON.parse(
    readFileSync(join(directory, 'marketing-autopilot-registry-reconciliation.json'), 'utf8'),
  ) as { status?: string; schedulerRunId?: string; writerRunId?: string; error?: string };

  return { result, evidence, row: liveRow, batchUpdateCount, appendCount, appendedRows };
}

describe('Marketing Autopilot future canary precheck', () => {
  it('records the approved Oct19 row with CANARY_READY without changing publication state', async () => {
    const row = futureCanaryRow();
    const run = await executeReconciliation({ mode: 'record-precheck', row });
    expect(run.result.status, run.result.stderr).toBe(0);
    expect(run.evidence).toMatchObject({
      status: 'PRECHECK_RECORDED',
      contentItemId: row.content_item_id,
    });
    expect(run.batchUpdateCount).toBe(0);
    expect(run.appendCount).toBe(1);
    expect(run.appendedRows[0]?.slice(2, 14)).toEqual([
      row.content_item_id,
      '888002',
      'GITHUB_ACTIONS_CONTROL_PLANE',
      row.scheduled_at,
      'PRECHECK',
      'CANARY_READY',
      '0',
      '0',
      '',
      'NOT_CALLED',
      '',
      '',
    ]);
    expect(run.row).toEqual(row);
  });

  it('still rejects the Oct19 row with missing scheduling metadata before any Registry write', async () => {
    const row = futureCanaryRow({ scheduling_status: '' });
    const run = await executeReconciliation({ mode: 'record-precheck', row });
    expect(run.result.status).not.toBe(0);
    expect(run.evidence.error).toBe('AUTOPILOT_PRECHECK_SCHEDULING_STATUS_INVALID:');
    expect(run.batchUpdateCount).toBe(0);
    expect(run.appendCount).toBe(0);
    expect(run.row).toEqual(row);
  });
});

describe('Marketing Autopilot registry reconciliation', () => {
  it('marks PUBLISHED only after verified provider/readback/write-disable evidence', async () => {
    const run = await executeReconciliation();
    expect(run.result.status, run.result.stderr).toBe(0);
    expect(run.batchUpdateCount).toBe(1);
    expect(run.appendCount).toBe(1);
    expect(run.row).toMatchObject({
      status: 'PUBLISHED',
      publication_id: providerId,
      provider_external_id: providerId,
      provider_status: 'PUBLISHED',
      scheduled_run_id: '777001',
      execution_id: 'GH-888002',
      correlation_id: correlationId,
    });
    expect(run.evidence).toMatchObject({
      status: 'PUBLISHED_RECONCILED',
      schedulerRunId: '777001',
      writerRunId: '888002',
    });
  });

  it('rejects replayed or mismatched provider evidence without mutating the Registry', async () => {
    const run = await executeReconciliation({
      publicationOverrides: { idempotencyKey: 'GCP-AUTOPILOT-REPLAYED' },
    });
    expect(run.result.status).not.toBe(0);
    expect(run.batchUpdateCount).toBe(0);
    expect(run.evidence.status).toBe('RECONCILIATION_REQUIRED');
    expect(run.evidence.error).toContain('AUTOPILOT_PROVIDER_IDEMPOTENCY_MISMATCH');
  });

  it('rejects failed write-disable evidence before any Registry mutation', async () => {
    const run = await executeReconciliation({
      reconciliationOverrides: { finalWriteCapabilityDisabled: false },
    });
    expect(run.result.status).not.toBe(0);
    expect(run.batchUpdateCount).toBe(0);
    expect(run.evidence.error).toContain('AUTOPILOT_FINAL_WRITE_DISABLE_REQUIRED');
  });

  it('rejects concurrent Registry drift using the bound snapshot hash', async () => {
    const run = await executeReconciliation({ rowOverrides: { output_sha256: '0'.repeat(64) } });
    expect(run.result.status).not.toBe(0);
    expect(run.batchUpdateCount).toBe(0);
    expect(run.evidence.error).toContain('AUTOPILOT_REGISTRY_SNAPSHOT_DRIFT');
  });

  it('fails reconciliation when post-write Registry readback does not confirm the mutation', async () => {
    const run = await executeReconciliation({ staleReadback: true });
    expect(run.result.status).not.toBe(0);
    expect(run.batchUpdateCount).toBe(1);
    expect(run.evidence.status).toBe('RECONCILIATION_REQUIRED');
    expect(run.evidence.error).toContain('AUTOPILOT_REGISTRY_STATUS_READBACK_FAILED');
  });
});
