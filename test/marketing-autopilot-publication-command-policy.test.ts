import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertSchedulingPolicyAllowsIntent,
  type PublicationIntent,
  type SchedulingPolicy,
} from '../src/marketing-autopilot-scheduling.js';

type CommandEnvelope = {
  action: 'NOOP' | 'PREPARE' | 'PUBLISH';
  schedulingPolicy?: SchedulingPolicy;
  publicationIntent?: PublicationIntent;
};

function assertCommandPolicy(command: CommandEnvelope): void {
  if (!command.schedulingPolicy || !command.publicationIntent) {
    if (command.action === 'PUBLISH') throw new Error('PUBLICATION_POLICY_FIELDS_REQUIRED');
    return;
  }

  assertSchedulingPolicyAllowsIntent(command.schedulingPolicy, command.publicationIntent);

  if (
    command.action === 'PUBLISH' &&
    (command.schedulingPolicy !== 'SHARE_NOW' || command.publicationIntent !== 'SHARE_NOW')
  ) {
    throw new Error('PUBLISH_REQUIRES_EXPLICIT_SHARE_NOW');
  }
}

describe('publication command scheduling policy', () => {
  it('keeps the checked-in bridge fail-closed and policy-consistent', () => {
    const command = JSON.parse(
      readFileSync('control/marketing-autopilot-publication-command.json', 'utf8'),
    ) as CommandEnvelope;

    expect(() => assertCommandPolicy(command)).not.toThrow();
  });

  it('rejects PUBLISH used as a future scheduling substitute', () => {
    expect(() =>
      assertCommandPolicy({
        action: 'PUBLISH',
        schedulingPolicy: 'TOCA_MANAGED_SCHEDULING',
        publicationIntent: 'TOCA_SCHEDULE',
      }),
    ).toThrow('PUBLISH_REQUIRES_EXPLICIT_SHARE_NOW');
  });

  it('rejects mismatched scheduling policy and intent', () => {
    expect(() =>
      assertCommandPolicy({
        action: 'PREPARE',
        schedulingPolicy: 'TOCA_MANAGED_SCHEDULING',
        publicationIntent: 'NATIVE_SCHEDULE',
      }),
    ).toThrow('TOCA_MANAGED_SCHEDULING_POLICY_DENIED');
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
