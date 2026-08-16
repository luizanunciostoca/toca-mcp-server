# Omnichannel provider READ preflight — 2026-08-16

Status: **WHATSAPP PROVIDER CREDENTIAL PRESENT / WHATSAPP SCOPES AND ASSET ACCESS BLOCKED**

Validated from the Omnichannel-equivalent tree at `main@0ffc2cf11c1f48894976676265ea3ebf3792ae87`. Before this evidence was promoted, `main` advanced to `35b6aa15479a8a0c999b1260581e4ba7fd389f27` by a DR documentation-only merge; the Omnichannel/provider/runtime files used by this validation did not change.

This validation did not expose the MCP facade, create a scheduler, or send any provider message.

## Method

A temporary branch-only GitHub Actions workflow reused the existing M-FOUND-12 production-read pattern:

- GitHub OIDC/WIF authenticated as the existing deployer;
- a temporary Cloud Run Job executed under `toca-mcp-runtime@toca-mcp-production.iam.gserviceaccount.com`;
- the existing Secret Manager entry `toca-meta-oauth-token` was mounted only inside the job;
- Meta Graph API v24.0 was called with `GET` only;
- no WhatsApp send endpoint, template mutation, webhook mutation, audience mutation or production database mutation was invoked;
- the temporary Cloud Run Job was deleted by the workflow cleanup trap;
- the temporary workflow file was removed after evidence collection.

Workflow run: `31925747184` — **SUCCESS**.

Sanitized artifact: `9257779828`.

Artifact digest: `sha256:c48a6ab4fa0e396bfa414cbd3b858708588eb0ab460cf69b081a1b878615b9c1`.

Validation source SHA: `b5fcf6133fe2aa00e299a076ac30be7a867c3d6e`.

Provider evidence timestamp: `2026-08-16T04:05:21.359Z`.

Promotion base SHA revalidated: `35b6aa15479a8a0c999b1260581e4ba7fd389f27`.

## Credential and scope evidence

The production Meta token is real and readable. `me/permissions` succeeded.

Granted scopes include:

- `ads_management`;
- `ads_read`;
- `business_management`;
- `instagram_basic`;
- `instagram_content_publish`;
- `instagram_manage_comments`;
- `instagram_manage_insights`;
- `instagram_manage_messages`;
- `pages_manage_metadata`;
- `pages_messaging`;
- `pages_read_engagement`;
- `pages_show_list`;
- `public_profile`.

Required WhatsApp scopes were **not** granted:

- `whatsapp_business_management`: **ABSENT**;
- `whatsapp_business_messaging`: **ABSENT**.

This replaces the earlier weaker statement that Omnichannel credentials could not be proven. A real Meta credential exists, but it is not currently authorized for WhatsApp Business management or messaging.

## Business and WABA evidence

`me/businesses` succeeded and exposed two real Business Managers:

1. `1123355242505391` — `Toca do Morcego - Luiz`;
2. `232421267344387` — `Toca do Morcego`.

For each Business Manager, the read-only request to `/{business-id}/owned_whatsapp_business_accounts?fields=id,name` returned:

- HTTP `403`;
- Meta Graph error code `200`;
- no WABA payload.

Result:

- discovered WABA count: `0`;
- discovered WhatsApp phone-number count: `0`;
- no `phone_number_id` can be claimed;
- no approved sending E.164 number can be claimed;
- no template/provider messaging readiness can be claimed.

The result is consistent with the missing WhatsApp management scope. It does not prove that the businesses own no WABA; it proves that the current production token cannot enumerate one.

## Operational conclusion

WhatsApp remains `BLOCKED_EXTERNAL_PROVIDER` for real send.

The exact external/provider-admin prerequisites before a controlled send are now narrower:

1. grant/authorize the production Meta app/system-user credential for the intended WABA with the required WhatsApp Business management and messaging permissions;
2. bind the intended WABA to one of the verified Business Managers above, or identify the exact authorized Business Manager that owns it;
3. rerun a GET-only preflight and require a real WABA ID plus real `phone_number_id` and sender number;
4. verify webhook subscription/signature handling and an approved template when required;
5. bind one explicit safe test recipient and require canonical CRM resolution plus R16 `ALLOWED` for the exact WhatsApp purpose/channel;
6. only then implement/enable the provider adapter and progress `READ/VERIFY -> PREPARE -> CONTROLLED SEND -> PROVIDER READBACK`.

No real WhatsApp SEND, provider message ID, delivery readback or status ingest exists yet, and none is simulated here.

## Email and Nurture impact

This probe does not alter Email readiness. No Email provider, credential binding, From identity, sending domain, DKIM/SPF/DMARC evidence or delivery webhook is declared by the current repository/runtime configuration.

Nurture remains contract-ready and bound by contract to the existing durable workflow engine, but its four capabilities remain non-runtime and production-disabled together with the current Omnichannel lifecycle. No test sequence is claimed as executed until a real internal runtime binding and an explicitly authorized contact exist.

The canonical Privacy/R16 and CRM rules remain unchanged: no parallel consent/suppression/preferences model and no duplicate `ContactRecord` are introduced.
