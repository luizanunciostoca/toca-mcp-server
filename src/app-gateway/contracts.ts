import { z } from 'zod';

export const actionTypeSchema = z.enum([
  'CREATE_CONTENT',
  'PLAN_CONTENT',
  'PUBLISH_SCHEDULE',
  'META_ADS',
  'SOCIAL_INBOX',
  'MEDIA_LIBRARY',
  'ANALYTICS',
  'COMMERCIAL',
  'OPERATIONS',
  'DOCUMENTS',
]);

export const actionModeSchema = z.enum(['AUTO', 'GUIDED', 'ADVANCED']);

export const tocaActionRequestSchema = z
  .object({
    action_type: actionTypeSchema,
    operation: z.string().trim().min(1).max(120),
    objective: z.string().trim().min(1).max(800),
    mode: actionModeSchema.default('AUTO'),
    inputs: z.record(z.string(), z.unknown()).default({}),
    client_context: z
      .object({
        app_version: z.string().trim().min(1).max(40).optional(),
        locale: z.string().trim().min(1).max(32).optional(),
        timezone: z.string().trim().min(1).max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ActionType = z.infer<typeof actionTypeSchema>;
export type ActionMode = z.infer<typeof actionModeSchema>;
export type TocaActionRequest = z.infer<typeof tocaActionRequestSchema>;

export type ActionAvailability = 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE' | 'BLOCKED';

export type TocaActionState =
  | 'DRAFT'
  | 'READY'
  | 'APPROVAL_REQUIRED'
  | 'RUNNING'
  | 'BLOCKED'
  | 'UNCERTAIN'
  | 'COMPLETED'
  | 'FAILED';

export interface ActionCapabilityRequirement {
  readonly allOf: readonly string[];
  readonly anyOf: readonly string[];
}

export interface ActionCardDefinition {
  readonly actionType: ActionType;
  readonly title: string;
  readonly description: string;
  readonly defaultMode: ActionMode;
  readonly requirement: ActionCapabilityRequirement;
}

export interface CapabilitySnapshot {
  readonly capabilityId: string;
  readonly lifecycleStatus: string;
  readonly availability: ActionAvailability;
  readonly provider: string | null;
  readonly riskClass: string | null;
  readonly sideEffects: boolean;
  readonly approvalHint: boolean;
  readonly reason: string;
}

export interface ActionCardSnapshot {
  readonly actionType: ActionType;
  readonly title: string;
  readonly description: string;
  readonly defaultMode: ActionMode;
  readonly availability: ActionAvailability;
  readonly approvalHint: boolean;
  readonly capabilities: readonly CapabilitySnapshot[];
  readonly reasons: readonly string[];
}

export interface TocaAction {
  readonly actionId: string;
  readonly correlationId: string;
  readonly request: TocaActionRequest;
  readonly state: TocaActionState;
  readonly availability: ActionAvailability;
  readonly approvalHint: boolean;
  readonly reasons: readonly string[];
  readonly createdAt: string;
}

export type ActionExecutionPhase =
  | 'PREPARED'
  | 'APPROVAL_REQUIRED'
  | 'RUNNING'
  | 'BLOCKED'
  | 'PROVIDER_UNCERTAIN'
  | 'PROVIDER_VERIFIED'
  | 'FAILED';

export type ActionEventType =
  | 'ACTION_PREPARED'
  | 'APPROVAL_REQUIRED'
  | 'EXECUTION_STARTED'
  | 'EXECUTION_BLOCKED'
  | 'PROVIDER_UNCERTAIN'
  | 'PROVIDER_VERIFIED'
  | 'EXECUTION_FAILED';

export interface TocaActionEvent {
  readonly eventId: string;
  readonly actionId: string;
  readonly correlationId: string;
  readonly sequence: number;
  readonly type: ActionEventType;
  readonly state: TocaActionState;
  readonly message: string;
  readonly occurredAt: string;
  readonly details: Readonly<Record<string, unknown>>;
}
