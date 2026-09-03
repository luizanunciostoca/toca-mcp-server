# Instagram Controlled Write Canary — Current Candidate

This document is informational only and grants no execution authority.

Current candidate controller/runtime source must equal the protected `main` SHA at authorization time. The immutable image digest must be produced by the build-only Instagram Engagement Shadow Runtime Build workflow from that exact SHA. The real-write Canary V2 authorization must remain Direct-only, max one external reply, temporary-job-only, persistent writes disabled, maxAttempts=1, with provider ACK/receipt and cleanup/restore required.

If `main` advances before authorization or execution, the candidate is invalid and a fresh immutable image must be built. No old digest may be reused across a source-SHA change.
