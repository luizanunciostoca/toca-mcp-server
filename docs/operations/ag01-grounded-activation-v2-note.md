# AG-01 Grounded Activation V2

The first governed grounded activation (`#944`) built the exact runtime image successfully but the zero-traffic candidate failed the inherited `/readyz` Cloud Run startup probe before promotion. No production traffic changed.

V2 separates process startup from dependency readiness:

- Cloud Run startup probe: `/healthz`.
- Governed pre-cutover readiness gate: `/ready`.
- Grounded knowledge probe: `/v1/knowledge/answer` with confidence/citation requirements.
- Production remains private and provider-write free.
- The already-built immutable runtime image from source `a19c4fd5731379ae325f8ecefc06c5adb88ee8df` may be reused only when the controller diff is restricted to this V2 workflow, its test, and this operational note.
