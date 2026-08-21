import type { ToolDefinition } from '../core/tool-registry.js';

// These READ tools consume tenant-scoped provider events already persisted in PostgreSQL;
// they do not invoke external provider APIs or require provider credentials at execution time.
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
];
