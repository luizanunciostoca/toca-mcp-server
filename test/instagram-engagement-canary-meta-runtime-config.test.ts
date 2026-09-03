import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  '.github/workflows/instagram-engagement-controlled-write-canary-v2.yml',
  'utf8',
);

function occurrences(value: string): number {
  return workflow.split(value).length - 1;
}

describe('Instagram controlled-write canary Meta runtime configuration', () => {
  it('declares the canonical Meta OAuth configuration used by production runtime', () => {
    expect(workflow).toContain('META_APP_SECRET_ID: toca-meta-app-secret');
    expect(workflow).toContain("META_APP_ID: '2281930145887404'");
    expect(workflow).toContain(
      'META_REDIRECT_URI: https://toca-meta-oauth-staging-990081828836.southamerica-east1.run.app/oauth/meta/callback',
    );
    expect(workflow).toContain(
      'META_REQUESTED_SCOPES: pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,business_management,instagram_basic,instagram_manage_comments,instagram_manage_messages,instagram_content_publish',
    );
  });

  it('injects the full Meta config into every job that enables the Meta provider', () => {
    expect(occurrences('META_ENABLED=true')).toBe(3);
    expect(occurrences('META_APP_ID=$META_APP_ID')).toBe(3);
    expect(occurrences('META_APP_SECRET_PROVIDER=env')).toBe(3);
    expect(occurrences('META_APP_SECRET_KEY=META_APP_SECRET')).toBe(3);
    expect(occurrences('META_AUTHORIZATION_ENDPOINT=https://www.facebook.com/dialog/oauth')).toBe(3);
    expect(occurrences('META_TOKEN_ENDPOINT=https://graph.facebook.com/oauth/access_token')).toBe(3);
    expect(occurrences('META_REDIRECT_URI=$META_REDIRECT_URI')).toBe(3);
    expect(occurrences('META_REQUESTED_SCOPES=$META_REQUESTED_SCOPES')).toBe(3);
    expect(occurrences('META_APP_SECRET=$META_APP_SECRET_ID:latest')).toBe(3);
  });

  it('keeps the one-reply and persistent-write boundaries unchanged', () => {
    expect(workflow).toContain('CANARY_CHANNEL=DIRECT');
    expect(workflow).toContain('CANARY_MAX_EXTERNAL_REPLIES=1');
    expect(workflow).toContain('PERSISTENT_WRITES_AUTHORIZED=false');
    expect(workflow).toContain("'PERSISTENT_WRITES_ENABLED=false'");
    expect(workflow).toContain("'DAEMON_ENGAGEMENT_WRITES=false'");
  });
});
