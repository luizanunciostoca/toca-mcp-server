# TOCA OS Instagram publication state

This branch is the durable, append-only operational ledger for the GitHub-native Instagram publisher.

Runtime JSON records are written under this directory using a SHA-256 digest of the publication idempotency key as the filename.

Do not edit or delete records to force a retry. Reconcile provider state first.
