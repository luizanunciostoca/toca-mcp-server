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

async function executeReconciliation(options: MockOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'toca-registry-reconcile-'));
  const baselineRow = canonicalRow();
  let liveRow = canonicalRow(options.rowOverrides);
  const headers = Object.keys(baselineRow);
  let batchUpdateCount = 0;
  let appendCount = 0;

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
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
          next[header] = value === undefined || value === null ? '' : String(value);
        }
        liveRow = next;
      }
      response.end(JSON.stringify({ totalUpdatedCells: payload.data?.length ?? 0 }));
      return;
    }

    if (request.method === 'POST' && url.pathname.includes(':append')) {
      appendCount += 1;
      response.end(JSON.stringify({ updates: { updatedRows: 1 } }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
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
      const child = spawn(process.execPath, [script, 'reconcile-publication'], {
        cwd: directory,
        env: {
          ...process.env,
          GOOGLE_ACCESS_TOKEN: 'test-token',
          MARKETING_AUTOPILOT_POLICY_PATH: policyPath,
          MARKETING_AUTOPILOT_COMMAND_PATH: commandPath,
          MARKETING_AUTOPILOT_CONTENT_ITEM_ID: contentItemId,
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

  return { result, evidence, row: liveRow, batchUpdateCount, appendCount };
}

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
