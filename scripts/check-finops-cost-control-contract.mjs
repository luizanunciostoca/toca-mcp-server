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

console.log('FINOPS_COST_CONTROL_CONTRACT=PASS');
