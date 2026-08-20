import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ExecutionIdentityResolver } from '../core/identity.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import { resolveCapabilityDefinition } from '../governance/capability-resolution.js';
import type { ApprovalStore } from '../governance/approval-governance.js';
import type { CoreCapabilityRuntimeResolver } from './core-execution.js';

export const CONTROL_CENTER_TOOL_NAME = 'toca.control_center.open';
export const CONTROL_CENTER_RESOURCE_URI = 'ui://toca/human-control-center-v1.html';
export const CONTROL_CENTER_VERSION = '1.0.0';

const PANEL_IDS = [
  'pending-approvals',
  'prepared-campaigns',
  'publications',
  'pipeline',
  'critical-leads',
  'next-actions',
  'provider-health',
  'dead-letters',
  'demand-index',
  'budget-recommendations',
  'experiments',
  'incidents',
  'slo-status',
] as const;

type PanelId = (typeof PANEL_IDS)[number];
type PanelState = 'READY' | 'PARTIAL' | 'DEPENDENCY_PENDING';

type PanelSource =
  | { readonly kind: 'CORE_TOOL'; readonly id: string; readonly available: boolean }
  | {
      readonly kind: 'CAPABILITY';
      readonly id: string;
      readonly available: boolean;
      readonly lifecycleStatus: string | null;
      readonly provider: string | null;
    };

interface PanelDefinition {
  readonly id: PanelId;
  readonly title: string;
  readonly description: string;
  readonly coreTools?: readonly string[];
  readonly capabilityIds?: readonly string[];
  readonly dependency?: string;
  readonly notes?: readonly string[];
}

export interface ControlCenterPanel {
  readonly id: PanelId;
  readonly title: string;
  readonly description: string;
  readonly state: PanelState;
  readonly sources: readonly PanelSource[];
  readonly dependency: string | null;
  readonly notes: readonly string[];
}

export interface ControlCenterSurfaceDependencies {
  readonly registry: ToolRegistry;
  readonly runtimeResolver: CoreCapabilityRuntimeResolver;
  readonly resolveIdentity: ExecutionIdentityResolver;
  readonly approvalStore?: ApprovalStore;
  readonly workflowStoreAvailable: boolean;
  readonly auditStoreAvailable: boolean;
  readonly eventStoreAvailable: boolean;
}

const PANEL_DEFINITIONS: readonly PanelDefinition[] = [
  {
    id: 'pending-approvals',
    title: 'Pending approvals',
    description: 'Formal ApprovalRecords waiting for human review.',
    coreTools: ['toca.approval.list', 'toca.approval.get'],
    notes: [
      'Approval mutations are never performed by the view itself.',
      'Approve/reject buttons emit an AG-01 intent that must re-enter governed Core execution.',
    ],
  },
  {
    id: 'prepared-campaigns',
    title: 'Prepared campaigns',
    description: 'Governed paid-media campaigns and PAUSED candidates discovered through provider READ.',
    capabilityIds: [
      'meta_ads.accounts.list',
      'meta_ads.campaigns.list',
      'meta_ads.campaign.prepare_paused',
      'google_ads.campaigns.list',
      'google_ads.campaign.prepare',
    ],
  },
  {
    id: 'publications',
    title: 'Publications',
    description: 'Managed Instagram schedule and provider publication history.',
    capabilityIds: ['instagram.toca_schedule.list', 'instagram.media.list'],
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    description: 'Canonical CRM sales pipeline.',
    dependency: 'PR #22 — advanced CRM/Sales must expose a governed Core READ capability before activation.',
  },
  {
    id: 'critical-leads',
    title: 'Critical leads',
    description: 'High-priority leads requiring human attention.',
    dependency: 'PR #22 — reuse canonical CRM scoring; do not duplicate lead scoring in Control Center.',
  },
  {
    id: 'next-actions',
    title: 'Next actions',
    description: 'Canonical CRM next actions and SLA follow-ups.',
    dependency: 'PR #22 — reuse canonical CRM next-action records; no parallel task store.',
  },
  {
    id: 'provider-health',
    title: 'Provider health',
    description: 'Core readiness plus provider READ probes only.',
    coreTools: ['toca.system.health'],
    capabilityIds: ['meta_ads.accounts.list', 'instagram.media.list'],
  },
  {
    id: 'dead-letters',
    title: 'Dead letters',
    description: 'Failed managed jobs surfaced from the existing scheduler list.',
    capabilityIds: ['instagram.toca_schedule.list'],
    notes: ['Control Center does not create a second dead-letter queue.'],
  },
  {
    id: 'demand-index',
    title: 'Demand Index',
    description: 'Morro aggregate demand signal from the canonical Meta Ads intelligence engine.',
    capabilityIds: ['meta_ads.opportunity.detect', 'meta_ads.audience.inspect'],
    dependency: 'PR #15 until merged into main.',
    notes: [
      'Meta audience estimate is modeled aggregate MAU, not a count of people or devices physically present.',
    ],
  },
  {
    id: 'budget-recommendations',
    title: 'Budget recommendations',
    description: 'READ-only guarded recommendation. Never changes provider budget from this view.',
    capabilityIds: ['meta_ads.budget.recommend'],
    dependency: 'PR #15 until merged into main.',
  },
  {
    id: 'experiments',
    title: 'Experiments',
    description: 'Experiment state and learnings from the canonical content/performance lifecycle.',
    dependency: 'Requires a governed Core experiment-list/read capability; no parallel experiment store is created.',
  },
  {
    id: 'incidents',
    title: 'Incidents',
    description: 'Operational incidents and escalations.',
    dependency: 'PR #20 provides incident/observability contracts; Core READ exposure remains required.',
  },
  {
    id: 'slo-status',
    title: 'SLO status',
    description: 'Service-level objectives and alert health.',
    dependency: 'PR #20 provides the typed SLO catalog; Core READ exposure remains required.',
  },
];

