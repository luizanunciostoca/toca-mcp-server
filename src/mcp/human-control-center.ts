import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ExecutionIdentityResolver } from '../core/identity.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import { resolveCapabilityDefinition } from '../governance/capability-resolution.js';
import type { CoreCapabilityRuntimeResolver } from './core-execution.js';
import { CORE_MCP_TOOL_NAMES } from './core-surface.js';

export const CONTROL_CENTER_TOOL_NAME = 'toca.control_center.open';
export const CONTROL_CENTER_RESOURCE_URI = 'ui://toca/human-control-center-v1.html';
export const CONTROL_CENTER_VERSION = '1.0.0';

export const CONTROL_CENTER_PANEL_IDS = [
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

export type ControlCenterPanelId = (typeof CONTROL_CENTER_PANEL_IDS)[number];
export type ControlCenterPanelState = 'READY' | 'PARTIAL' | 'DEPENDENCY_PENDING';

export interface ControlCenterPanelSource {
  readonly kind: 'CORE_TOOL' | 'CAPABILITY';
  readonly id: string;
  readonly available: boolean;
  readonly lifecycleStatus?: string | null;
  readonly provider?: string | null;
}

export interface ControlCenterPanel {
  readonly id: ControlCenterPanelId;
  readonly title: string;
  readonly description: string;
  readonly state: ControlCenterPanelState;
  readonly sources: readonly ControlCenterPanelSource[];
  readonly dependency: string | null;
  readonly notes: readonly string[];
}

export interface ControlCenterSurfaceDependencies {
  readonly registry: ToolRegistry;
  readonly runtimeResolver: CoreCapabilityRuntimeResolver;
  readonly resolveIdentity: ExecutionIdentityResolver;
  readonly approvalStoreAvailable: boolean;
  readonly workflowStoreAvailable: boolean;
  readonly auditStoreAvailable: boolean;
  readonly eventStoreAvailable: boolean;
}

interface PanelDefinition {
  readonly id: ControlCenterPanelId;
  readonly title: string;
  readonly description: string;
  readonly coreTools?: readonly string[];
  readonly capabilityIds?: readonly string[];
  readonly dependency?: string;
  readonly notes?: readonly string[];
}

const PANEL_DEFINITIONS: readonly PanelDefinition[] = [
  {
    id: 'pending-approvals',
    title: 'Pending approvals',
    description: 'Formal ApprovalRecords waiting for human review.',
    coreTools: ['toca.approval.list', 'toca.approval.get'],
    dependency:
      'Current Core exposes approval.get but not a tenant-safe approval list. Keep this panel fail-closed until canonical Core READ exposure exists.',
    notes: [
      'The view never mutates ApprovalRecord directly.',
      'Approve/reject emits an AG-01 intent and must re-enter the governed Core path.',
    ],
  },
  {
    id: 'prepared-campaigns',
    title: 'Prepared campaigns',
    description: 'Paid-media campaigns and PAUSED candidates discovered only through governed provider READ.',
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
    dependency:
      'PR #22 owns advanced CRM/Sales. Activate only after it exposes a governed Core READ capability.',
  },
  {
    id: 'critical-leads',
    title: 'Critical leads',
    description: 'High-priority leads requiring human attention.',
    dependency: 'PR #22 owns canonical lead scoring; do not duplicate scoring in Control Center.',
  },
  {
    id: 'next-actions',
    title: 'Next actions',
    description: 'Canonical CRM next actions and SLA follow-ups.',
    dependency: 'PR #22 owns next-action records; no parallel task store is permitted.',
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
    description: 'Failed managed jobs surfaced from the existing scheduler state.',
    capabilityIds: ['instagram.toca_schedule.list'],
    notes: ['Control Center does not create a second dead-letter queue.'],
  },
  {
    id: 'demand-index',
    title: 'Demand Index',
    description: 'Morro demand signal from the canonical Meta Ads intelligence engine.',
    capabilityIds: ['meta_ads.opportunity.detect', 'meta_ads.audience.inspect'],
    dependency: 'PR #15 until merged into main.',
    notes: [
      'Meta audience estimate is modeled aggregate MAU, never an exact count of people or devices physically present.',
    ],
  },
  {
    id: 'budget-recommendations',
    title: 'Budget recommendations',
    description: 'READ-only guarded recommendation; this view never changes provider budget.',
    capabilityIds: ['meta_ads.budget.recommend'],
    dependency: 'PR #15 until merged into main.',
  },
  {
    id: 'experiments',
    title: 'Experiments',
    description: 'Experiment state and learnings from the canonical lifecycle.',
    dependency:
      'Requires governed Core experiment list/read exposure. No parallel experiment store is created.',
  },
  {
    id: 'incidents',
    title: 'Incidents',
    description: 'Operational incidents and escalations.',
    dependency:
      'PR #20 provides observability/incident contracts; a governed Core READ capability is still required.',
  },
  {
    id: 'slo-status',
    title: 'SLO status',
    description: 'Service-level objectives and alert health.',
    dependency:
      'PR #20 provides the typed SLO catalog; a governed Core READ capability is still required.',
  },
];

const CORE_TOOLS = new Set<string>(CORE_MCP_TOOL_NAMES);

export function registerTocaControlCenterSurface(
  server: McpServer,
  dependencies: ControlCenterSurfaceDependencies,
): void {
  server.registerTool(
    CONTROL_CENTER_TOOL_NAME,
    {
      title: 'TOCA Human Control Center',
      description:
        'Open the governed TOCA OS control dashboard. The view performs READs only and routes mutations back to AG-01/Core.',
      inputSchema: z.object({ focus: z.enum(CONTROL_CENTER_PANEL_IDS).optional() }),
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
        (panel) => focus === undefined || panel.id === focus,
      );
      return response({
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
        actions: ['APPROVE', 'REJECT', 'PAUSE', 'RESUME', 'ESCALATE'].map(actionContract),
      });
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
      contents: [{ uri: uri.href, mimeType: 'text/html+mcp', text: controlCenterHtml() }],
    }),
  );
}

