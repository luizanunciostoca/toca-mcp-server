import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/core/policy.js';
import type { ToolDefinition } from '../src/core/tool-registry.js';

const writeTool: ToolDefinition = {
  name: 'test.platform.write',
  version: '1.0.0',
  provider: 'test',
  riskClass: 'WRITE_EXTERNAL',
  requiredScopes: [],
  capabilityStatus: 'PRODUCTION_VALIDATED',
  sideEffects: true,
  idempotent: false,
};

const readTool: ToolDefinition = {
  ...writeTool,
  name: 'test.platform.read',
  riskClass: 'READ',
  sideEffects: false,
  idempotent: true,
};

describe('platform mutation kill switch', () => {
  it('denies side-effect capabilities before authorization or provider execution', () => {
    expect(evaluatePolicy(writeTool, { platformKillSwitch: true })).toEqual({
      decision: 'DENY',
      reason: 'Platform mutation kill switch is active.',
    });
  });

  it('does not block read-only capabilities', () => {
    expect(evaluatePolicy(readTool, { platformKillSwitch: true })).toEqual({
      decision: 'ALLOW',
      reason: 'Policy requirements satisfied.',
    });
  });
});
