import { existsSync, readFileSync } from 'node:fs';

const workflowPath = '.github/workflows/bootstrap-toca-managed-heartbeat-iam.yml';
if (!existsSync(workflowPath)) {
  console.error(`Heartbeat IAM bootstrap workflow is required: ${workflowPath}`);
  process.exit(1);
}

const workflow = readFileSync(workflowPath, 'utf8');

const required = [
  'workflow_dispatch:',
  'environment: infrastructure-admin',
  'id-token: write',
  'ref: main',
  'expected_role_sha256',
  'sha256sum "$CUSTOM_ROLE_FILE"',
  'toca-mcp-infra-admin@toca-mcp-production.iam.gserviceaccount.com',
  'toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com',
  'tocaMcpManagedInstagramHeartbeatAdmin',
  'roles/iam.serviceAccountUser',
  'roles/artifactregistry.reader',
  'TOCA_MANAGED_HEARTBEAT_IAM_BOOTSTRAP_OK=1',
];

for (const marker of required) {
  if (!workflow.includes(marker)) {
    console.error(`Heartbeat IAM bootstrap workflow missing boundary marker: ${marker}`);
    process.exit(1);
  }
}

const forbidden = [
  'roles/owner',
  'roles/editor',
  'roles/iam.serviceAccountTokenCreator',
  'iam.serviceAccountKeys.create',
  'gcloud scheduler jobs resume',
  'gcloud scheduler jobs run',
  'gcloud run jobs execute',
  'gcloud run jobs delete',
  'gcloud iam service-accounts create',
  'gcloud iam service-accounts keys create',
];

for (const marker of forbidden) {
  if (workflow.includes(marker)) {
    console.error(`Heartbeat IAM bootstrap workflow contains forbidden capability: ${marker}`);
    process.exit(1);
  }
}

if (workflow.includes('push:') || workflow.includes('pull_request:') || workflow.includes('schedule:')) {
  console.error('Heartbeat IAM bootstrap workflow must remain manual-only');
  process.exit(1);
}

const bindingCommands = workflow.match(/gcloud (projects|iam service-accounts|artifacts repositories) add-iam-policy-binding/g) ?? [];
if (bindingCommands.length !== 3) {
  console.error(`Heartbeat IAM bootstrap must contain exactly three IAM binding mutations; found ${bindingCommands.length}`);
  process.exit(1);
}

console.log('TOCA-managed heartbeat bootstrap workflow check passed.');
