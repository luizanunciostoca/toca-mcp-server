import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('TOCA managed Instagram operator ingress', () => {
  it('keeps GitHub as an authenticated request ingress, never as the publication clock', async () => {
    const workflow = await readFile('.github/workflows/toca-managed-instagram-operator.yml', 'utf8');

    expect(workflow).toContain("CONTROL_ISSUE: '308'");
    expect(workflow).toContain("ALLOWED_ACTOR: 'luizanunciostoca'");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain('TOCA_MANAGED_INSTAGRAM_SCHEDULER_ENABLED=true');
    expect(workflow).toContain('--args dist/src/toca-managed-instagram-schedule-command.js');
    expect(workflow).toContain('schedulerStatus=`TOCA_SCHEDULED`');
    expect(workflow).not.toContain('schedule:');
    expect(workflow).not.toContain('instagram-controlled-publication.js');
    expect(workflow).not.toContain('INSTAGRAM_PUBLICATION_WRITES_ENABLED=true');
  });

  it('routes schedule creation through the generic policy and audit execution layer', async () => {
    const command = await readFile('src/toca-managed-instagram-schedule-command.ts', 'utf8');

    expect(command).toContain("executeTool({");
    expect(command).toContain('new PostgresAuditSink(pool, registry)');
    expect(command).toContain("roles: ['OPERATOR']");
    expect(command).toContain("allowedCapabilityIds: ['instagram.toca_schedule.create']");
    expect(command).toContain('TOCA_SCHEDULE_COMMAND_RESULT=');
  });
});
