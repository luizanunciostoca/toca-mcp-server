# Instagram Direct Canary Opportunity Watch

This controller is read-only with respect to Instagram, application data, and persistent production services.

It is authorized only by one open owner-authored issue matching the canonical Direct watch title and safety markers. The authorization is bounded to 12 hours and tied to the exact current `main` SHA and immutable runtime digest. Before probing production and again before creating an opportunity, the controller revalidates current `main`, Control Plane issue #640 (`MAIN_STABILITY=PASS`, matching `EVALUATED_MAIN_SHA`, and `MERGE_RESERVATION=NONE`), and the active authorization.

The watch reuses `instagram-engagement-canary-eligibility-readonly.js` with `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=false`. The eligibility probe uses a bounded scan with an overflow sentinel and emits `CANDIDATE_SCAN_COMPLETE`; a truncated scan is fail-closed and cannot produce a READY opportunity. The workflow may create and delete a temporary Cloud Run diagnostic job, and deletion is confirmed before the run can succeed.

A READY result may create a sanitized GitHub opportunity issue containing governance metadata such as the source authorization issue, runtime source SHA and image digest, channel, aggregate counts, safety attestations, and a SHA-256 target identifier. It contains no raw user or provider data.

It does not authorize a real Direct canary, provider call, reply write, database mutation, scheduler mutation, persistent service mutation, or autonomy promotion. A real canary requires a separate explicit authorization after a unique eligible target is discovered.
