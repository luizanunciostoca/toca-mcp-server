import { readFileSync, writeFileSync } from 'node:fs';

const path = '.github/workflows/deploy-gcp-staging-canonical.yml';
let source = readFileSync(path, 'utf8');

const oldLoad = `      - name: Load repository-canonical staging coordinates
        shell: bash
        run: |
          set -euo pipefail
          echo 'DEPLOY_ENVIRONMENT=staging' >> "$GITHUB_ENV"
          node scripts/export-staging-deploy-config.mjs infra/environments/staging.json >> "$GITHUB_ENV"
`;
const newLoad = `      - name: Load repository-canonical staging coordinates
        id: config
        shell: bash
        run: |
          set -euo pipefail
          echo 'DEPLOY_ENVIRONMENT=staging' >> "$GITHUB_ENV"
          node scripts/export-staging-deploy-config.mjs infra/environments/staging.json > /tmp/staging-deploy.env
          cat /tmp/staging-deploy.env >> "$GITHUB_ENV"
          set -a
          source /tmp/staging-deploy.env
          set +a
          echo "wif=$GCP_WORKLOAD_IDENTITY_PROVIDER" >> "$GITHUB_OUTPUT"
          echo "deployer_sa=$GCP_DEPLOY_SERVICE_ACCOUNT" >> "$GITHUB_OUTPUT"
`;
if (!source.includes(oldLoad)) throw new Error('load block not found');
source = source.replace(oldLoad, newLoad);
source = source.replace(
  `          workload_identity_provider: \${{ env.GCP_WORKLOAD_IDENTITY_PROVIDER }}\n          service_account: \${{ env.GCP_DEPLOY_SERVICE_ACCOUNT }}`,
  `          workload_identity_provider: \${{ steps.config.outputs.wif }}\n          service_account: \${{ steps.config.outputs.deployer_sa }}`,
);
source = source.replace(
  `.revisionName == env.revision`,
  `.revisionName == $revision`,
);
if (!source.includes('steps.config.outputs.wif')) throw new Error('auth output patch missing');
if (source.includes('.revisionName == env.revision')) throw new Error('readback jq patch missing');
writeFileSync(path, source);