const CORE_TOOL_AVAILABILITY = new Set([
  'toca.system.health',
  'toca.capabilities.search',
  'toca.capabilities.describe',
  'toca.approval.get',
  'toca.approval.list',
  'toca.execute',
  'toca.verify',
  'toca.audit.query',
  'toca.event.get',
]);

export function registerTocaControlCenterSurface(
  server: McpServer,
  dependencies: ControlCenterSurfaceDependencies,
): void {
  server.registerTool(
    CONTROL_CENTER_TOOL_NAME,
    {
      title: 'TOCA Human Control Center',
      description:
        'Open the governed TOCA OS human control dashboard. The view performs READs only and routes every mutation intent back through AG-01 and the existing Core.',
      inputSchema: z.object({
        focus: z.enum(PANEL_IDS).optional(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: {
          resourceUri: CONTROL_CENTER_RESOURCE_URI,
          visibility: ['model', 'app'],
        },
      },
    },
    ({ focus }, context) => {
      const identity = dependencies.resolveIdentity(context);
      if (!identity) throw new Error('CONTROL_CENTER_IDENTITY_REQUIRED');
      if (identity.authorization.roles.length === 0) {
        throw new Error('CONTROL_CENTER_AUTHORIZATION_REQUIRED');
      }

      const panels = buildControlCenterPanels(dependencies).filter(
        (panel) => !focus || panel.id === focus,
      );
      const output = {
        version: CONTROL_CENTER_VERSION,
        generatedAt: new Date().toISOString(),
        mode: 'GOVERNED_CORE_ONLY',
        architecture: [
          'USER',
          'CHATGPT_AG01',
          'TOCA_OS_GOOGLE_DRIVE',
          'ROUTE_ID',
          'AGENTS',
          'SOP_TEMPLATE',
          'QUALITY_GATE',
          'APPROVAL_POLICY_GATE',
          'TOCA_MCP_CORE',
          'PROVIDER',
          'READBACK',
          'AUDIT_OUTBOX_EVENT',
          'LEARNING',
        ],
        safety: {
          directProviderWritesFromView: false,
          parallelBackend: false,
          parallelApprovalEngine: false,
          parallelPolicyEngine: false,
          mutationMode: 'AG01_INTENT_ONLY',
        },
        actor: {
          principalId: identity.principal.principalId,
          roles: identity.authorization.roles,
        },
        panels,
        actions: [
          actionContract('APPROVE'),
          actionContract('REJECT'),
          actionContract('PAUSE'),
          actionContract('RESUME'),
          actionContract('ESCALATE'),
        ],
      };
      return response(output);
    },
  );

  server.registerResource(
    'TOCA Human Control Center UI',
    CONTROL_CENTER_RESOURCE_URI,
    {
      title: 'TOCA Human Control Center',
      description: 'Interactive governed operations dashboard for TOCA OS.',
      mimeType: 'text/html+mcp',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/html+mcp',
          text: controlCenterHtml(),
        },
      ],
    }),
  );
}