export function buildControlCenterPanels(
  dependencies: Pick<
    ControlCenterSurfaceDependencies,
    | 'registry'
    | 'runtimeResolver'
    | 'approvalStoreAvailable'
    | 'workflowStoreAvailable'
    | 'auditStoreAvailable'
    | 'eventStoreAvailable'
  >,
): readonly ControlCenterPanel[] {
  return PANEL_DEFINITIONS.map((definition) => {
    const coreSources = (definition.coreTools ?? []).map((id): ControlCenterPanelSource => ({
      kind: 'CORE_TOOL',
      id,
      available: coreToolAvailable(id, dependencies),
    }));
    const capabilitySources = (definition.capabilityIds ?? []).map(
      (id): ControlCenterPanelSource => {
        const resolved = resolveCapabilityDefinition(id);
        const canonical = resolved?.canonical_definition;
        const canonicalId = resolved?.canonical_id;
        return {
          kind: 'CAPABILITY',
          id,
          available: Boolean(
            canonicalId &&
              dependencies.registry.get(canonicalId) &&
              dependencies.runtimeResolver(canonicalId),
          ),
          lifecycleStatus: canonical?.lifecycle_status ?? null,
          provider: canonical?.provider ?? null,
        };
      },
    );
    const sources = [...coreSources, ...capabilitySources];
    const availableCount = sources.filter((source) => source.available).length;
    const state: ControlCenterPanelState =
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
    | 'approvalStoreAvailable'
    | 'workflowStoreAvailable'
    | 'auditStoreAvailable'
    | 'eventStoreAvailable'
  >,
): boolean {
  if (!CORE_TOOLS.has(id)) return false;
  if (id.startsWith('toca.approval.')) return dependencies.approvalStoreAvailable;
  if (id.startsWith('toca.workflow.')) return dependencies.workflowStoreAvailable;
  if (id === 'toca.audit.query') return dependencies.auditStoreAvailable;
  if (id === 'toca.event.get') return dependencies.eventStoreAvailable;
  return true;
}

function actionContract(action: string) {
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
  };
}

function response(output: Readonly<Record<string, unknown>>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    structuredContent: output as Record<string, unknown>,
  };
}

