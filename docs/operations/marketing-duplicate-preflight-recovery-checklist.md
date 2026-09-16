# Recovery checklist

- [x] Confirm failed run stopped before provider write.
- [x] Reset expired publication command to `NOOP`.
- [x] Replace Cloud Run command/args override with dedicated immutable preflight image CMD.
- [x] Add regression coverage for the immutable preflight image contract.
- [ ] Certify exact-head required checks.
- [ ] Merge protected PR without bypass.
- [ ] Create a fresh time-bounded canary envelope.
- [ ] Execute one governed retry.
- [ ] Verify provider readback and Content Registry `PUBLISHED_VERIFIED`.
- [ ] Return durable command to `NOOP`.
