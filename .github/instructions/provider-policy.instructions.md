---
applyTo: "src/providers/**,src/policy/**,src/**/approval/**,src/**/authorization/**"
---

# Provider, policy, and write-boundary rules

- Keep decision authority above transport/provider code.
- Provider transport must not invent policy, approval, autonomy, or business facts.
- External writes require validated identity/context, policy/authorization, idempotency, and provider readback as applicable.
- Ambiguous provider outcomes are fail-closed. Never blindly retry an uncertain write.
- Preserve exact account/tenant/workspace/organization scope.
- Never log secrets, tokens, raw sensitive payloads, or unnecessary PII.
- Tests must cover denial/failure/ambiguity paths, not only happy paths.
- Do not declare a capability production-validated from mock tests or CI alone.
