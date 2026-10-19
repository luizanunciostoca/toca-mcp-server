# MCP authenticated discovery binding (source only)

This opt-in binding protects `/mcp` with the existing RS256/JWKS verifier. It is
disabled by default and is not a deployment, a working ChatGPT connection, an
OAuth authorization server, or proof of business-data access.

## Exact initial surface

Only `toca.system.health`, `toca.capabilities.search`, and
`toca.capabilities.describe` are registered. Their schemas, descriptions, and
read implementations come from `registerTocaCoreSurface`; the adapter does not
maintain another capability catalog. Health reports three tools and
`discoveryOnly: true`. Search/describe always report `executable: false` because
this surface has no runtime bindings. No provider, database pool, workflow,
approval, artist, or generic execute handler is composed by this surface.

The public HTTP health/readiness and existing webhook/OAuth operational routes
are unchanged. When the opt-in is absent, the existing MCP server path is also
unchanged, including its separate service identity policy. Its narrow Instagram
scheduling OPERATOR fallback is never used by the authenticated discovery path.

## Explicit future configuration

No production values are supplied by this change. An authorized operator must
approve all of the following before any separate deployment/configuration step:

- `MCP_READONLY_AUTH_ENABLED=true` (only exact `true` enables it; missing or exact
  `false` preserves the existing path; other values fail startup)
- `MCP_READONLY_RESOURCE_URL`: explicit canonical HTTPS URL with root pathname exactly
  `/mcp` (nested prefixes are unsupported), without credentials, query or fragment; never inferred from request headers
- `MCP_READONLY_OIDC_ISSUER`: exact canonical HTTPS approved access-token issuer,
  without credentials, query or fragment
- `MCP_READONLY_OIDC_AUDIENCE`: must exactly equal `MCP_READONLY_RESOURCE_URL`;
  no additional audiences or unrelated API/login client identifiers are accepted
- `MCP_READONLY_OIDC_JWKS_URI`: approved HTTPS public-key endpoint
- `MCP_READONLY_PRINCIPALS_JSON`: nonempty JSON array of strict objects with
  `subject`, `tenantId`, `workspaceId`, and `organizationId`; every field must be
  explicit and nonblank, and subjects must be unique under the configured issuer

Missing or invalid enabled configuration fails startup. There are no issuer,
audience, JWKS, subject, tenant, workspace, or organization defaults. The mapping
is deployment-controlled authorization data, not a claim accepted from clients.
Adding/changing mappings requires a separate authorized operational change.

## Authentication boundary

Each POST must carry one Bearer token. Signature, issuer, audience, subject, and
expiry are validated by the existing verifier. Signed OAuth `scope` must include
`toca:read`, and signed `client_id` must be nonempty. The boundary strictly rejects
expired tokens, including the verifier's permitted clock-skew interval. A mapped
issuer/subject pair becomes a collision-resistant HUMAN principal; OAuth client
ID is transport metadata and never the user identity. The grant is READER only,
with empty capability/route/account grants. Additional token privileges do not
expand it. Unknown subjects and failed verification are denied without fallback.

Only server-created AuthInfo objects are accepted through a private WeakMap.
The normalized Node request explicitly carries that verified object into the
SDK's authInfo handoff. Header, body, `_meta`, request.auth, session ID, and token
tenant/role claims cannot substitute identity or widen the explicit mapping.
Every MCP request uses a fresh SDK server instance; identity expiry is checked
again before each tool invocation. GET/DELETE are not supported by this stateless
surface. Authenticated POST bodies are bounded to 64 KiB. Errors do not return
token contents or verification details.

## What remains before a usable integration

When enabled, unauthenticated GET/HEAD at
`/.well-known/oauth-protected-resource/mcp` returns RFC 9728 resource metadata.
It advertises only the configured resource, configured issuer, `toca:read`, and
header bearer transport. The 401 challenge points to that configured metadata URL
and announces the required read scope. Host and forwarded headers never select
these values; metadata does not disclose subject mappings or JWKS configuration.
The route is absent when this binding or MCP is disabled. It does not expose
an authorization-server metadata endpoint, login page, client registration or
token endpoint. The configured external issuer must provide those separately.

This is authenticated discovery plumbing only. Authorization-server discovery,
client registration/login, owner-approved trust and subject mapping, a supported
client/plugin, and end-to-end connection evidence remain separate gates. An
operator must route the configured HTTPS resource and metadata paths consistently;
this source change does not create that route or relax private ingress/IAM.
See the official
[MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

The existing Core ingress/IAM/default-URL restrictions and runtime service account
remain untouched. No credentials are minted or saved, and no real-auth probes,
production changes, merges, or provider calls are part of this patch. Local tests
generate temporary RSA fixtures in memory and inject local JWKS responses.

Business-data reads require a separately reviewed, explicitly bounded capability
surface with account/tenant authorization and runtime evidence. The existence of
a READ label or a catalog entry is not permission to expose its runtime.
