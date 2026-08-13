import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertSchedulingPolicyAllowsIntent } from '../src/marketing-autopilot-scheduling.js';

type CommandEnvelope = {
  action: 'NOOP' | 'PREPARE' | 'PUBLISH';
  schedulingPolicy?: 'NATIVE_PROVIDER_SCHEDULING_ONLY' | 'SHARE_NOW';
  publicationIntent?: 'NATIVE_SCHEDULE' | 'PUBLISH_AT_WINDOW' | 'SHARE_NOW';
};

function assertCommandPolicy(command: CommandEnvelope): void {
  if (command.action !== 'PUBLISH') return;

  if (!command.schedulingPolicy || !command.publicationIntent) {
    throw new Error('PUBLICATION_POLICY_FIELDS_REQUIRED');
  }

  assertSchedulingPolicyAllowsIntent(command.schedulingPolicy, command.publicationIntent);

  if (command.schedulingPolicy !== 'SHARE_NOW' || command.publicationIntent !== 'SHARE_NOW') {
    throw new Error('PUBLISH_REQUIRES_EXPLICIT_SHARE_NOW');
  }
}

describe('publication command scheduling policy', () => {
  it('keeps the checked-in bridge fail-closed', () => {
    const command = JSON.parse(
      readFileSync('control/marketing-autopilot-publication-command.json', 'utf8'),
    ) as CommandEnvelope;

    expect(() => assertCommandPolicy(command)).not.toThrow();
  });

  it('rejects PUBLISH used as a future scheduling substitute', () => {
    expect(() =>
      assertCommandPolicy({
        action: 'PUBLISH',
        schedulingPolicy: 'NATIVE_PROVIDER_SCHEDULING_ONLY',
        publicationIntent: 'PUBLISH_AT_WINDOW',
      }),
    ).toThrow('NATIVE_PROVIDER_SCHEDULING_ONLY_POLICY_DENIED');
  });

  it('allows PUBLISH only for explicit SHARE_NOW', () => {
    expect(() =>
      assertCommandPolicy({
        action: 'PUBLISH',
        schedulingPolicy: 'SHARE_NOW',
        publicationIntent: 'SHARE_NOW',
      }),
    ).not.toThrow();
  });
});
