# Video Generative Provider Smoke V1

## Scope

This workflow executes one real, source-anchored provider generation for:

- content item `VID-TP-20260904-DUAS-PISTAS-GEN-001`;
- source asset `TP-GEN-0001`;
- source SHA-256 `e16d4bc9dba27eb60a826d9be6fd3dade2f1e2e48445e1155a421cf52ca7d85b`;
- route `GENERATIVE_SCENE_CONTINUATION_VIDEO`.

It is a provider-smoke/review operation only. It does not publish, schedule, activate paid media, or grant publication authority.

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

The issue event controller verifies repository owner, open issue state, exact `main` SHA, exact content item, and the closed publication boundary before dispatching the canonical smoke workflow.

## Runtime

The workflow runs an ephemeral Cloud Run Job under the canonical MCP runtime service account. It resolves only secret IDs and pinned enabled secret versions; secret values are injected directly from Secret Manager into the job and are never written to evidence.

Configured video-specific secret variables are preferred. If they are absent, the smoke workflow performs conservative Secret Manager name discovery and requires exactly one non-Google-Ads candidate for each Google OAuth credential plus one OpenAI API key candidate. Ambiguity fails closed.

The asset bucket uses `INSTAGRAM_PUBLICATION_ASSET_BUCKET` when configured; otherwise exactly one project bucket matching `publication|asset` must be discoverable.

## Output

`src/video-generative-provider-smoke.ts` calls the same governed generation service exposed by the MCP surface. The resulting candidate must remain `GENERATED_REVIEW_REQUIRED` and `publicationEligible=false`.

The runtime creates a one-hour signed delivery URL for the exact candidate object after full SHA-256 readback. The GitHub workflow downloads that exact MP4, verifies its SHA-256, and uploads the candidate plus sanitized evidence as a short-retention GitHub Actions artifact.

Successful smoke evidence is necessary but not sufficient to promote the capability from `IMPLEMENTED` to `PRODUCTION_VALIDATED`. Human source-vs-output QA and canonical finalization remain separate gates.
