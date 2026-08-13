import { existsSync, readFileSync } from 'node:fs';

const rolePath = 'infra/control-plane/toca-managed-instagram-heartbeat-admin-role.yaml';
if (!existsSync(rolePath)) {
  console.error(`Heartbeat IAM role is required: ${rolePath}`);
  process.exit(1);
}

const role = readFileSync(rolePath, 'utf8');

const required = [
  'run.jobs.create',
  'run.jobs.get',
  'run.jobs.getIamPolicy',
  'run.jobs.setIamPolicy',
  'run.jobs.update',
  'run.locations.get',
  'run.operations.get',
  'cloudscheduler.jobs.create',
  'cloudscheduler.jobs.get',
  'cloudscheduler.jobs.pause',
  'cloudscheduler.jobs.update',
  'cloudscheduler.locations.get',
  'resourcemanager.projects.get',
];

for (const permission of required) {
  if (!role.includes(`- ${permission}`)) {
    console.error(`Heartbeat IAM role missing permission: ${permission}`);
    process.exit(1);
  }
}

const forbidden = [
  'run.jobs.delete',
  'run.jobs.run',
  'run.jobs.runWithOverrides',
  'cloudscheduler.jobs.delete',
  'cloudscheduler.jobs.enable',
  'cloudscheduler.jobs.run',
  'iam.serviceAccounts.actAs',
  'iam.serviceAccounts.create',
  'iam.serviceAccountKeys.create',
  'resourcemanager.projects.setIamPolicy',
];

for (const permission of forbidden) {
  if (role.includes(permission)) {
    console.error(`Heartbeat IAM role contains forbidden permission: ${permission}`);
    process.exit(1);
  }
}

console.log('TOCA-managed heartbeat IAM check passed.');
