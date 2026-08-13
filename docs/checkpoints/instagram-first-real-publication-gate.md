# Instagram first real publication gate

## Candidate

The first production publication candidate is bound to `publication/first-real-publication.json`.

- Drive asset: `SUN-0001__AMBIENTE__DECK__POR_DO_SOL.jpeg`
- Drive file ID: `1u6ngIQVgUBTezAM07g0Jh8v3Bgt7-L6F`
- Instagram business account: `17841402033495654`
- Media type: `IMAGE`

The selected Drive file is shared read-only with the deployment service account solely so the preparation workflow can retrieve the exact approved source bytes without making the Drive asset public.

## Preparation workflow

`.github/workflows/instagram-first-publication-prepare.yml`

The workflow is manual-only and remains fail-closed:

- downloads the exact Drive asset using an authenticated Drive API request;
- validates that the source is a non-empty JPEG;
- builds an immutable one-time preparation image containing that asset;
- runs the preparation entrypoint as `toca-mcp-runtime`;
- stages the image privately in `gs://toca-mcp-publication-assets`;
- produces a temporary signed URL for Meta ingestion;
- resolves the Facebook Page connected to the target Instagram account using the persisted Meta OAuth token;
- creates the exact `InstagramPublishRequest` and its stable SHA-256 approval manifest;
- uploads the preparation evidence as a short-lived GitHub Actions artifact.

During this workflow `INSTAGRAM_PUBLICATION_WRITES_ENABLED=false`. It must not create an Instagram media container and must not call `media_publish`.

## Approval boundary

A successful preparation run is not authorization to publish.

Before any Instagram write occurs, the exact `manifest.requestSha256` from the preparation artifact must be explicitly approved and bound to the controlled publication runtime. Any payload change, media URL change, caption change, account change, correlation change, or idempotency change produces a different hash and must fail closed.

## Promotion rule

Do not add or run the real publication execution workflow until:

1. the repository Quality Gate is green on the preparation implementation;
2. the preparation workflow succeeds on the exact commit intended for publication;
3. the resulting preparation artifact is inspected;
4. the exact request SHA-256 is explicitly approved.