export function buildControlCenterPanels(
  dependencies: Pick<
    ControlCenterSurfaceDependencies,
    | 'registry'
    | 'runtimeResolver'
    | 'approvalStore'
    | 'workflowStoreAvailable'
    | 'auditStoreAvailable'
    | 'eventStoreAvailable'
  >,
): readonly ControlCenterPanel[] {
  return PANEL_DEFINITIONS.map((definition) => {
    const coreSources = (definition.coreTools ?? []).map((id): PanelSource => ({
      kind: 'CORE_TOOL',
      id,
      available: coreToolAvailable(id, dependencies),
    }));
    const capabilitySources = (definition.capabilityIds ?? []).map((id): PanelSource => {
      const resolved = resolveCapabilityDefinition(id);
      const canonical = resolved?.canonical_definition;
      return {
        kind: 'CAPABILITY',
        id,
        available: Boolean(
          resolved &&
            dependencies.registry.get(resolved.canonical_id) &&
            dependencies.runtimeResolver(resolved.canonical_id),
        ),
        lifecycleStatus: canonical?.lifecycle_status ?? null,
        provider: canonical?.provider ?? null,
      };
    });
    const sources = [...coreSources, ...capabilitySources];
    const availableCount = sources.filter((source) => source.available).length;
    const state: PanelState =
      sources.length > 0 && availableCount === sources.length
        ? 'READY'
        : availableCount > 0
          ? 'PARTIAL'
          : 'DEPENDENCY_PENDING';
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      state,
      sources,
      dependency: state === 'READY' ? null : (definition.dependency ?? null),
      notes: definition.notes ?? [],
    };
  });
}

function coreToolAvailable(
  id: string,
  dependencies: Pick<
    ControlCenterSurfaceDependencies,
    | 'approvalStore'
    | 'workflowStoreAvailable'
    | 'auditStoreAvailable'
    | 'eventStoreAvailable'
  >,
): boolean {
  if (!CORE_TOOL_AVAILABILITY.has(id)) return false;
  if (id.startsWith('toca.approval.')) return Boolean(dependencies.approvalStore);
  if (id.startsWith('toca.workflow.')) return dependencies.workflowStoreAvailable;
  if (id === 'toca.audit.query') return dependencies.auditStoreAvailable;
  if (id === 'toca.event.get') return dependencies.eventStoreAvailable;
  return true;
}

function actionContract(action: 'APPROVE' | 'REJECT' | 'PAUSE' | 'RESUME' | 'ESCALATE') {
  return {
    action,
    executionMode: 'AG01_INTENT_ONLY',
    requiredPath: [
      'identity',
      'typed_schema',
      'authorization',
      'policy_risk',
      'approval_when_required',
      'idempotency',
      'workflow',
      'provider_when_applicable',
      'provider_readback_when_applicable',
      'audit_outbox_event',
    ],
  } as const;
}

