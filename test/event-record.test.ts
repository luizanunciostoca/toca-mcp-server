import { describe, expect, it } from 'vitest';
import {
  assertEventRecordStatusTransition,
  requireEventRecordEvidence,
  validateEventRecord,
  validateSchedule,
  type EventRecord,
} from '../src/events/event-record.js';

const base: EventRecord = {
  eventId: 'evt-business-1',
  eventKey: 'sunset:2026-08-15',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  organizationId: 'org-1',
  seriesKey: 'sunset',
  name: 'Experiência de sábado',
  eventType: 'public-experience',
  status: 'PLANNED',
  startsAt: '2026-08-15T19:30:00.000Z',
  endsAt: '2026-08-16T01:00:00.000Z',
  timezone: 'America/Bahia',
  venueName: 'Venue principal',
  attributes: { audience: 'public', capacityKnown: false, note: null },
  version: 1,
  createdAt: '2026-08-15T12:00:00.000Z',
  updatedAt: '2026-08-15T12:00:00.000Z',
};

describe('M-FOUND-09 EventRecord contract', () => {
  it('validates a canonical business event without hardcoding a Toca-specific type', () => {
    expect(() => validateEventRecord(base)).not.toThrow();
    expect(base.eventType).toBe('public-experience');
  });

  it('enforces the business event lifecycle and terminal archival boundary', () => {
    expect(() => assertEventRecordStatusTransition('PLANNED', 'CONFIRMED')).not.toThrow();
    expect(() => assertEventRecordStatusTransition('CONFIRMED', 'ON_SALE')).not.toThrow();
    expect(() => assertEventRecordStatusTransition('IN_PROGRESS', 'COMPLETED')).not.toThrow();
    expect(() => assertEventRecordStatusTransition('COMPLETED', 'ARCHIVED')).not.toThrow();
    expect(() => assertEventRecordStatusTransition('ARCHIVED', 'PLANNED')).toThrow(
      'EVENT_RECORD_STATUS_TRANSITION_INVALID:ARCHIVED:PLANNED',
    );
    expect(() => assertEventRecordStatusTransition('COMPLETED', 'ON_SALE')).toThrow(
      'EVENT_RECORD_STATUS_TRANSITION_INVALID:COMPLETED:ON_SALE',
    );
  });

  it('rejects invalid schedules and invalid IANA timezones', () => {
    expect(() =>
      validateSchedule('2026-08-15T20:00:00.000Z', '2026-08-15T19:00:00.000Z', 'America/Bahia'),
    ).toThrow('EVENT_RECORD_TIME_RANGE_INVALID');
    expect(() =>
      validateSchedule('2026-08-15T19:00:00.000Z', '2026-08-15T20:00:00.000Z', 'Mars/Olympus'),
    ).toThrow('EVENT_RECORD_TIMEZONE_INVALID');
  });

  it('normalizes evidence deterministically and rejects evidence-free mutations', () => {
    expect(requireEventRecordEvidence([' source:b ', 'source:a', 'source:a'])).toEqual([
      'source:a',
      'source:b',
    ]);
    expect(() => requireEventRecordEvidence([' ', ''])).toThrow('EVENT_RECORD_EVIDENCE_REQUIRED');
  });
});
