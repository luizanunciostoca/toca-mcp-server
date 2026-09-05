---
applyTo: '.github/workflows/**,.github/CODEOWNERS'
---

# CI, workflow, and release-controller rules

These files are shared hotspots and require explicit ownership.

- Preserve pinned action SHAs and least privilege unless a deliberate supply-chain change is in scope.
- Never weaken required checks, branch protection expectations, production authorization fields, exact-SHA binding, or fail-closed behavior to make CI pass.
- Temporary diagnostic workflows must not survive in the final integration head unless they are intentionally promoted to governed permanent workflows.
- `contents: write`, commit, push, production deployment, provider writes, or scheduler mutations require explicit scope and authorization.
- A workflow that emits evidence must prove exact controller/runtime SHA and sanitize user/provider data.
- Before changing `main`, inspect active SHA-bound production authorizations/watches and document how the merge affects them.