function response(output: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

function controlCenterHtml(): string {
  return String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TOCA Human Control Center</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    button, input, select { font: inherit; }
    .shell { max-width: 1440px; margin: 0 auto; padding: 18px; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
    .eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .62; }
    h1 { margin: 5px 0 4px; font-size: clamp(25px, 4vw, 38px); line-height: 1; }
    .subtitle { margin: 0; opacity: .72; max-width: 760px; }
    .guard { border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 14px; padding: 10px 12px; min-width: 220px; }
    .guard strong { display: block; font-size: 12px; }
    .guard span { font-size: 11px; opacity: .68; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; margin: 14px 0; }
    .stat { border: 1px solid color-mix(in srgb, CanvasText 12%, transparent); border-radius: 14px; padding: 12px; }
    .stat b { display: block; font-size: 22px; }
    .stat span { font-size: 11px; opacity: .66; }
    .toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0; }
    .btn { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); background: color-mix(in srgb, CanvasText 5%, Canvas); color: inherit; border-radius: 10px; padding: 8px 11px; cursor: pointer; }
    .btn:hover { background: color-mix(in srgb, CanvasText 10%, Canvas); }
    .btn:disabled { opacity: .42; cursor: not-allowed; }
    .btn.danger { border-style: dashed; }
    .grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; }
    .card { border: 1px solid color-mix(in srgb, CanvasText 12%, transparent); border-radius: 16px; padding: 13px; min-height: 178px; display: flex; flex-direction: column; gap: 8px; }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .card h2 { font-size: 15px; margin: 0; }
    .pill { font-size: 10px; border: 1px solid currentColor; border-radius: 999px; padding: 3px 7px; opacity: .8; white-space: nowrap; }
    .desc { margin: 0; font-size: 12px; opacity: .7; min-height: 31px; }
    .sources { display: flex; flex-wrap: wrap; gap: 5px; }
    .source { font-size: 9px; border-radius: 999px; padding: 3px 6px; background: color-mix(in srgb, CanvasText 7%, Canvas); }
    .source.off { opacity: .42; text-decoration: line-through; }
    .detail { font-size: 11px; line-height: 1.45; padding: 8px; border-radius: 10px; background: color-mix(in srgb, CanvasText 5%, Canvas); overflow: auto; max-height: 190px; white-space: pre-wrap; }
    .actions { margin-top: auto; display: flex; flex-wrap: wrap; gap: 6px; }
    .dependency { font-size: 10px; opacity: .6; }
    .row { display: flex; gap: 7px; align-items: center; }
    .row input { min-width: 0; width: 100%; border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 9px; padding: 7px; background: Canvas; color: CanvasText; }
    .footer { margin: 16px 0 4px; font-size: 10px; opacity: .55; }
    @media (max-width: 980px) { .grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .stats { grid-template-columns: repeat(2,minmax(0,1fr)); } }
    @media (max-width: 620px) { .shell { padding: 12px; } .top { display: block; } .guard { margin-top: 12px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main class="shell">
    <section class="top">
      <div>
        <div class="eyebrow">TOCA OS · Human Control Center</div>
        <h1>Controle humano, Core governado.</h1>
        <p class="subtitle">READs usam somente tools/capabilities do Core. Aprovar, rejeitar, pausar, retomar e escalar voltam ao AG-01 como intent; a view nunca escreve direto em provider.</p>
      </div>
      <div class="guard"><strong>Provider write: BLOQUEADO NA VIEW</strong><span>identity → policy → approval → idempotency → readback → audit</span></div>
    </section>
    <section class="stats">
      <div class="stat"><b id="readyCount">–</b><span>painéis prontos</span></div>
      <div class="stat"><b id="partialCount">–</b><span>parciais</span></div>
      <div class="stat"><b id="blockedCount">–</b><span>dependências</span></div>
      <div class="stat"><b id="actor">–</b><span>principal</span></div>
    </section>
    <div class="toolbar">
      <button class="btn" id="refreshHealth">Health + providers</button>
      <button class="btn" id="refreshPublications">Publications + dead letters</button>
      <button class="btn" id="refreshCampaigns">Meta campaigns</button>
      <button class="btn" id="refreshApprovals">Pending approvals</button>
    </div>
    <section class="grid" id="grid"></section>
    <p class="footer">TOCA Human Control Center v1 · sem segundo MCP, CRM, scheduler, Approval Engine, Policy Engine ou banco.</p>
  </main>
<script>
(function () {
  'use strict';
  var state = { model: null, requests: new Map(), nextId: 1, metaAccount: null };
  var protocolVersion = '2026-07-28';

  function post(message) { window.parent.postMessage(message, '*'); }
  function request(method, params) {
    var id = state.nextId++;
    return new Promise(function (resolve, reject) {
      state.requests.set(id, { resolve: resolve, reject: reject });
      post({ jsonrpc: '2.0', id: id, method: method, params: params });
    });
  }
  function notify(method, params) { post({ jsonrpc: '2.0', method: method, params: params || {} }); }
  function callTool(name, args) { return request('tools/call', { name: name, arguments: args || {} }); }
  function sendIntent(action, targetKind, targetId, extra) {
    var key = 'cc:' + action.toLowerCase() + ':' + targetKind + ':' + targetId;
    var text = [
      '[TOCA_CONTROL_CENTER_ACTION_INTENT]',
      'action=' + action,
      'target_kind=' + targetKind,
      'target_id=' + targetId,
      'idempotency_key=' + key,
      extra ? 'context=' + extra : '',
      'required_path=identity>typed_schema>authorization>policy_risk>approval_when_required>idempotency>workflow>provider_when_applicable>provider_readback_when_applicable>audit_outbox_event',
      'prohibited=direct_provider_write,parallel_backend,parallel_approval_engine,parallel_policy_engine'
    ].filter(Boolean).join('\n');
    return request('ui/message', { role: 'user', content: [{ type: 'text', text: text }] });
  }

  function parseToolResult(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    if (result.result && result.result.structuredContent) return result.result.structuredContent;
    var content = result.content || (result.result && result.result.content);
    if (Array.isArray(content)) {
      var text = content.find(function (item) { return item && item.type === 'text'; });
      if (text && text.text) {
        try { return JSON.parse(text.text); } catch (_) { return { text: text.text }; }
      }
    }
    return result;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function pretty(value) { return JSON.stringify(value, null, 2); }
  function panel(id) { return state.model && state.model.panels.find(function (item) { return item.id === id; }); }
  function detail(id, value) {
    var node = document.querySelector('[data-detail="' + id + '"]');
    if (node) node.textContent = typeof value === 'string' ? value : pretty(value);
  }
  function setBusy(button, busy) { if (button) { button.disabled = busy; button.dataset.busy = busy ? '1' : '0'; } }

  function render(model) {
    state.model = model;
    var panels = Array.isArray(model.panels) ? model.panels : [];
    document.getElementById('readyCount').textContent = panels.filter(function (p) { return p.state === 'READY'; }).length;
    document.getElementById('partialCount').textContent = panels.filter(function (p) { return p.state === 'PARTIAL'; }).length;
    document.getElementById('blockedCount').textContent = panels.filter(function (p) { return p.state === 'DEPENDENCY_PENDING'; }).length;
    document.getElementById('actor').textContent = model.actor && model.actor.principalId ? model.actor.principalId.replace('mcp-client:', '') : 'authenticated';
    document.getElementById('grid').innerHTML = panels.map(renderPanel).join('');
    bindPanelActions();
  }

  function renderPanel(p) {
    var sources = (p.sources || []).map(function (source) {
      return '<span class="source ' + (source.available ? '' : 'off') + '">' + escapeHtml(source.id) + '</span>';
    }).join('');
    var dependency = p.dependency ? '<div class="dependency">' + escapeHtml(p.dependency) + '</div>' : '';
    var extras = '';
    if (p.id === 'budget-recommendations') {
      extras = '<div class="row"><input data-budget-minor type="number" min="1" step="1" placeholder="Orçamento atual (centavos)"><button class="btn" data-action="BUDGET_READ">Calcular</button></div>';
    }
    return '<article class="card" data-panel="' + p.id + '">' +
      '<div class="card-head"><h2>' + escapeHtml(p.title) + '</h2><span class="pill">' + p.state + '</span></div>' +
      '<p class="desc">' + escapeHtml(p.description) + '</p>' +
      '<div class="sources">' + sources + '</div>' + dependency + extras +
      '<div class="detail" data-detail="' + p.id + '">Aguardando leitura governada.</div>' +
      '<div class="actions">' + actionButtons(p.id) + '</div>' +
      '</article>';
  }

  function actionButtons(id) {
    if (id === 'pending-approvals') return '<button class="btn" data-action="APPROVE">Approve</button><button class="btn danger" data-action="REJECT">Reject</button>';
    if (id === 'prepared-campaigns') return '<button class="btn" data-action="PAUSE">Pause</button><button class="btn" data-action="RESUME">Resume</button>';
    if (id === 'incidents' || id === 'critical-leads' || id === 'dead-letters') return '<button class="btn" data-action="ESCALATE">Escalate</button>';
    return '';
  }

  function bindPanelActions() {
    document.querySelectorAll('[data-action="APPROVE"],[data-action="REJECT"],[data-action="PAUSE"],[data-action="RESUME"],[data-action="ESCALATE"]').forEach(function (button) {
      button.addEventListener('click', function () {
        var card = button.closest('[data-panel]');
        var panelId = card ? card.getAttribute('data-panel') : 'unknown';
        var current = card && card.dataset.targetId ? card.dataset.targetId : panelId;
        sendIntent(button.dataset.action, panelId, current, card && card.dataset.targetContext ? card.dataset.targetContext : '')
          .catch(function (error) { detail(panelId, 'Intent não enviado: ' + error.message); });
      });
    });
    document.querySelectorAll('[data-action="BUDGET_READ"]').forEach(function (button) {
      button.addEventListener('click', function () {
        var card = button.closest('[data-panel]');
        var input = card && card.querySelector('[data-budget-minor]');
        var value = input ? Number(input.value) : 0;
        readBudgetRecommendation(value).catch(function (error) { detail('budget-recommendations', error.message); });
      });
    });
  }

  async function executeRead(capabilityId, payload) {
    return parseToolResult(await callTool('toca.execute', {
      capabilityId: capabilityId,
      payload: payload || {},
      correlationId: 'control-center:' + capabilityId + ':' + Date.now()
    }));
  }

  async function refreshApprovals() {
    var result = parseToolResult(await callTool('toca.approval.list', { statuses: ['REQUESTED', 'FAILED_REVIEW_REQUIRED'], limit: 50 }));
    var approvals = result && Array.isArray(result.approvals) ? result.approvals : [];
    detail('pending-approvals', approvals.length ? approvals : 'Nenhuma aprovação pendente.');
    var card = document.querySelector('[data-panel="pending-approvals"]');
    if (card && approvals[0]) {
      card.dataset.targetId = approvals[0].approval_id || approvals[0].approvalId || 'pending-approval';
      card.dataset.targetContext = 'version=' + (approvals[0].version || 'unknown') + ';capability=' + (approvals[0].capability_id || approvals[0].capabilityId || 'unknown');
    }
  }

  async function refreshPublications() {
    var result = await executeRead('instagram.toca_schedule.list', {});
    var jobs = result && result.result && Array.isArray(result.result.jobs) ? result.result.jobs :
      result && Array.isArray(result.jobs) ? result.jobs : [];
    detail('publications', jobs.length ? jobs : 'Nenhuma publicação agendada encontrada.');
    var dead = jobs.filter(function (job) { return /DEAD|FAIL|ERROR/i.test(String(job.status || '')); });
    detail('dead-letters', dead.length ? dead : 'Nenhum dead letter/failed job na lista governada.');
    var deadCard = document.querySelector('[data-panel="dead-letters"]');
    if (deadCard && dead[0]) deadCard.dataset.targetId = dead[0].id || dead[0].jobId || 'dead-letter';
  }

  function metaAccountFromResult(value) {
    var raw = value && value.result ? value.result : value;
    var candidates = raw && (raw.accounts || raw.data || raw.items);
    if (!Array.isArray(candidates) || !candidates[0]) return null;
    var item = candidates[0];
    var id = item.adAccountId || item.account_id || item.id;
    if (typeof id === 'string' && !id.startsWith('act_')) id = 'act_' + id;
    var currency = item.currency || item.currency_code || 'BRL';
    return id ? { adAccountId: id, currency: currency } : null;
  }

  async function ensureMetaAccount() {
    if (state.metaAccount) return state.metaAccount;
    var accounts = await executeRead('meta_ads.accounts.list', {});
    state.metaAccount = metaAccountFromResult(accounts);
    if (!state.metaAccount) throw new Error('Meta account READ não retornou uma conta utilizável.');
    return state.metaAccount;
  }

  async function refreshCampaigns() {
    var account = await ensureMetaAccount();
    var result = await executeRead('meta_ads.campaigns.list', account);
    var raw = result && result.result ? result.result : result;
    var campaigns = raw && (raw.campaigns || raw.data || raw.items || raw);
    if (!Array.isArray(campaigns)) campaigns = [];
    var paused = campaigns.filter(function (item) { return /PAUSED/i.test(String(item.status || item.effective_status || '')); });
    detail('prepared-campaigns', paused.length ? paused : campaigns.length ? campaigns : 'Nenhuma campanha retornada.');
    var card = document.querySelector('[data-panel="prepared-campaigns"]');
    if (card && (paused[0] || campaigns[0])) {
      var target = paused[0] || campaigns[0];
      card.dataset.targetId = target.id || target.campaignId || 'campaign';
      card.dataset.targetContext = 'provider=Meta;account=' + account.adAccountId + ';status=' + (target.status || target.effective_status || 'unknown');
    }
    await refreshDemand(account);
  }

  async function refreshDemand(account) {
    var demandPanel = panel('demand-index');
    if (!demandPanel || !demandPanel.sources.some(function (source) { return source.id === 'meta_ads.opportunity.detect' && source.available; })) {
      detail('demand-index', 'Aguardando PR #15 / capacidade meta_ads.opportunity.detect no Core.');
      return;
    }
    var demand = await executeRead('meta_ads.opportunity.detect', account);
    detail('demand-index', demand);
  }

  async function readBudgetRecommendation(currentBudgetMinor) {
    if (!Number.isInteger(currentBudgetMinor) || currentBudgetMinor <= 0) throw new Error('Informe o orçamento atual em centavos.');
    var budgetPanel = panel('budget-recommendations');
    if (!budgetPanel || !budgetPanel.sources.some(function (source) { return source.id === 'meta_ads.budget.recommend' && source.available; })) {
      throw new Error('Aguardando PR #15 / meta_ads.budget.recommend no Core.');
    }
    var account = await ensureMetaAccount();
    var payload = { adAccountId: account.adAccountId, currency: account.currency, currentBudgetMinor: currentBudgetMinor };
    var result = await executeRead('meta_ads.budget.recommend', payload);
    detail('budget-recommendations', result);
  }

  async function refreshHealth() {
    var health = parseToolResult(await callTool('toca.system.health', {}));
    var probes = { core: health, metaAdsRead: null, instagramRead: null };
    try { probes.metaAdsRead = await executeRead('meta_ads.accounts.list', {}); } catch (error) { probes.metaAdsRead = { ok: false, error: error.message }; }
    try { probes.instagramRead = await executeRead('instagram.media.list', { limit: 1 }); } catch (error) { probes.instagramRead = { ok: false, error: error.message }; }
    detail('provider-health', probes);
  }

  function wireToolbar(id, fn) {
    var button = document.getElementById(id);
    if (!button) return;
    button.addEventListener('click', async function () {
      setBusy(button, true);
      try { await fn(); } catch (error) { console.error(error); } finally { setBusy(button, false); }
    });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.id != null && state.requests.has(message.id)) {
      var pending = state.requests.get(message.id);
      state.requests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'MCP Apps request failed'));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === 'ui/notifications/tool-result' && message.params && message.params.structuredContent) render(message.params.structuredContent);
  });

  wireToolbar('refreshHealth', refreshHealth);
  wireToolbar('refreshPublications', refreshPublications);
  wireToolbar('refreshCampaigns', refreshCampaigns);
  wireToolbar('refreshApprovals', refreshApprovals);

  request('ui/initialize', {
    protocolVersion: protocolVersion,
    appInfo: { name: 'toca-human-control-center', title: 'TOCA Human Control Center', version: '1.0.0' },
    appCapabilities: {}
  }).then(function () {
    notify('ui/notifications/initialized', {});
  }).catch(function (error) {
    console.error('MCP Apps initialization failed', error);
  });
})();
</script>
</body>
</html>`;
}
