export interface StateMachineDefinition<State extends string> {
  readonly id: string;
  readonly initialState: State;
  readonly terminalStates: readonly State[];
  readonly transitions: Readonly<Record<State, readonly State[]>>;
}

export interface StateTransition<State extends string> {
  readonly from: State;
  readonly to: State;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly evidence: readonly string[];
}

export interface StateMachineInstance<State extends string> {
  readonly machineId: string;
  readonly state: State;
  readonly history: readonly StateTransition<State>[];
}

export function startStateMachine<State extends string>(
  definition: StateMachineDefinition<State>,
): StateMachineInstance<State> {
  validateStateMachineDefinition(definition);
  return { machineId: definition.id, state: definition.initialState, history: [] };
}

export function transitionState<State extends string>(
  definition: StateMachineDefinition<State>,
  instance: StateMachineInstance<State>,
  to: State,
  options: {
    readonly correlationId: string;
    readonly occurredAt?: string;
    readonly evidence?: readonly string[];
  },
): StateMachineInstance<State> {
  if (instance.machineId !== definition.id) throw new Error('STATE_MACHINE_ID_MISMATCH');
  const allowed = definition.transitions[instance.state] ?? [];
  if (!allowed.includes(to))
    throw new Error(`STATE_TRANSITION_NOT_ALLOWED:${instance.state}->${to}`);
  const transition: StateTransition<State> = {
    from: instance.state,
    to,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    correlationId: options.correlationId,
    evidence: options.evidence ?? [],
  };
  return { ...instance, state: to, history: [...instance.history, transition] };
}

export function isTerminalState<State extends string>(
  definition: StateMachineDefinition<State>,
  state: State,
): boolean {
  return definition.terminalStates.includes(state);
}

export function validateStateMachineDefinition<State extends string>(
  definition: StateMachineDefinition<State>,
): void {
  const transitionStates = Object.keys(definition.transitions) as State[];
  const states = new Set<string>(transitionStates);
  if (!states.has(definition.initialState)) throw new Error('STATE_MACHINE_INITIAL_STATE_MISSING');
  for (const terminal of definition.terminalStates) {
    if (!states.has(terminal)) throw new Error(`STATE_MACHINE_TERMINAL_STATE_MISSING:${terminal}`);
    if ((definition.transitions[terminal] ?? []).length > 0)
      throw new Error(`STATE_MACHINE_TERMINAL_HAS_TRANSITIONS:${terminal}`);
  }
  for (const state of transitionStates) {
    for (const target of definition.transitions[state] ?? []) {
      if (!states.has(target)) throw new Error(`STATE_MACHINE_TARGET_STATE_MISSING:${target}`);
    }
  }
}
