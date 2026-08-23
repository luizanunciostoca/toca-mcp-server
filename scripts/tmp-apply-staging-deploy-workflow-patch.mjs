import { readFileSync, writeFileSync } from 'node:fs';

const path = '.github/workflows/deploy-gcp.yml';
let source = readFileSync(path, 'utf8');

const envStart = source.indexOf('    env:\n      DEPLOY_ENVIRONMENT:');
const stepsStart = source.indexOf('    steps:\n', envStart);
if (envStart < 0 || stepsStart < 0 || stepsStart <= envStart) {
  throw new Error('deploy job env block marker not found');
}
source = source.slice(0, envStart) + source.slice(stepsStart);

const marker = `      - name: Install and run exact-head Quality
        if: inputs.operation == 'deploy'
        run: |
          set -euo pipefail
          pnpm install --frozen-lockfile
          pnpm quality

      - name: Prove environment isolation before any GCP access
`;
if (!source.includes(marker)) throw new Error('quality marker not found');

const replacement = `      - name: Install and run exact-head Quality
        if: inputs.operation == 'deploy'
        run: |
          set -euo pipefail
          pnpm install --frozen-lockfile
          pnpm quality

      - name: Load governed deployment configuration after Quality
        env:
          DEPLOY_INPUT_ENVIRONMENT: \${{ inputs.environment }}
          INPUT_ALERT_EVIDENCE_REF: \${{ inputs.alert_evidence_ref }}
          INPUT_DR_EVIDENCE_REF: \${{ inputs.dr_evidence_ref }}
          P_GCP_PROJECT_ID: \${{ vars.GCP_PROJECT_ID }}
          P_GCP_PROJECT_NUMBER: \${{ vars.GCP_PROJECT_NUMBER }}
          P_GCP_REGION: \${{ vars.GCP_REGION }}
          P_GCP_ARTIFACT_REPOSITORY: \${{ vars.GCP_ARTIFACT_REPOSITORY }}
          P_GCP_CLOUD_SQL_INSTANCE: \${{ vars.GCP_CLOUD_SQL_INSTANCE }}
          P_GCP_CLOUD_RUN_MCP_SERVICE: \${{ vars.GCP_CLOUD_RUN_MCP_SERVICE }}
          P_GCP_CLOUD_RUN_WEBHOOK_SERVICE: \${{ vars.GCP_CLOUD_RUN_WEBHOOK_SERVICE }}
          P_GCP_WORKLOAD_IDENTITY_PROVIDER: \${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          P_GCP_DEPLOY_SERVICE_ACCOUNT: \${{ vars.GCP_DEPLOY_SERVICE_ACCOUNT }}
          P_GCP_MCP_RUNTIME_SERVICE_ACCOUNT: \${{ vars.GCP_MCP_RUNTIME_SERVICE_ACCOUNT }}
          P_GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT: \${{ vars.GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT }}
          P_GCP_DATABASE_URL_SECRET: \${{ vars.GCP_DATABASE_URL_SECRET }}
          P_GCP_DATABASE_URL_SECRET_VERSION: \${{ vars.GCP_DATABASE_URL_SECRET_VERSION }}
          P_GCP_META_ACCESS_TOKEN_SECRET: \${{ vars.GCP_META_ACCESS_TOKEN_SECRET }}
          P_GCP_META_ACCESS_TOKEN_SECRET_VERSION: \${{ vars.GCP_META_ACCESS_TOKEN_SECRET_VERSION }}
          P_GCP_META_APP_SECRET: \${{ vars.GCP_META_APP_SECRET }}
          P_GCP_META_APP_SECRET_VERSION: \${{ vars.GCP_META_APP_SECRET_VERSION }}
          P_GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET: \${{ vars.GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET }}
          P_GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET_VERSION: \${{ vars.GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET_VERSION }}
          P_GCP_SENDGRID_API_KEY_SECRET: \${{ vars.GCP_SENDGRID_API_KEY_SECRET }}
          P_GCP_SENDGRID_API_KEY_SECRET_VERSION: \${{ vars.GCP_SENDGRID_API_KEY_SECRET_VERSION }}
          P_GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET: \${{ vars.GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET }}
          P_GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET_VERSION: \${{ vars.GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET_VERSION }}
          P_GCP_GOOGLE_ADS_CLIENT_ID_SECRET: \${{ vars.GCP_GOOGLE_ADS_CLIENT_ID_SECRET }}
          P_GCP_GOOGLE_ADS_CLIENT_ID_SECRET_VERSION: \${{ vars.GCP_GOOGLE_ADS_CLIENT_ID_SECRET_VERSION }}
          P_GCP_GOOGLE_ADS_CLIENT_SECRET_SECRET: \${{ vars.GCP_GOOGLE_ADS_CLIENT_SECRET_SECRET }}
          P_GCP_GOOGLE_ADS_CLIENT_SECRET_VERSION: \${{ vars.GCP_GOOGLE_ADS_CLIENT_SECRET_VERSION }}
          P_GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET: \${{ vars.GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET }}
          P_GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET_VERSION: \${{ vars.GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET_VERSION }}
          P_GCP_AG01_MODEL_API_KEY_SECRET: \${{ vars.GCP_AG01_MODEL_API_KEY_SECRET }}
          P_GCP_AG01_MODEL_API_KEY_SECRET_VERSION: \${{ vars.GCP_AG01_MODEL_API_KEY_SECRET_VERSION }}
          P_TOCA_DEFAULT_TENANT_ID: \${{ vars.TOCA_DEFAULT_TENANT_ID || 'toca' }}
          P_TOCA_DEFAULT_WORKSPACE_ID: \${{ vars.TOCA_DEFAULT_WORKSPACE_ID || 'toca' }}
          P_TOCA_DEFAULT_ORGANIZATION_ID: \${{ vars.TOCA_DEFAULT_ORGANIZATION_ID || 'toca' }}
          P_META_ENABLED: \${{ vars.META_ENABLED || 'false' }}
          P_META_PROVIDER_VERIFIED: \${{ vars.META_PROVIDER_VERIFIED || 'false' }}
          P_META_WEBHOOK_ENABLED: \${{ vars.META_WEBHOOK_ENABLED || 'false' }}
          P_META_WEBHOOK_PERSISTENCE_ENABLED: \${{ vars.META_WEBHOOK_PERSISTENCE_ENABLED || 'false' }}
          P_INSTAGRAM_READ_ENABLED: \${{ vars.INSTAGRAM_READ_ENABLED || 'false' }}
          P_META_ADS_READ_ENABLED: \${{ vars.META_ADS_READ_ENABLED || 'false' }}
          P_META_ADS_WRITE_ENABLED: \${{ vars.META_ADS_WRITE_ENABLED || 'false' }}
          P_WHATSAPP_ENABLED: \${{ vars.WHATSAPP_ENABLED || 'false' }}
          P_WHATSAPP_BUSINESS_ID: \${{ vars.WHATSAPP_BUSINESS_ID }}
          P_WHATSAPP_PROVIDER_VERIFIED: \${{ vars.WHATSAPP_PROVIDER_VERIFIED || 'false' }}
          P_EMAIL_SENDGRID_ENABLED: \${{ vars.EMAIL_SENDGRID_ENABLED || 'false' }}
          P_EMAIL_SENDGRID_PROVIDER_VERIFIED: \${{ vars.EMAIL_SENDGRID_PROVIDER_VERIFIED || 'false' }}
          P_GOOGLE_ADS_PHASE: \${{ vars.GOOGLE_ADS_PHASE || 'OFF' }}
          P_GOOGLE_ADS_PROVIDER_VERIFIED: \${{ vars.GOOGLE_ADS_PROVIDER_VERIFIED || 'false' }}
          P_AG01_MODEL_ENABLED: \${{ vars.AG01_MODEL_ENABLED || 'false' }}
          P_AG01_MODEL_PROVIDER_VERIFIED: \${{ vars.AG01_MODEL_PROVIDER_VERIFIED || 'false' }}
        shell: bash
        run: |
          set -euo pipefail
          echo "DEPLOY_ENVIRONMENT=$DEPLOY_INPUT_ENVIRONMENT" >> "$GITHUB_ENV"
          echo "ALERT_EVIDENCE_REF=$INPUT_ALERT_EVIDENCE_REF" >> "$GITHUB_ENV"
          echo "DR_EVIDENCE_REF=$INPUT_DR_EVIDENCE_REF" >> "$GITHUB_ENV"
          if [[ "$DEPLOY_INPUT_ENVIRONMENT" == staging ]]; then
            node scripts/export-staging-deploy-config.mjs infra/environments/staging.json >> "$GITHUB_ENV"
            echo 'STAGING_DEPLOY_CONFIG_SOURCE=repository-canonical'
            exit 0
          fi

          require_and_persist() {
            local key="$1" value="$2"
            test -n "$value" || { echo "production deploy variable $key is required" >&2; exit 1; }
            printf '%s=%s\\n' "$key" "$value" >> "$GITHUB_ENV"
          }
          persist() { printf '%s=%s\\n' "$1" "$2" >> "$GITHUB_ENV"; }

          require_and_persist GCP_PROJECT_ID "$P_GCP_PROJECT_ID"
          require_and_persist GCP_PROJECT_NUMBER "$P_GCP_PROJECT_NUMBER"
          require_and_persist GCP_REGION "$P_GCP_REGION"
          require_and_persist GCP_ARTIFACT_REPOSITORY "$P_GCP_ARTIFACT_REPOSITORY"
          require_and_persist GCP_CLOUD_SQL_INSTANCE "$P_GCP_CLOUD_SQL_INSTANCE"
          require_and_persist GCP_CLOUD_RUN_MCP_SERVICE "$P_GCP_CLOUD_RUN_MCP_SERVICE"
          require_and_persist GCP_CLOUD_RUN_WEBHOOK_SERVICE "$P_GCP_CLOUD_RUN_WEBHOOK_SERVICE"
          require_and_persist GCP_WORKLOAD_IDENTITY_PROVIDER "$P_GCP_WORKLOAD_IDENTITY_PROVIDER"
          require_and_persist GCP_DEPLOY_SERVICE_ACCOUNT "$P_GCP_DEPLOY_SERVICE_ACCOUNT"
          require_and_persist GCP_MCP_RUNTIME_SERVICE_ACCOUNT "$P_GCP_MCP_RUNTIME_SERVICE_ACCOUNT"
          require_and_persist GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT "$P_GCP_WEBHOOK_RUNTIME_SERVICE_ACCOUNT"
          require_and_persist GCP_DATABASE_URL_SECRET "$P_GCP_DATABASE_URL_SECRET"
          require_and_persist GCP_DATABASE_URL_SECRET_VERSION "$P_GCP_DATABASE_URL_SECRET_VERSION"
          persist GCP_META_ACCESS_TOKEN_SECRET "$P_GCP_META_ACCESS_TOKEN_SECRET"
          persist GCP_META_ACCESS_TOKEN_SECRET_VERSION "$P_GCP_META_ACCESS_TOKEN_SECRET_VERSION"
          persist GCP_META_APP_SECRET "$P_GCP_META_APP_SECRET"
          persist GCP_META_APP_SECRET_VERSION "$P_GCP_META_APP_SECRET_VERSION"
          persist GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET "$P_GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET"
          persist GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET_VERSION "$P_GCP_META_WEBHOOK_VERIFY_TOKEN_SECRET_VERSION"
          persist GCP_SENDGRID_API_KEY_SECRET "$P_GCP_SENDGRID_API_KEY_SECRET"
          persist GCP_SENDGRID_API_KEY_SECRET_VERSION "$P_GCP_SENDGRID_API_KEY_SECRET_VERSION"
          persist GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET "$P_GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET"
          persist GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET_VERSION "$P_GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET_VERSION"
          persist GCP_GOOGLE_ADS_CLIENT_ID_SECRET "$P_GCP_GOOGLE_ADS_CLIENT_ID_SECRET"
          persist GCP_GOOGLE_ADS_CLIENT_ID_SECRET_VERSION "$P_GCP_GOOGLE_ADS_CLIENT_ID_SECRET_VERSION"
          persist GCP_GOOGLE_ADS_CLIENT_SECRET_SECRET "$P_GCP_GOOGLE_ADS_CLIENT_SECRET_SECRET"
          persist GCP_GOOGLE_ADS_CLIENT_SECRET_VERSION "$P_GCP_GOOGLE_ADS_CLIENT_SECRET_VERSION"
          persist GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET "$P_GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET"
          persist GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET_VERSION "$P_GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET_VERSION"
          persist GCP_AG01_MODEL_API_KEY_SECRET "$P_GCP_AG01_MODEL_API_KEY_SECRET"
          persist GCP_AG01_MODEL_API_KEY_SECRET_VERSION "$P_GCP_AG01_MODEL_API_KEY_SECRET_VERSION"
          persist TOCA_DEFAULT_TENANT_ID "$P_TOCA_DEFAULT_TENANT_ID"
          persist TOCA_DEFAULT_WORKSPACE_ID "$P_TOCA_DEFAULT_WORKSPACE_ID"
          persist TOCA_DEFAULT_ORGANIZATION_ID "$P_TOCA_DEFAULT_ORGANIZATION_ID"
          persist META_ENABLED "$P_META_ENABLED"
          persist META_PROVIDER_VERIFIED "$P_META_PROVIDER_VERIFIED"
          persist META_WEBHOOK_ENABLED "$P_META_WEBHOOK_ENABLED"
          persist META_WEBHOOK_PERSISTENCE_ENABLED "$P_META_WEBHOOK_PERSISTENCE_ENABLED"
          persist INSTAGRAM_READ_ENABLED "$P_INSTAGRAM_READ_ENABLED"
          persist META_ADS_READ_ENABLED "$P_META_ADS_READ_ENABLED"
          persist META_ADS_WRITE_ENABLED "$P_META_ADS_WRITE_ENABLED"
          persist WHATSAPP_ENABLED "$P_WHATSAPP_ENABLED"
          persist WHATSAPP_BUSINESS_ID "$P_WHATSAPP_BUSINESS_ID"
          persist WHATSAPP_PROVIDER_VERIFIED "$P_WHATSAPP_PROVIDER_VERIFIED"
          persist EMAIL_SENDGRID_ENABLED "$P_EMAIL_SENDGRID_ENABLED"
          persist EMAIL_SENDGRID_PROVIDER_VERIFIED "$P_EMAIL_SENDGRID_PROVIDER_VERIFIED"
          persist GOOGLE_ADS_PHASE "$P_GOOGLE_ADS_PHASE"
          persist GOOGLE_ADS_PROVIDER_VERIFIED "$P_GOOGLE_ADS_PROVIDER_VERIFIED"
          persist AG01_MODEL_ENABLED "$P_AG01_MODEL_ENABLED"
          persist AG01_MODEL_PROVIDER_VERIFIED "$P_AG01_MODEL_PROVIDER_VERIFIED"
          echo 'PRODUCTION_DEPLOY_CONFIG_SOURCE=github-environment'

      - name: Prove environment isolation before any GCP access
`;

source = source.replace(marker, replacement);
if (source.includes('PRODUCTION_GCP_PROJECT_ID: ${{ vars.PRODUCTION_GCP_PROJECT_ID }}')) {
  throw new Error('production comparison coordinates remain in job env');
}
if (!source.includes('node scripts/export-staging-deploy-config.mjs infra/environments/staging.json')) {
  throw new Error('canonical staging exporter was not inserted');
}
writeFileSync(path, source);
