import { describe, expect, it } from 'vitest';
import { InMemoryAuditSink } from '../src/core/audit.js';
import { executeTool } from '../src/core/executor.js';
import { parseExecutionContext } from '../src/core/execution-context.js';
import { ExecutionError } from '../src/core/errors.js';
import { evaluatePolicy } from '../src/core/policy.js';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import { createToolRegistry } from '../src/registry.js';

const readTool: ToolDefinition = {
  name: 'system.health',
  version: '1.0.0',
  provider: 'system',
  riskClass: 'READ',
  requiredScopes: [],
  capabilityStatus: 'IMPLEMENTED',
  sideEffects: false,
  idempotent: true,
};

const writeTool: ToolDefinition = {
  name: 'instagram.publish.image',
  version: '1.0.0',
  provider: 'meta',
  riskClass: 'WRITE_EXTERNAL',
  requiredScopes: ['instagram_content_publish'],
  capabilityStatus: 'IMPLEMENTED',
  sideEffects: true,
  idempotent: true,
};

describe('ToolRegistry', () => {
  it('registers and lists definitions deterministically', () => {
    const registry = new ToolRegistry();
    registry.register(readTool);
    expect(registry.get('system.health')).toEqual(readTool);
    expect(registry.list()).toEqual([readTool]);
  });

  it('rejects duplicate tool names', () => {
    const registry = new ToolRegistry();
    registry.register(readTool);
    expect(() => registry.register(readTool)).toThrow(/already registered/);
  });

  it('exposes only bootstrap system capabilities before providers exist', () => {
    expect(
      createToolRegistry()
        .list()
        .map((tool) => tool.name),
    ).toEqual(['system.capabilities', 'system.health']);
  });
});

describe('evaluatePolicy', () => {
  it('allows non-mutating implemented capabilities', () => {
    expect(evaluatePolicy(readTool, { requester: 'test' }).decision).toBe('ALLOW');
  });

  it('denies side effects before production validation', () => {
    expect(evaluatePolicy(writeTool, { requester: 'test', approved: true }).decision).toBe('DENY');
  });

  it('requires approval for production-validated external writes', () => {
    const validated = {
      ...writeTool,
      capabilityStatus: 'PRODUCTION_VALIDATED' as const,
    };
    expect(evaluatePolicy(validated, { requester: 'test' }).decision).toBe('REQUIRE_APPROVAL');
    expect(evaluatePolicy(validated, { requester: 'test', approved: true }).decision).toBe('ALLOW');
  });
});

describe('executeTool', () => {
  it('audits successful allowed executions', async () => {
    const auditSink = new InMemoryAuditSink();
    const result = await executeTool({
      tool: readTool,
      policyContext: { requester: 'test-user' },
      auditSink,
      correlationId: 'corr_exec_001',
      action: () => Promise.resolve('ok'),
    });

    expect(result).toBe('ok');
    expect(auditSink.list().map((event) => event.status)).toEqual(['STARTED', 'SUCCEEDED']);
    expect(new Set(auditSink.list().map((event) => event.executionId)).size).toBe(1);
  });

  it('blocks writes that are not production validated before action execution', async () => {
    const auditSink = new InMemoryAuditSink();
    let called = false;

    await expect(
      executeTool({
        tool: writeTool,
        policyContext: { requester: 'test-user', approved: true },
        auditSink,
        correlationId: 'corr_exec_002',
        action: () => {
          called = true;
          return Promise.resolve('should-not-run');
        },
      }),
    ).rejects.toMatchObject<Partial<ExecutionError>>({ code: 'POLICY_DENIED' });

    expect(called).toBe(false);
    expect(auditSink.list().map((event) => event.status)).toEqual(['DENIED']);
  });
});

describe('ExecutionContext', () => {
  it('parses machine-actionable context without inventing optional facts', () => {
    expect(
      parseExecutionContext({
        brand: 'toca_do_morcego',
        businessDomain: 'marketing',
        timezone: 'America/Bahia',
        correlationId: 'corr_test_001',
      }),
    ).toEqual({
      brand: 'toca_do_morcego',
      businessDomain: 'marketing',
      timezone: 'America/Bahia',
      correlationId: 'corr_test_001',
    });
  });

  it('rejects invalid content states and negative budgets', () => {
    expect(() =>
      parseExecutionContext({
        brand: 'toca_do_morcego',
        businessDomain: 'marketing',
        timezone: 'America/Bahia',
        correlationId: 'corr_test_002',
        contentStatus: 'READY_TO_POST',
        budgetAuthorized: -1,
      }),
    ).toThrow();
  });
});
