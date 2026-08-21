# Omnichannel prepared-content authority

Migration `033_omnichannel_prepared_content.sql` adds the shared provider-neutral authority used by Email and WhatsApp outbound preparation.

The authority is tenant/workspace/organization scoped and content-addressed. Runtime code exposes append/read semantics only; it does not expose update or delete. Provider credentials, provider bindings and provider message IDs are intentionally not stored here.

A prepared-content reference is not provider evidence and does not authorize an external send. `email.campaign.send` and `whatsapp.message.send` remain governed by the existing Approval, Policy, Privacy and provider-binding checks. Creating or resolving prepared content must never promote `PROVIDER_VERIFIED`, `STAGING_VERIFIED` or `PRODUCTION_VERIFIED`.

Rollback before any dependent prepared-content records are in use: drop `omnichannel_prepared_content` and its indexes by rolling back migration 033 in an isolated/staging environment. Do not destructively roll back production merely to obtain evidence. After any runtime starts referencing prepared-content refs, rollback requires first proving there are no dependent queued/dispatch/workflow records that would be orphaned.
