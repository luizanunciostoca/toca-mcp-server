# TOCA OS — PRO+ v2 Main Stability Gate

Before expensive runtime/build/evidence work, revalidate main and post-merge acceptance, inspect #639 and #640, and determine whether any critical/runtime-relevant candidate is merge-reserved or immediately ready to merge.

Set `MAIN_STABILITY=PASS` in #640 only for the exact current SHA when all `control/pro-plus/build-broker-policy.json` conditions pass and `MERGE_RESERVATION=NONE`. Otherwise set it BLOCKED with a sanitized reason.

A prior PASS never carries across a main-changing merge.
