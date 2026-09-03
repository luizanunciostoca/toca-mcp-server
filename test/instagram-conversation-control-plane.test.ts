import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifySocialEngagement } from '../src/crm/social-engagement-classifier.js';
import {
  normalizeQuestionForAnalytics,
  projectCanonicalIntents,
} from '../src/instagram-engagement/conversation-control-plane.js';

const migration = readFileSync('migrations/039_instagram_conversation_control_plane.sql', 'utf8');
const source = readFileSync('src/instagram-engagement/conversation-control-plane.ts', 'utf8');

describe('Instagram conversation control plane hardening', () => {
  it('projects event, product and operational intents without losing secondary intent context', () => {
    const classification = classifySocialEngagement('Que horas começa a The Party?');
    const projected = projectCanonicalIntents(classification);
    expect(projected.primaryIntent).toBe('EVENT_INFO');
    expect(projected.secondaryIntents).toContain('THE_PARTY');
    expect(projected.secondaryIntents).toContain('HOURS');
    expect(projected.secondaryIntents).toContain('LOCATION');
  });

  it('projects safety-sensitive scenarios ahead of lower-risk secondary signals', () => {
    const classification = classifySocialEngagement(
      'Aconteceu uma agressão na festa e preciso de ajuda agora',
    );
    const projected = projectCanonicalIntents(classification);
    expect(projected.primaryIntent).toBe('SAFETY');
    expect(classification.priority).toBe('P0');
  });

  it('supports the requested explicit canonical taxonomy', () => {
    for (const intent of [
      'EVENT_INFO',
      'SUNSET',
      'THE_PARTY',
      'GASTRONOMIA',
      'TICKET_INFO',
      'PRICE',
      'RESERVATION',
      'LOCATION',
      'HOURS',
      'COMMERCIAL_LEAD',
      'SUPPORT',
      'COMPLAINT',
      'REFUND',
      'SAFETY',
      'LEGAL',
      'PRESS',
      'PUBLIC_FIGURE',
      'HARASSMENT',
      'PRAISE',
      'UGC',
      'MARKING',
      'PARTNERSHIP',
      'WORK_WITH_US',
      'SPAM',
      'ABUSE',
      'UNKNOWN',
      'OTHER',
    ]) {
      expect(source).toContain(`| '${intent}'`);
    }
  });

  it('redacts common personal and payment identifiers before recurring-question analytics', () => {
    const normalized = normalizeQuestionForAnalytics(
      'Meu email é pessoa@example.com, CPF 123.456.789-00 e telefone +55 75 99999-0000. Quanto custa?',
    );
    expect(normalized.redacted).not.toContain('pessoa@example.com');
    expect(normalized.redacted).not.toContain('123.456.789-00');
    expect(normalized.redacted).not.toContain('99999-0000');
    expect(normalized.redacted).toContain('[email]');
    expect(normalized.redacted).toContain('[document]');
    expect(normalized.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('adds human queue, follow-up queue, FAQ signals, confusion evidence and response QA without provider-write authority', () => {
    expect(migration).toContain('create table if not exists instagram_engagement_human_queue');
    expect(migration).toContain('create table if not exists instagram_engagement_follow_up_queue');
    expect(migration).toContain('create table if not exists instagram_engagement_faq_signals');
    expect(migration).toContain(
      'create table if not exists instagram_engagement_classification_feedback',
    );
    expect(migration).toContain('create table if not exists instagram_engagement_response_qa');
    expect(source).not.toContain('INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true');
    expect(source).not.toContain('provider.send');
    expect(source).not.toContain('replyToDirect');
  });

  it('requires verified attribution before storing ad context', () => {
    expect(source).toContain("throw new Error('INSTAGRAM_ENGAGEMENT_AD_ATTRIBUTION_NOT_VERIFIED')");
    expect(source).toContain('attribution_verified=true');
  });

  it('enforces follow-up context and consent gates before queueing any follow-up', () => {
    expect(source).toContain('INSTAGRAM_ENGAGEMENT_FOLLOW_UP_CONTEXT_NOT_AUTHORIZED');
    expect(source).toContain('INSTAGRAM_ENGAGEMENT_FOLLOW_UP_CONSENT_NOT_VERIFIED');
    expect(source).toContain("state === 'RESOLVED' || state === 'CLOSED'");
    expect(source).toContain("state='FOLLOW_UP_REQUIRED'");
  });

  it('provides operational dashboard counters for failures, ambiguity, dead letter and SLA', () => {
    expect(source).toContain("a.status='SEND_FAILED'");
    expect(source).toContain("a.status='SEND_AMBIGUOUS'");
    expect(source).toContain("e.status='DEAD_LETTER'");
    expect(source).toContain('overdue_human_escalations');
    expect(source).toContain('percentile_cont(0.95)');
  });
});
