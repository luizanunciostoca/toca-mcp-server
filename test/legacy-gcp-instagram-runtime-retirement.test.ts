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
    assetTransport?: string;
    stateTransport?: string;
    gcpInstagramPublishNowTransport?: {
      lifecycleStatus?: string;
      publicationExecutionAuthorized?: boolean;
      publicationSchedulerAuthorized?: boolean;
      providerPublicationWriteAuthorized?: boolean;
      approvalTransport?: string;
      commandFile?: string;
      writeAuthority?: string;
      databaseSecretVersion?: string;
      requiredControls?: Record<string, boolean>;
    };
    githubNativeInstagramPublicationTransport?: {
      lifecycleStatus?: string;
      providerPublicationWriteAuthorized?: boolean;
      repositoryDispatchWriteAuthorized?: boolean;
      scheduleShadowAuthorized?: boolean;
      canonicalForPublication?: boolean;
    };
    legacyGcpInstagramPublicationTransport?: {
      lifecycleStatus?: string;
      publicationExecutionAuthorized?: boolean;
      publicationSchedulerAuthorized?: boolean;
      providerPublicationWriteAuthorized?: boolean;
      physicalEngagementRuntimeMayRemain?: boolean;
      replacedBy?: string;
      currentCanonicalReplacement?: string;
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

describe('legacy GCP Instagram runtime retirement and governed fast-path activation', () => {
  it('keeps the former publication worker deployer as an inert historical stub', () => {
    expect(worker).toContain('LEGACY_GCP_INSTAGRAM_PUBLICATION_WORKER_RETIRED=1');
    expect(worker).not.toMatch(/^\s*id-token:\s*write\s*$/m);
    for (const marker of executableGcpMarkers) {
      expect(worker).not.toContain(marker);
    }
  });

  it('keeps the former publication/scheduler deployer inert', () => {
    expect(daemon).toContain('LEGACY_GCP_INSTAGRAM_DAEMON_RETIRED=1');
    expect(daemon).toContain('Cloud Scheduler/PostgreSQL publication execution is no longer');
    expect(daemon).not.toMatch(/^\s*id-token:\s*write\s*$/m);
    for (const marker of executableGcpMarkers) {
      expect(daemon).not.toContain(marker);
    }
  });

  it('makes the protected GCP publish-now lane canonical without reviving retired worker topology', () => {
    const controlPlane = policy.publicationControlPlane;
    expect(controlPlane?.canonicalTransport).toBe('gcp-instagram-publish-now');
    expect(controlPlane?.canonicalWorkflow).toBe('.github/workflows/marketing-publish-now.yml');
    expect(controlPlane?.assetTransport).toBe('google-drive-exact-sha256-to-private-gcs');
    expect(controlPlane?.stateTransport).toBe('cloud-sql-idempotency-audit');

    expect(controlPlane?.gcpInstagramPublishNowTransport).toMatchObject({
      lifecycleStatus: 'LIMITED',
      publicationExecutionAuthorized: true,
      publicationSchedulerAuthorized: false,
      providerPublicationWriteAuthorized: true,
      approvalTransport: 'protected-main-command',
      commandFile: 'control/marketing-publish-now-command.json',
      writeAuthority: 'EXPLICIT_APPROVAL_EXACT_ASSET_ONLY',
      databaseSecretVersion: '1',
    });
    expect(controlPlane?.gcpInstagramPublishNowTransport?.requiredControls).toMatchObject({
      protectedMain: true,
      freshCommand: true,
      explicitApproval: true,
      exactAssetSha256: true,
      creativeTruth: true,
      rightsClearance: true,
      idempotency: true,
      writeDisableAfterAttempt: true,
      providerReadback: true,
      immutableEvidence: true,
    });

    expect(controlPlane?.githubNativeInstagramPublicationTransport).toMatchObject({
      lifecycleStatus: 'SHADOW_READ_ONLY',
      providerPublicationWriteAuthorized: false,
      repositoryDispatchWriteAuthorized: false,
      scheduleShadowAuthorized: true,
      canonicalForPublication: false,
    });

    expect(controlPlane?.legacyGcpInstagramPublicationTransport).toMatchObject({
      lifecycleStatus: 'RETIRED',
      publicationExecutionAuthorized: false,
      publicationSchedulerAuthorized: false,
      providerPublicationWriteAuthorized: false,
      physicalEngagementRuntimeMayRemain: true,
      currentCanonicalReplacement: 'gcp-instagram-publish-now',
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