function controlCenterHtml(): string {
  return String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TOCA Human Control Center</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:Canvas;color:CanvasText}.shell{max-width:1440px;margin:auto;padding:18px}.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.62}h1{font-size:clamp(25px,4vw,38px);line-height:1;margin:5px 0}.sub{margin:0;opacity:.7;max-width:760px}.guard,.card,.stat{border:1px solid color-mix(in srgb,CanvasText 14%,transparent);border-radius:14px}.guard{padding:10px 12px;min-width:230px}.guard strong{display:block;font-size:12px}.guard span,.foot{font-size:10px;opacity:.62}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:14px 0}.stat{padding:11px}.stat b{display:block;font-size:21px}.stat span{font-size:10px;opacity:.65}.toolbar,.actions,.sources,.row{display:flex;gap:6px;flex-wrap:wrap}.toolbar{margin:14px 0}.btn,input{font:inherit;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);background:Canvas;color:CanvasText;border-radius:9px;padding:7px 9px}.btn{cursor:pointer}.btn:hover{background:color-mix(in srgb,CanvasText 8%,Canvas)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.card{padding:12px;min-height:190px;display:flex;flex-direction:column;gap:7px}.head{display:flex;justify-content:space-between;gap:8px;align-items:center}.head h2{font-size:14px;margin:0}.pill,.source{font-size:9px;border-radius:999px;padding:3px 6px}.pill{border:1px solid currentColor;opacity:.8}.source{background:color-mix(in srgb,CanvasText 7%,Canvas)}.source.off{opacity:.4;text-decoration:line-through}.desc{font-size:11px;opacity:.7;margin:0}.dep{font-size:10px;opacity:.62}.detail{font-size:10px;line-height:1.4;white-space:pre-wrap;overflow:auto;max-height:180px;padding:7px;border-radius:9px;background:color-mix(in srgb,CanvasText 5%,Canvas)}.actions{margin-top:auto}.row input{min-width:0;width:100%;flex:1}.foot{margin-top:15px}@media(max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.shell{padding:12px}.top{display:block}.guard{margin-top:10px}.grid{grid-template-columns:1fr}}
</style>
</head>
<body><main class="shell">
<section class="top"><div><div class="eyebrow">TOCA OS · Human Control Center</div><h1>Controle humano, Core governado.</h1><p class="sub">READs passam por tools/capabilities do Core. Ações humanas voltam ao AG-01 como intent; a view nunca escreve em provider.</p></div><div class="guard"><strong>PROVIDER WRITE BLOQUEADO NA VIEW</strong><span>identity → policy → approval → idempotency → readback → audit</span></div></section>
<section class="stats"><div class="stat"><b id="ready">–</b><span>prontos</span></div><div class="stat"><b id="partial">–</b><span>parciais</span></div><div class="stat"><b id="blocked">–</b><span>dependências</span></div><div class="stat"><b id="actor">–</b><span>principal</span></div></section>
<div class="toolbar"><button class="btn" id="health">Health + providers</button><button class="btn" id="publications">Publications</button><button class="btn" id="campaigns">Meta campaigns</button><button class="btn" id="approvals">Pending approvals</button></div>
<section class="grid" id="grid"></section><div class="foot">TOCA Human Control Center v1 · same Core, same identity, same policy, same approval, same audit.</div>
</main>
<script>
(function(){'use strict';
var state={model:null,pending:new Map(),next:1,metaAccount:null};
function post(message){window.parent.postMessage(message,'*')}
function request(method,params){var id=state.next++;return new Promise(function(resolve,reject){state.pending.set(id,{resolve:resolve,reject:reject});post({jsonrpc:'2.0',id:id,method:method,params:params})})}
function notify(method,params){post({jsonrpc:'2.0',method:method,params:params||{}})}
function callTool(name,args){return request('tools/call',{name:name,arguments:args||{}})}
function parse(result){if(!result)return null;if(result.structuredContent)return result.structuredContent;if(result.result&&result.result.structuredContent)return result.result.structuredContent;var content=result.content||(result.result&&result.result.content);if(Array.isArray(content)){var item=content.find(function(v){return v&&v.type==='text'});if(item&&item.text){try{return JSON.parse(item.text)}catch(_){return{text:item.text}}}}return result}
function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')}
function pretty(value){return JSON.stringify(value,null,2)}
function panel(id){return state.model&&state.model.panels.find(function(v){return v.id===id})}
function sourceAvailable(panelId,sourceId){var p=panel(panelId);return Boolean(p&&p.sources.some(function(s){return s.id===sourceId&&s.available}))}
function detail(id,value){var node=document.querySelector('[data-detail="'+id+'"]');if(node)node.textContent=typeof value==='string'?value:pretty(value)}
function actionButtons(id){if(id==='pending-approvals')return '<button class="btn" data-intent="APPROVE">Approve</button><button class="btn" data-intent="REJECT">Reject</button>';if(id==='prepared-campaigns')return '<button class="btn" data-intent="PAUSE">Pause</button><button class="btn" data-intent="RESUME">Resume</button>';if(id==='critical-leads'||id==='dead-letters'||id==='incidents')return '<button class="btn" data-intent="ESCALATE">Escalate</button>';return ''}
function renderPanel(p){var sources=(p.sources||[]).map(function(s){return '<span class="source '+(s.available?'':'off')+'">'+esc(s.id)+'</span>'}).join('');var dep=p.dependency?'<div class="dep">'+esc(p.dependency)+'</div>':'';var budget=p.id==='budget-recommendations'?'<div class="row"><input type="number" min="1" step="1" data-budget placeholder="Orçamento atual (centavos)"><button class="btn" data-budget-read>Calcular</button></div>':'';return '<article class="card" data-panel="'+p.id+'"><div class="head"><h2>'+esc(p.title)+'</h2><span class="pill">'+p.state+'</span></div><p class="desc">'+esc(p.description)+'</p><div class="sources">'+sources+'</div>'+dep+budget+'<div class="detail" data-detail="'+p.id+'">Aguardando leitura governada.</div><div class="actions">'+actionButtons(p.id)+'</div></article>'}
function render(model){state.model=model;var panels=Array.isArray(model.panels)?model.panels:[];document.getElementById('ready').textContent=panels.filter(function(p){return p.state==='READY'}).length;document.getElementById('partial').textContent=panels.filter(function(p){return p.state==='PARTIAL'}).length;document.getElementById('blocked').textContent=panels.filter(function(p){return p.state==='DEPENDENCY_PENDING'}).length;document.getElementById('actor').textContent=model.actor&&model.actor.principalId?model.actor.principalId.replace('mcp-client:',''):'authenticated';document.getElementById('grid').innerHTML=panels.map(renderPanel).join('');bindCards()}
function sendIntent(action,panelId,targetId,context){var key='cc:'+action.toLowerCase()+':'+panelId+':'+targetId;var text=['[TOCA_CONTROL_CENTER_ACTION_INTENT]','action='+action,'target_kind='+panelId,'target_id='+targetId,'idempotency_key='+key,context?'context='+context:'','required_path=identity>typed_schema>authorization>policy_risk>approval_when_required>idempotency>workflow>provider_when_applicable>provider_readback_when_applicable>audit_outbox_event','prohibited=direct_provider_write,parallel_backend,parallel_approval_engine,parallel_policy_engine'].filter(Boolean).join('\n');return request('ui/message',{role:'user',content:[{type:'text',text:text}]})}
function bindCards(){document.querySelectorAll('[data-intent]').forEach(function(button){button.addEventListener('click',function(){var card=button.closest('[data-panel]');var panelId=card?card.dataset.panel:'unknown';var target=card&&card.dataset.targetId?card.dataset.targetId:panelId;sendIntent(button.dataset.intent,panelId,target,card&&card.dataset.targetContext?card.dataset.targetContext:'').catch(function(error){detail(panelId,'Intent não enviado: '+error.message)})})});document.querySelectorAll('[data-budget-read]').forEach(function(button){button.addEventListener('click',function(){var card=button.closest('[data-panel]');var input=card&&card.querySelector('[data-budget]');readBudget(Number(input&&input.value)).catch(function(error){detail('budget-recommendations',error.message)})})})}
async function executeRead(capabilityId,payload){return parse(await callTool('toca.execute',{capabilityId:capabilityId,payload:payload||{},correlationId:'control-center:'+capabilityId+':'+Date.now()}))}
async function refreshApprovals(){if(!sourceAvailable('pending-approvals','toca.approval.list')){detail('pending-approvals','Fail-closed: a main atual não expõe listagem tenant-safe de ApprovalRecord. approval.get continua disponível quando o ID é conhecido.');return}var result=parse(await callTool('toca.approval.list',{statuses:['REQUESTED','FAILED_REVIEW_REQUIRED'],limit:50}));var approvals=result&&Array.isArray(result.approvals)?result.approvals:[];detail('pending-approvals',approvals.length?approvals:'Nenhuma aprovação pendente.');var card=document.querySelector('[data-panel="pending-approvals"]');if(card&&approvals[0]){card.dataset.targetId=approvals[0].approval_id||approvals[0].approvalId||'approval';card.dataset.targetContext='version='+(approvals[0].version||'unknown')+';capability='+(approvals[0].capability_id||approvals[0].capabilityId||'unknown')}}
async function refreshPublications(){var result=await executeRead('instagram.toca_schedule.list',{});var raw=result&&result.result?result.result:result;var jobs=raw&&Array.isArray(raw.jobs)?raw.jobs:[];detail('publications',jobs.length?jobs:'Nenhuma publicação agendada.');var dead=jobs.filter(function(job){return /DEAD|FAIL|ERROR/i.test(String(job.status||''))});detail('dead-letters',dead.length?dead:'Nenhum dead letter/failed job na lista governada.');var card=document.querySelector('[data-panel="dead-letters"]');if(card&&dead[0])card.dataset.targetId=dead[0].id||dead[0].jobId||'dead-letter'}
function metaAccountFrom(value){var raw=value&&value.result?value.result:value;var candidates=raw&&(raw.accounts||raw.data||raw.items);if(!Array.isArray(candidates)||!candidates[0])return null;var item=candidates[0];var id=item.adAccountId||item.account_id||item.id;var currency=item.currency||item.currency_code;if(typeof id==='string'&&!id.startsWith('act_'))id='act_'+id;return typeof id==='string'&&typeof currency==='string'&&currency?{adAccountId:id,currency:currency}:null}
async function ensureMetaAccount(){if(state.metaAccount)return state.metaAccount;state.metaAccount=metaAccountFrom(await executeRead('meta_ads.accounts.list',{}));if(!state.metaAccount)throw new Error('Meta account READ não retornou ID + currency; nenhum valor será inferido.');return state.metaAccount}
async function refreshCampaigns(){var account=await ensureMetaAccount();var result=await executeRead('meta_ads.campaigns.list',account);var raw=result&&result.result?result.result:result;var campaigns=raw&&(raw.campaigns||raw.data||raw.items||raw);if(!Array.isArray(campaigns))campaigns=[];var paused=campaigns.filter(function(item){return /PAUSED/i.test(String(item.status||item.effective_status||''))});detail('prepared-campaigns',paused.length?paused:campaigns.length?campaigns:'Nenhuma campanha retornada.');var card=document.querySelector('[data-panel="prepared-campaigns"]');var target=paused[0]||campaigns[0];if(card&&target){card.dataset.targetId=target.id||target.campaignId||'campaign';card.dataset.targetContext='provider=Meta;account='+account.adAccountId+';status='+(target.status||target.effective_status||'unknown')}if(sourceAvailable('demand-index','meta_ads.opportunity.detect')){detail('demand-index',await executeRead('meta_ads.opportunity.detect',account))}else{detail('demand-index','Aguardando PR #15 / capability governada no Core.')}}
async function readBudget(currentBudgetMinor){if(!Number.isInteger(currentBudgetMinor)||currentBudgetMinor<=0)throw new Error('Informe orçamento atual em centavos.');if(!sourceAvailable('budget-recommendations','meta_ads.budget.recommend'))throw new Error('Aguardando PR #15 / meta_ads.budget.recommend no Core.');var account=await ensureMetaAccount();detail('budget-recommendations',await executeRead('meta_ads.budget.recommend',{adAccountId:account.adAccountId,currency:account.currency,currentBudgetMinor:currentBudgetMinor}))}
async function refreshHealth(){var probes={core:parse(await callTool('toca.system.health',{})),metaAdsRead:null,instagramRead:null};try{probes.metaAdsRead=await executeRead('meta_ads.accounts.list',{})}catch(error){probes.metaAdsRead={ok:false,error:error.message}}try{probes.instagramRead=await executeRead('instagram.media.list',{limit:1})}catch(error){probes.instagramRead={ok:false,error:error.message}}detail('provider-health',probes)}
function wire(id,fn){var button=document.getElementById(id);if(button)button.addEventListener('click',function(){fn().catch(function(error){console.error(error)})})}
window.addEventListener('message',function(event){if(event.source!==window.parent)return;var message=event.data;if(!message||message.jsonrpc!=='2.0')return;if(message.id!=null&&state.pending.has(message.id)){var pending=state.pending.get(message.id);state.pending.delete(message.id);if(message.error)pending.reject(new Error(message.error.message||'MCP Apps request failed'));else pending.resolve(message.result);return}if(message.method==='ui/notifications/tool-result'&&message.params&&message.params.structuredContent)render(message.params.structuredContent)});
wire('health',refreshHealth);wire('publications',refreshPublications);wire('campaigns',refreshCampaigns);wire('approvals',refreshApprovals);
request('ui/initialize',{protocolVersion:'2026-07-28',appInfo:{name:'toca-human-control-center',title:'TOCA Human Control Center',version:'1.0.0'},appCapabilities:{}}).then(function(){notify('ui/notifications/initialized',{})}).catch(function(error){console.error('MCP Apps initialization failed',error)});
})();
</script></body></html>`;
}
