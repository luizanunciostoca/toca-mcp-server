import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-gcp-publication-execution-readiness.yml',
  'utf8',
);
const gateway = readFileSync(
  '.github/workflows/instagram-gcp-execution-readiness-owner-command-gateway.yml',
  'utf8',
);
const probe = readFileSync('src/instagram-publication-execution-readiness.ts', 'utf8');

describe('Instagram GCP execution-runtime readiness', () => {
  it('is reusable-only and revalidates the exact owner issue event against protected main', () => {
    expect(workflow).toContain('workflow_call:');
    expect(workflow).not.toContain('workflow_dispatch:');
    expect(workflow).toContain('expected_source_sha:');
    expect(workflow).toContain('test "$GITHUB_EVENT_NAME" = \'issue_comment\'');
    expect(workflow).toContain('test "$GITHUB_REF" = \'refs/heads/main\'');
    expect(workflow).toContain('test "$EVENT_ISSUE_NUMBER" = \'869\'');
    expect(workflow).toContain('test "$GITHUB_ACTOR" = \'luizanunciostoca\'');
    expect(workflow).toContain('test "$COMMENT_AUTHOR" = \'luizanunciostoca\'');
    expect(workflow).toContain('test "$COMMENT_ASSOCIATION" = \'OWNER\'');
    expect(workflow).toContain('test "$EXPECTED_SOURCE_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain(
      'expected_command="AUTHORIZE_GCP_INSTAGRAM_EXECUTION_RUNTIME_READINESS ${GITHUB_SHA}"',
    );
    expect(workflow).toContain('test "$COMMENT_BODY" = "$expected_command"');
    expect(workflow).not.toMatch(/on:\s*\n\s*push:/);
    expect(workflow).not.toContain('schedule:');
  });

  it('uses Cloud Run with the production runtime identity, exact Cloud SQL and pinned DB secret', () => {
    expect(workflow).toContain(
      'GCP_RUNTIME_SERVICE_ACCOUNT: toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
    );
    expect(workflow).toContain(
      'CLOUD_SQL_INSTANCE: toca-mcp-production:southamerica-east1:toca-mcp-db',
    );
    expect(workflow).toContain('DATABASE_SECRET_ID: toca-database-url');
    expect(workflow).toContain("DATABASE_SECRET_VERSION: '1'");
    expect(workflow).toContain('test "$DATABASE_SECRET_VERSION" = \'1\'');
    expect(workflow).toContain('--service-account "$GCP_RUNTIME_SERVICE_ACCOUNT"');
    expect(workflow).toContain('--set-cloudsql-instances "$CLOUD_SQL_INSTANCE"');
    expect(workflow).toContain(
      '--set-env-vars "SOURCE_SHA=$GITHUB_SHA,EXPECTED_CLOUD_SQL_INSTANCE=$CLOUD_SQL_INSTANCE"',
    );
    expect(workflow).toContain(
      '--set-secrets "DATABASE_URL=$DATABASE_SECRET_ID:$DATABASE_SECRET_VERSION"',
    );
    expect(workflow).not.toContain('DATABASE_URL=$DATABASE_SECRET_ID:latest');
    expect(workflow).not.toContain('META_ACCESS_TOKEN');
    expect(workflow).not.toContain('META_APP_SECRET');
    expect(workflow).not.toContain('/media_publish');
  });

  it('binds execution to the build-produced digest and verifies the remote tag before deployment', () => {
    const setupBuildx = workflow.indexOf(
      'docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f',
    );
    const build = workflow.indexOf('docker buildx build');
    expect(setupBuildx).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(setupBuildx);
    expect(workflow).toContain('driver: docker-container');
    expect(workflow).toContain('docker buildx build');
    expect(workflow).toContain('--metadata-file /tmp/build-metadata.json');
    expect(workflow).toContain('."containerimage.digest" // empty');
    expect(workflow).toContain('REMOTE_DIGEST=');
    expect(workflow).toContain('test "$REMOTE_DIGEST" = "$IMAGE_DIGEST"');
    expect(workflow).toContain('IMMUTABLE_IMAGE=${IMAGE_REPOSITORY}@${IMAGE_DIGEST}');
    expect(workflow).toContain('--image "$IMMUTABLE_IMAGE"');
    expect(workflow).toContain('--args dist/src/instagram-publication-execution-readiness.js');
    expect(workflow).toContain('.imageDigest | startswith("sha256:")');
  });

  it('forces the database probe into a read-only transaction and never executes mutating SQL', () => {
    expect(probe).toContain("client.query('begin read only')");
    expect(probe).toContain("current_setting('transaction_read_only')");
    expect(probe).toContain("client.query('rollback')");
    expect(probe).toContain("to_regclass('public.provider_publications')");
    expect(probe).toContain("to_regclass('public.audit_events')");
    expect(probe).toContain(
      "has_table_privilege(current_user, 'public.provider_publications', 'INSERT')",
    );
    expect(probe).toContain(
      "has_table_privilege(current_user, 'public.provider_publications', 'UPDATE')",
    );
    expect(probe).toContain("has_table_privilege(current_user, 'public.audit_events', 'INSERT')");
    expect(probe).toContain('databaseMutationAttempted: false');
    expect(probe).toContain('providerCredentialsMounted: false');
    expect(probe).toContain('providerWriteAttempted: false');
    expect(probe).not.toMatch(/client\.query\(\s*[`'"]\s*insert\s+into/i);
    expect(probe).not.toMatch(/client\.query\(\s*[`'"]\s*update\s+/i);
    expect(probe).not.toMatch(/client\.query\(\s*[`'"]\s*delete\s+from/i);
    expect(probe).not.toMatch(/client\.query\(\s*[`'"]\s*(create|alter|drop|truncate)\s+/i);
    expect(probe).not.toContain("client.query('commit')");
  });

  it('proves the audit serial sequence privilege required by the historical audit insert', () => {
    expect(probe).toContain("pg_get_serial_sequence('public.audit_events', 'id')");
    expect(probe).toContain('has_sequence_privilege(');
    expect(probe).toContain("'USAGE'");
    expect(probe).toContain('audit_id_sequence_usage');
    expect(probe).toContain('auditSequencePrivilegePresent: true');
  });

  it('proves the real single-column idempotency index is unique, valid and ready', () => {
    expect(probe).toContain('from pg_index i');
    expect(probe).toContain('i.indisunique = true');
    expect(probe).toContain('i.indisvalid = true');
    expect(probe).toContain('i.indisready = true');
    expect(probe).toContain('i.indnkeyatts = 1');
    expect(probe).toContain('i.indnatts = 1');
    expect(probe).toContain('i.indpred is null');
    expect(probe).toContain('i.indexprs is null');
    expect(probe).toContain('i.indkey[0] = idempotency_attribute.attnum');
    expect(probe).not.toContain("indexdef ilike '%unique%'");
  });

  it('requires exact compatibility tenant defaults instead of substring matching', () => {
    expect(probe).toContain(
      "pg_get_expr(attribute_default.adbin, attribute_default.adrelid) = '''toca''::text'",
    );
    expect(probe).toContain('provider_tenant_default_toca');
    expect(probe).toContain('audit_tenant_default_toca');
    expect(probe).not.toContain("includes('toca')");
  });

  it('verifies DATABASE_URL targets the exact attached production Cloud SQL socket', () => {
    expect(probe).toContain(
      "const PRODUCTION_CLOUD_SQL_INSTANCE = 'toca-mcp-production:southamerica-east1:toca-mcp-db'",
    );
    expect(probe).toContain('const expectedSocket = `/cloudsql/${expectedCloudSqlInstance}`');
    expect(probe).toContain("parsedDatabaseUrl.searchParams.get('host') !== expectedSocket");
    expect(probe).toContain('GCP_PUBLICATION_EXECUTION_READINESS_DATABASE_TARGET_MISMATCH');
    expect(probe).toContain('databaseTargetVerified: true');
  });

  it('verifies the schema and privileges required by the historical execute path without exercising writes', () => {
    for (const required of [
      'provider_publications',
      'audit_events',
      'idempotency_key',
      'idempotency_unique',
      'provider_insert',
      'provider_update',
      'audit_insert',
      'audit_id_sequence_usage',
      'provider_tenant_default_toca',
      'audit_tenant_default_toca',
      'databaseRoleNonSuperuser: true',
    ]) {
      expect(probe).toContain(required);
    }
    expect(workflow).toContain('GCP_PUBLICATION_EXECUTION_RUNTIME_DATABASE=VERIFIED');
    expect(workflow).toContain('retention-days: 90');
  });

  it('proves deletion of the temporary Cloud Run job and prevents rerun name reuse', () => {
    expect(workflow).toContain(
      'JOB_NAME=toca-instagram-exec-ready-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}',
    );
    expect(workflow).toContain('gcloud run jobs delete "$JOB_NAME"');
    expect(workflow).toContain('gcloud run jobs list');
    expect(workflow).toContain('--filter="metadata.name=$JOB_NAME"');
    expect(workflow).toContain('cleanup_verified=true');
    expect(workflow).toContain('cloudRunJobCleanupVerified:true');
    expect(workflow).toContain('GCP_PUBLICATION_EXECUTION_READINESS_CLOUD_RUN_CLEANUP=VERIFIED');
    expect(workflow).toContain(
      'name: instagram-gcp-execution-runtime-readiness-${{ github.run_id }}-${{ github.run_attempt }}',
    );
  });

  it('keeps owner authorization credentialless and invokes only the reusable readiness gate', () => {
    expect(gateway).toContain('github.event.issue.number == 869');
    expect(gateway).toContain("github.actor == 'luizanunciostoca'");
    expect(gateway).toContain("github.event.comment.author_association == 'OWNER'");
    expect(gateway).toContain('AUTHORIZE_GCP_INSTAGRAM_EXECUTION_RUNTIME_READINESS');
    expect(gateway).toContain(
      'authorized_source_sha: ${{ steps.guard.outputs.authorized_source_sha }}',
    );
    expect(gateway).toContain(
      'uses: ./.github/workflows/instagram-gcp-publication-execution-readiness.yml',
    );
    expect(gateway).toContain(
      'expected_source_sha: ${{ needs.authorize-owner-command.outputs.authorized_source_sha }}',
    );
    expect(gateway.match(/\/git\/ref\/heads\/main/g)).toHaveLength(1);
    expect(gateway).toContain('test "$live_main_sha" = "$AUTHORIZED_SOURCE_SHA"');
    expect(gateway).not.toContain('actions: write');
    expect(gateway).toContain('contents: read');
    expect(gateway).toContain('issues: read');
    expect(gateway).toContain('id-token: write');
    expect(gateway).not.toContain('/dispatches');
    expect(gateway).not.toContain('google-github-actions/auth');
    expect(gateway).not.toContain('gcloud ');
    expect(gateway).not.toContain('DATABASE_URL');
    expect(gateway).not.toContain('META_ACCESS_TOKEN');
  });
});
