import fs from 'node:fs';

function requireIncludes(path, needles) {
  const content = fs.readFileSync(path, 'utf8');
  for (const needle of needles) {
    if (!content.includes(needle)) {
      throw new Error(`FINOPS_ARCHITECTURE_CONTRACT_MISSING:${path}:${needle}`);
    }
  }
}

requireIncludes('src/finops/cost-gate.ts', [
  "'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK'",
  'This never replaces Core Policy or Approval',
  'FINOPS_COST_OR_PRICE_UNKNOWN',
]);
requireIncludes('src/finops/ai-cost-router.ts', [
  "readonly enforcement: 'ADVISORY'",
  "model: 'gemini-2.5-flash-lite'",
  "model: 'gemini-2.5-flash'",
  'performs no provider call',
]);
requireIncludes('src/finops/pricing-catalog.ts', [
  "FINOPS_PRICE_CATALOG_VERSION = 'google-vertex-ai-2026-09-15-v1'",
  'inputMicroUsdPerMillion: 300_000',
  'outputMicroUsdPerMillion: 2_500_000',
  'inputMicroUsdPerMillion: 100_000',
  'outputMicroUsdPerMillion: 400_000',
]);
requireIncludes('migrations/041_finops_cost_ledger.sql', [
  'create table if not exists finops_cost_events',
  'estimated_cost_micro_usd bigint',
  'actual_cost_micro_usd bigint',
  'FINOPS_COST_LEDGER_APPEND_ONLY',
  'before update or delete on finops_cost_events',
]);
requireIncludes('docs/architecture/finops-cost-control-v1.md', [
  'ADVISORY_ONLY',
  'COST GATE -> CORE POLICY/APPROVAL',
  'must not silently replace the production AG-01 model binding',
]);
requireIncludes('src/finops/ag01-runtime-cost-observer.ts', [
  "'MISSING_ACTUAL_USAGE'",
  "'WITHIN_ESTIMATE'",
  "'OVER_ESTIMATE'",
  'FINOPS_RUNTIME_PRICE_UNKNOWN',
  "provider: 'GOOGLE_VERTEX_AI'",
]);
requireIncludes('src/orchestrator/vertex-gemini-decision-adapter.ts', [
  'costObserver?.beforeRequest',
  'costObserver?.afterResponse',
  'usageMetadata',
  'thoughtsTokenCount',
  'safeTokenSum',
  'conservativeTokenEstimate',
]);
requireIncludes('src/orchestrator/production-runtime.ts', [
  'new PostgresCostLedger(pool)',
  'Ag01RuntimeCostContext',
  'costObserver: runtimeCostObserver',
]);
requireIncludes('docs/architecture/finops-runtime-cost-reconciliation-v1.md', [
  'OBSERVABILITY_ENFORCED',
  'does not invent a zero cost',
  'response and reasoning',
  'performs no automatic model switching',
  'not invoice settlement',
]);
requireIncludes('migrations/042_finops_billing_snapshots.sql', [
  'create table if not exists finops_billing_snapshots',
  "currency text not null check (currency = 'USD')",
  'billed_cost_micro_usd bigint not null',
  'FINOPS_BILLING_SNAPSHOT_APPEND_ONLY',
  'before update or delete on finops_billing_snapshots',
]);
requireIncludes('src/finops/billing-reconciliation.ts', [
  "'MISSING_LEDGER_COST'",
  "'BILLING_EXCEEDS_LEDGER'",
  "'LEDGER_EXCEEDS_BILLING'",
  'sideEffects: false',
]);
requireIncludes('src/finops/budget-intelligence.ts', [
  "'NOTICE_50'",
  "'WARNING_70'",
  "'CRITICAL_85'",
  "'EXCEEDED_100'",
  'advisoryOnly: true',
  'sideEffects: false',
]);
requireIncludes('src/finops/postgres-finops-read-model.ts', [
  "'PROVIDER' | 'CATEGORY' | 'ROUTE' | 'AGENT' | 'CAMPAIGN'",
  "phase = 'ACTUAL'",
  'reconcileBillingSnapshot',
]);
requireIncludes('docs/architecture/finops-billing-budget-intelligence-v1.md', [
  'ADVISORY_ONLY',
  'NO_FX_CONVERSION',
  'no automatic budget change',
  'no provider write',
  'real `DATABASE_URL`',
]);

console.log('FINOPS_COST_CONTROL_CONTRACT=PASS');
