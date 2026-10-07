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

The provider smoke is a **production-scoped internal provider proof**, not a publication action. It creates only one ephemeral Cloud Run Job plus the exact review artifact required by the proof. Production publication, scheduling, MARKETING_READY promotion and paid-media activation remain forbidden.

The only accepted authorization issue title is exactly:

`PROVIDER AUTHORIZATION — Video Generative Smoke TP-GEN-0001`

Before any production authentication, image push, Cloud Run Job creation or Veo call, the workflow requires the issue to be open, owner-authored and bound to the live exact `main`. Every authorization key must occur **exactly once**; duplicate/conflicting values fail closed.

The active issue body must contain exactly one value for each key:

```text
AUTHORIZED_CANDIDATE_SHA=<exact main SHA>
AUTHORIZATION_STATE=ACTIVE
VIDEO_CONTENT_ITEM_ID=VID-TP-20260904-DUAS-PISTAS-GEN-001
VIDEO_GENERATIVE_SMOKE=AUTHORIZED
PROVIDER_CALL_AUTHORIZED=true
PRODUCTION_PROVIDER_PROOF_AUTHORIZED=true
PROVIDER=GOOGLE_VERTEX_VEO
MODEL=veo-3.1-generate-001
PROVIDER_LOCATION=us-central1
PROVIDER_OUTPUT_SECONDS=8
PROVIDER_SAMPLE_COUNT=1
PROVIDER_RESOLUTION=720p
PROVIDER_AUDIO_GENERATION=false
FINANCIAL_CEILING=USD:<explicit positive owner-approved amount>
PUBLICATION_AUTHORIZED=false
SCHEDULING_AUTHORIZED=false
MARKETING_READY_AUTHORIZED=false
PAID_MEDIA_AUTHORIZED=false
```

The issue-triggered autodispatch path additionally requires:

```text
AUTO_DISPATCH_AUTHORIZED=true
```

Both dispatch and execution require Control Plane #640 to contain unique exact values `MAIN_STABILITY=PASS`, `EVALUATED_MAIN_SHA=<exact main SHA>` and `MERGE_RESERVATION=NONE`.

The canonical source binding is `TP-GEN-0001` / SHA-256 `e16d4bc9dba27eb60a826d9be6fd3dade2f1e2e48445e1155a421cf52ca7d85b`. Current Creative Truth authority must still resolve legitimate source rights and an approved generative exception at runtime; GitHub authorization cannot fabricate or override rights/likeness evidence.

The workflow **consumes and closes the authorization issue before the first production/provider mutation**. A failed later build/provider call still consumes the one-shot authority. Re-execution requires a fresh owner authorization.

## Runtime identity

The workflow builds an immutable image from the exact authorized `main` SHA and executes an ephemeral Cloud Run Job under the canonical MCP runtime service account.

The production smoke does not require an OpenAI API key, Google OAuth client secret, Google OAuth refresh token or service-account private key.

Provider and GCS access use the attached Cloud Run identity through the Google metadata service. Drive and Sheets access use `VIDEO_GOOGLE_AUTH_MODE=GCP_SERVICE_IDENTITY`: the runtime requests IAM Credentials `signBlob` with the attached identity, signs a short-lived JWT OAuth assertion and exchanges it for short-lived `drive.readonly` and `spreadsheets` scopes. No long-lived Workspace credential is persisted.

The canonical asset bucket is `INSTAGRAM_PUBLICATION_ASSET_BUCKET` when configured, with the explicit production fallback `toca-mcp-publication-assets`. Dynamic bucket discovery is forbidden.

The smoke uses:

```text
GCP_PROJECT_ID=toca-mcp-production
GCP_REGION=southamerica-east1
VIDEO_SCENE_CONTINUATION_PROVIDER=GOOGLE_VERTEX_VEO
VIDEO_GOOGLE_AUTH_MODE=GCP_SERVICE_IDENTITY
VERTEX_VEO_LOCATION=us-central1
VERTEX_VEO_MODEL=veo-3.1-generate-001
```

The Veo request is cost-shaped and proof-shaped to exactly one 8-second, 9:16, 720p sample with `generateAudio=false`. The workflow records the owner-approved financial ceiling in sanitized evidence; because cloud billing is provider-authoritative, the ceiling is a governance bound over this fixed request rather than a real-time billing cutoff.

The production target is pinned to the canonical project, runtime/deployer identities and publication-asset bucket. The ephemeral Cloud Run Job is deleted after execution and an independent absence check must pass. The generated MP4 remains a review candidate only.


If service-account signing, Workspace sharing, Vertex authorization, model availability, quota or GCS access is not actually present, execution fails closed and the blocker is reported rather than bypassed.

## Output

`src/video-generative-provider-smoke.ts` calls the same governed generation service exposed by the MCP surface. The resulting candidate must remain `GENERATED_REVIEW_REQUIRED`, `requiresPostGenerationHumanReview=true`, `publicationEligible=false` and `publicationAuthorized=false`.

The source master, source SHA, content item, provider, model and durable output SHA are checked before evidence acceptance. The runtime creates a one-hour signed delivery URL for the exact branded candidate object only after full SHA-256 artifact readback. The GitHub workflow downloads that exact MP4, re-hashes it and requires expected SHA-256 to equal observed SHA-256.

The workflow uploads the exact MP4 plus sanitized runtime-binding, provider-result and readback evidence as a short-retention Actions artifact.

Successful smoke evidence is necessary but not sufficient to promote the capability from `IMPLEMENTED` to `PRODUCTION_VALIDATED`. Human source-vs-output QA and canonical finalization remain separate gates. No successful smoke authorizes publishing or scheduling.
