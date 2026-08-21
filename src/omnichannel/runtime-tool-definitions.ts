import type { ToolDefinition } from '../core/tool-registry.js';

// Implementation lifecycle only. Core Policy continues to deny these WRITE_EXTERNAL
// capabilities until a later evidence-backed PRODUCTION_VALIDATED promotion.
export const WHATSAPP_OUTBOUND_RUNTIME_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'whatsapp.message.send',
    version: '1.0.0',
    provider: 'Meta WhatsApp Cloud API',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: true,
  },
];

export const EMAIL_OUTBOUND_RUNTIME_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'email.campaign.send',
    version: '1.0.0',
    provider: 'Twilio SendGrid',
    riskClass: 'WRITE_EXTERNAL',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: true,
    idempotent: true,
  },
];

// Historical export name retained to avoid a broad registry refactor. It now represents
// the reconciled Omnichannel MCP surface: provider-event READs plus outbound send bindings.
export const OMNICHANNEL_READBACK_RUNTIME_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'email.delivery.readback',
    version: '1.0.0',
    provider: 'Twilio SendGrid',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  {
    name: 'whatsapp.message.readback',
    version: '1.0.0',
    provider: 'Meta WhatsApp Cloud API',
    riskClass: 'READ',
    requiredScopes: [],
    capabilityStatus: 'IMPLEMENTED',
    sideEffects: false,
    idempotent: true,
  },
  ...WHATSAPP_OUTBOUND_RUNTIME_TOOL_DEFINITIONS,
  ...EMAIL_OUTBOUND_RUNTIME_TOOL_DEFINITIONS,
];
