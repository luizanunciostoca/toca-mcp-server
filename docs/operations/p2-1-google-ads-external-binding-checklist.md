# P2.1 — Secure external binding checklist

Do not paste any credential value into GitHub, Drive, Issues, logs, or chat.

Create/store the following values only in Google Cloud Secret Manager (or another approved secret boundary):

- Google Ads developer token
- OAuth client ID
- OAuth client secret
- OAuth refresh token with access to the target Google Ads account

Then configure references/metadata, not values:

- `GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET`
- `GCP_GOOGLE_ADS_DEVELOPER_TOKEN_SECRET_VERSION`
- `GCP_GOOGLE_ADS_CLIENT_ID_SECRET`
- `GCP_GOOGLE_ADS_CLIENT_ID_SECRET_VERSION`
- `GCP_GOOGLE_ADS_CLIENT_SECRET_SECRET`
- `GCP_GOOGLE_ADS_CLIENT_SECRET_VERSION`
- `GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET`
- `GCP_GOOGLE_ADS_REFRESH_TOKEN_SECRET_VERSION`
- `GOOGLE_ADS_CUSTOMER_ID`
- optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `GOOGLE_ADS_ALLOWED_CURRENCY`
- `GOOGLE_ADS_MAX_DAILY_BUDGET_MICROS`
- `GOOGLE_ADS_CURRENCY_MINOR_UNIT_MICROS`
- `GOOGLE_ADS_ALLOWED_LOCATION_CRITERION_IDS`
- optional `GOOGLE_ADS_ALLOWED_LANGUAGE_CRITERION_IDS`

After these bindings exist, run the read-only provider proof. The proof must keep the public runtime `GOOGLE_ADS_PHASE=OFF` and `GOOGLE_ADS_PROVIDER_VERIFIED=false` until Google Ads itself confirms the readback.

P2.1 read-only closure does not authorize `CREATE_PAUSED`, `ACTIVATE`, budget changes, delivery, or spend.
