import { randomUUID } from 'node:crypto';
import type {
  ActionEventType,
  ActionExecutionPhase,
  TocaAction,
  TocaActionEvent,
  TocaActionState,
} from './contracts.js';

export function actionStateFromExecutionPhase(phase: ActionExecutionPhase): TocaActionState {
  switch (phase) {
    case 'PREPARED':
      return 'READY';
    case 'APPROVAL_REQUIRED':
      return 'APPROVAL_REQUIRED';
    case 'RUNNING':
      return 'RUNNING';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'PROVIDER_UNCERTAIN':
      return 'UNCERTAIN';
    case 'PROVIDER_VERIFIED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
  }
}

export function actionEventTypeFromPhase(phase: ActionExecutionPhase): ActionEventType {
  switch (phase) {
    case 'PREPARED':
      return 'ACTION_PREPARED';
    case 'APPROVAL_REQUIRED':
      return 'APPROVAL_REQUIRED';
    case 'RUNNING':
      return 'EXECUTION_STARTED';
    case 'BLOCKED':
      return 'EXECUTION_BLOCKED';
    case 'PROVIDER_UNCERTAIN':
      return 'PROVIDER_UNCERTAIN';
    case 'PROVIDER_VERIFIED':
      return 'PROVIDER_VERIFIED';
    case 'FAILED':
      return 'EXECUTION_FAILED';
  }
}

export function createTocaActionEvent(input: {
  readonly action: TocaAction;
  readonly phase: ActionExecutionPhase;
  readonly sequence: number;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly createId?: () => string;
  readonly now?: () => string;
}): TocaActionEvent {
  const createId = input.createId ?? randomUUID;
  const now = input.now ?? (() => new Date().toISOString());
  return {
    eventId: createId(),
    actionId: input.action.actionId,
    correlationId: input.action.correlationId,
    sequence: input.sequence,
    type: actionEventTypeFromPhase(input.phase),
    state: actionStateFromExecutionPhase(input.phase),
    message: input.message,
    occurredAt: now(),
    details: input.details ?? {},
  };
}
