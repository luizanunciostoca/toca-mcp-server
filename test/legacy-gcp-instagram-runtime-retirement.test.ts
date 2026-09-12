import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowDirectory = '.github/workflows';
const worker = readFileSync(
  `${workflowDirectory}/deploy-instagram-publication-worker-gcp.yml`,
  'utf8',
);
const daemon = readFileSync(
  `${workflowDirectory}/deploy-toca-managed-instagram-daemon-gcp.yml`,
  'utf8',
);
const policy = JSON.parse(readFileSync('infra/control-plane/policy.json', 'utf8')) as {
  publicationControlPlane?: {
    canonicalTransport?: string;
    canonicalWorkflow?: string;
    legacyGcpInstagramPublicationTransport?: {
      lifecycleStatus?: string;
      publicationExecutionAuthorized?: boolean;
      publicationSchedulerAuthorized?: boolean;
      providerPublicationWriteAuthorized?: boolean;
      physicalEngagementRuntimeMayRemain?: boolean;
      replacedBy?: string;
    };
  };
  activeRuntime?: {
    tocaManagedInstagramScheduler?: {
      lifecycleStatus?: string;
      deploymentAuthorized?: boolean;
      executionAuthorized?: boolean;
      publicationAuthority?: boolean;
      providerPublicationWriteAuthorized?: boolean;
      engagementAuthority?: string;
    };
  };
  forbidden?: {
    legacyGcpInstagramPublicationDeployment?: boolean;
    legacyGcpInstagramPublicationSchedulerExecution?: boolean;
    gcpEngagementRuntimePublicationAuthority?: boolean;
  };
};

const executableGcpMarkers = [
  'google-github-actions/auth',
  'google-github-actions/setup-gcloud',
  'gcloud ',
  'docker push',
];

const engagementWorkflowsUsingManagedDaemon = readdirSync(workflowDirectory)
  .filter((filename) => filename.startsWith('instagram-engagement-') && filename.endsWith('.yml'))
  .map((filename) => ({
    filename,
    content: readFileSync(`${workflowDirectory}/${filename}`, 'utf8'),
  }))
  .filter(({ content }) => content.includes('toca-managed-instagram-daemon'));

const engagementWorkflowsMutatingManagedDaemon = engagementWorkflowsUsingManagedDaemon.filter(
  ({ content }) =>
    content.includes('gcloud run deploy "$DAEMON_SERVICE_NAME"') ||
    content.includes('gcloud run services update "$DAEMON_SERVICE_NAME"'),
);

describe('legacy GCP Instagram publication runtime retirement', () => {
  it('keeps the former publication worker deployer as an inert historical stub', () => {
    expect(worker).toContain('LEGACY_GCP_INSTAGRAM_PUBLICATION_WORKER_RETIRED=1');
    expect(worker).toContain('github-native-instagram-publisher.yml');
    expect(worker).not.toMatch(/^\s*id-token:\s*write\s*$/m);
    for (const marker of executableGcpMarkers) {
      expect(worker).not.toContain(marker);
    }
  });

  it('keeps the former publication/scheduler deployer inert', () => {
    expect(daemon).toContain('LEGACY_GCP_INSTAGRAM_DAEMON_RETIRED=1');
    expect(daemon).toContain('Cloud Scheduler/PostgreSQL publication execution is no longer');
    expect(daemon).toContain('github-native-instagram-publisher.yml');
    expect(daemon).not.toMatch(/^\s*id-token:\s*write\s*$/m);
    for (const marker of executableGcpMarkers) {
      expect(daemon).not.toContain(marker);
    }
  });

  it('marks GitHub-native publication as canonical while allowing engagement-only infrastructure', () => {
    const controlPlane = policy.publicationControlPlane;
    expect(controlPlane?.canonicalTransport).toBe('github-native-instagram-publication');
    expect(controlPlane?.canonicalWorkflow).toBe(
      '.github/workflows/github-native-instagram-publisher.yml',
    );

    expect(controlPlane?.legacyGcpInstagramPublicationTransport).toMatchObject({
      lifecycleStatus: 'RETIRED',
      publicationExecutionAuthorized: false,
      publicationSchedulerAuthorized: false,
      providerPublicationWriteAuthorized: false,
      physicalEngagementRuntimeMayRemain: true,
      replacedBy: 'github-native-instagram-publication',
    });

    expect(policy.activeRuntime?.tocaManagedInstagramScheduler).toMatchObject({
      lifecycleStatus: 'ACTIVE_ENGAGEMENT_ONLY',
      deploymentAuthorized: true,
      executionAuthorized: true,
      publicationAuthority: false,
      providerPublicationWriteAuthorized: false,
      engagementAuthority: 'GOVERNED_BY_ENGAGEMENT_ROLLOUT',
    });

    expect(policy.forbidden?.legacyGcpInstagramPublicationDeployment).toBe(true);
    expect(policy.forbidden?.legacyGcpInstagramPublicationSchedulerExecution).toBe(true);
    expect(policy.forbidden?.gcpEngagementRuntimePublicationAuthority).toBe(true);
  });

  it('prevents every engagement workflow using the managed daemon from enabling publication writes', () => {
    expect(engagementWorkflowsUsingManagedDaemon.length).toBeGreaterThan(0);

    for (const { filename, content } of engagementWorkflowsUsingManagedDaemon) {
      expect(
        content.includes('INSTAGRAM_PUBLICATION_WRITES_ENABLED=true'),
        `${filename} must not enable Instagram publication writes`,
      ).toBe(false);
    }
  });

  it('requires every engagement workflow that mutates the managed daemon to pin publication writes false', () => {
    expect(engagementWorkflowsMutatingManagedDaemon.length).toBeGreaterThan(0);

    for (const { filename, content } of engagementWorkflowsMutatingManagedDaemon) {
      expect(
        content.includes('INSTAGRAM_PUBLICATION_WRITES_ENABLED=false'),
        `${filename} must explicitly pin Instagram publication writes false`,
      ).toBe(true);
    }
  });
});
