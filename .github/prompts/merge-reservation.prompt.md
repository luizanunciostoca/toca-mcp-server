# TOCA OS — PRO+ v2 Merge Reservation

For the selected integration candidate, freeze exact HEAD, verify fresh required checks and all locks/dependencies, then write a single applicable `MERGE_RESERVED` entry in #640.

Immediately before merge, revalidate main and expected HEAD. If either moved, release/replace the reservation and require fresh integration analysis. After merge, transition to `POST_MERGE_ACCEPTANCE`; release the reservation only after stale downstream evidence is reconciled.
