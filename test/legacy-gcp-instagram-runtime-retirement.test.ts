import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const worker = readFileSync(
  '.github/workflows/deploy-instagram-publication-worker-gcp.yml',
  'utf8',
);
const daemon = readFileSync(
  '.github/workflows/deploy-toca-managed-instagram-daemon-gcp.yml',
  'utf8',
);
const policy = JSON.parse(readFileSync('infra/control-plane/policy.json', 'utf8')) as {
  publicationControlPlane?: {
    canonicalTransport?: string;
    canonicalWorkflow?: string;
    legacyGcpInstagramRuntime?: {
      lifecycleStatus?: string;
      deploymentAuthorized?: boolean;
      executionAuthorized?: boolean;
      schedulerAuthorized?: boolean;
      providerWriteAuthorized?: boolean;
      replacedBy?: string;
    };
  };
  activeRuntime?: {
    tocaManagedInstagramScheduler?: {
      lifecycleStatus?: string;
      deploymentAuthorized?: boolean;
      executionAuthorized?: boolean;
      replacedBy?: string;
    };
  };
  forbidden?: {
    legacyGcpInstagramPublicationDeployment?: boolean;
    legacyGcpInstagramSchedulerExecution?: boolean;
  };
};

const executableGcpMarkers = [
  'google-github-actions/auth',
  'google-github-actions/setup-gcloud',
  'gcloud ',
  'docker push',
];

describe('legacy GCP Instagram runtime retirement', () => {
  it('keeps the former publication worker deployer as an inert historical stub', () => {
    expect(worker).toContain('LEGACY_GCP_INSTAGRAM_PUBLICATION_WORKER_RETIRED=1');
    expect(worker).toContain('github-native-instagram-publisher.yml');
    expect(worker).not.toMatch(/^\s*id-token:\s*write\s*$/m);
    for (const marker of executableGcpMarkers) {
      expect(worker).not.toContain(marker);
    }
  });

  it('keeps the former managed daemon deployer inert', () => {
    expect(daemon).toContain('LEGACY_GCP_INSTAGRAM_DAEMON_RETIRED=1');
    expect(daemon).toContain('Cloud Scheduler/PostgreSQL publication execution is no longer');
    expect(daemon).toContain('github-native-instagram-publisher.yml');
    expect(daemon).not.toMatch(/^\s*id-token:\s*write\s*$/m);
    for (const marker of executableGcpMarkers) {
      expect(daemon).not.toContain(marker);
    }
  });

  it('marks GitHub-native publication as canonical and legacy GCP execution unauthorized', () => {
    const controlPlane = policy.publicationControlPlane;
    expect(controlPlane?.canonicalTransport).toBe('github-native-instagram-publication');
    expect(controlPlane?.canonicalWorkflow).toBe(
      '.github/workflows/github-native-instagram-publisher.yml',
    );

    const retired = controlPlane?.legacyGcpInstagramRuntime;
    expect(retired).toMatchObject({
      lifecycleStatus: 'RETIRED',
      deploymentAuthorized: false,
      executionAuthorized: false,
      schedulerAuthorized: false,
      providerWriteAuthorized: false,
      replacedBy: 'github-native-instagram-publication',
    });

    expect(policy.activeRuntime?.tocaManagedInstagramScheduler).toMatchObject({
      lifecycleStatus: 'RETIRED_COMPATIBILITY_SNAPSHOT',
      deploymentAuthorized: false,
      executionAuthorized: false,
      replacedBy: 'github-native-instagram-publication',
    });
    expect(policy.forbidden?.legacyGcpInstagramPublicationDeployment).toBe(true);
    expect(policy.forbidden?.legacyGcpInstagramSchedulerExecution).toBe(true);
  });
});
