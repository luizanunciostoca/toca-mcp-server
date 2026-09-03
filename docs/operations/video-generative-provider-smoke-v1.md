# Video Generative Provider Smoke V1

## Scope

This workflow executes one real, source-anchored provider generation for:

- content item `VID-TP-20260904-DUAS-PISTAS-GEN-001`;
- source asset `TP-GEN-0001`;
- source SHA-256 `e16d4bc9dba27eb60a826d9be6fd3dade2f1e2e48445e1155a421cf52ca7d85b`;
- route `GENERATIVE_SCENE_CONTINUATION_VIDEO`;
- provider `GOOGLE_VERTEX_VEO`;
- model `veo-3.1-generate-001`;
- provider location `us-central1`.

It is a provider-smoke/review operation only. It does not publish, schedule, activate paid media, grant publication authority or finalize the candidate.

## Authorization

The only chat-triggerable path is an owner-authored GitHub issue whose title is exactly:

`PROVIDER AUTHORIZATION — Video Generative Smoke TP-GEN-0001`

The issue body must bind the exact current `main` SHA and include:

```text
AUTHORIZED_CANDIDATE_SHA=<exact main SHA>
AUTHORIZATION_STATE=ACTIVE
VIDEO_CONTENT_ITEM_ID=VID-TP-20260904-DUAS-PISTAS-GEN-001
VIDEO_GENERATIVE_SMOKE=AUTHORIZED
PUBLICATION_AUTHORIZED=false
AUTO_DISPATCH_AUTHORIZED=true
```

The issue event controller verifies repository owner, open issue state, exact `main` SHA, exact content item and the closed publication boundary before dispatching the canonical smoke workflow.

## Runtime identity

The workflow builds an immutable image from the exact authorized `main` SHA and executes an ephemeral Cloud Run Job under the canonical MCP runtime service account.

The production smoke does not require an OpenAI API key, Google OAuth client secret, Google OAuth refresh token or service-account private key.

Provider and GCS access use the attached Cloud Run identity through the Google metadata service. Drive and Sheets access use `VIDEO_GOOGLE_AUTH_MODE=GCP_SERVICE_IDENTITY`: the runtime requests IAM Credentials `signBlob` with the attached identity, signs a short-lived JWT OAuth assertion and exchanges it for short-lived `drive.readonly` and `spreadsheets` scopes. No long-lived Workspace credential is persisted.

The canonical asset bucket is `INSTAGRAM_PUBLICATION_ASSET_BUCKET` when configured, with the explicit production fallback `toca-mcp-publication-assets`. Dynamic bucket discovery is forbidden.

The smoke uses:

```text
VIDEO_SCENE_CONTINUATION_PROVIDER=GOOGLE_VERTEX_VEO
VIDEO_GOOGLE_AUTH_MODE=GCP_SERVICE_IDENTITY
VERTEX_VEO_LOCATION=us-central1
VERTEX_VEO_MODEL=veo-3.1-generate-001
```

If service-account signing, Workspace sharing, Vertex authorization, model availability, quota or GCS access is not actually present, execution fails closed and the blocker is reported rather than bypassed.

## Output

`src/video-generative-provider-smoke.ts` calls the same governed generation service exposed by the MCP surface. The resulting candidate must remain `GENERATED_REVIEW_REQUIRED`, `requiresPostGenerationHumanReview=true`, `publicationEligible=false` and `publicationAuthorized=false`.

The source master, source SHA, content item, provider, model and durable output SHA are checked before evidence acceptance. The runtime creates a one-hour signed delivery URL for the exact branded candidate object only after full SHA-256 artifact readback. The GitHub workflow downloads that exact MP4, re-hashes it and requires expected SHA-256 to equal observed SHA-256.

The workflow uploads the exact MP4 plus sanitized runtime-binding, provider-result and readback evidence as a short-retention Actions artifact.

Successful smoke evidence is necessary but not sufficient to promote the capability from `IMPLEMENTED` to `PRODUCTION_VALIDATED`. Human source-vs-output QA and canonical finalization remain separate gates. No successful smoke authorizes publishing or scheduling.
