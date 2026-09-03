# Instagram Engagement — Facebook Login Subscription Boundary

Status: ACTIVE

## Context

TOCA's current Instagram engagement integration uses the Instagram API with Facebook Login model:

- the Instagram Professional account is linked to Facebook Page `306103746115875`;
- provider access is made through `graph.facebook.com`;
- the runtime resolves a Page access token from the authorized Meta root token;
- Instagram messaging permissions include `instagram_basic`, `instagram_manage_messages`, and `pages_manage_metadata`;
- Page messaging subscription uses the linked Page `/subscribed_apps` edge.

Production shadow run `33704420071` passed readiness, candidate routing, webhook callback verification, COMMENT + DIRECT synthetic E2E, and Conversation Operations proof. It failed only when the subscription configurator attempted the Instagram account `/subscribed_apps` edge with the Facebook Login/Page-token model.

Read-only retained diagnostic `#514` isolated the failure to:

- `FAILURE_STAGE=INSTAGRAM_SUBSCRIPTION`
- `META_INSTAGRAM_SUBSCRIPTION_FAILED:400`

No diagnostic provider read/write or external reply occurred.

## Decision

For the current Facebook Login integration, subscription setup is:

1. verify the webhook callback;
2. configure the app-level `instagram` webhook fields;
3. subscribe the linked Facebook Page to messaging events with its Page access token;
4. read back the linked Page subscription and require the TOCA Meta app to be present.

The runtime MUST NOT call the Instagram professional account `/subscribed_apps` edge using `graph.facebook.com` plus a Page access token.

That per-Instagram-account subscription belongs to the separate Instagram Login model, which uses the Instagram API host and an Instagram access-token model. If TOCA adopts Instagram Login in the future, it must be implemented as a separate explicit provider mode rather than blended into the current Page-bound path.

## Evidence contract

Successful Facebook Login subscription configuration emits:

- `subscriptionModel=FACEBOOK_LOGIN_PAGE_BOUND`
- `appSubscriptionConfigured=true`
- `pageSubscriptionConfigured=true`
- `instagramSubscriptionConfigured=true` as the backwards-compatible aggregate marker that Instagram webhook delivery is configured;
- `instagramAccountSubscriptionRequired=false`
- `instagramAccountSubscriptionAttempted=false`
- `pageAccessTokenResolved=true`
- `secretsPrinted=false`

## Safety boundary

This decision changes subscription configuration only. It does not authorize:

- `INSTAGRAM_ENGAGEMENT_WRITES_ENABLED=true`;
- real COMMENT replies;
- real DIRECT replies;
- publication writes;
- paid-media or spend mutations.

A new immutable runtime build and a separate exact-SHA SHADOW_ONLY authorization are required before the production Reality Gate is repeated.
