# Sunset Story runtime font candidates

These binaries are deterministic runtime candidates for the Sunset Story V1-V9 renderer. Their use is authorized by the canonical Google Drive Sunset template catalogue as visual-match candidates, not as proof of the exact original campaign font identity.

| File                      | Family      | SHA-256                                                            |  Bytes | Provenance                                                                        |
| ------------------------- | ----------- | ------------------------------------------------------------------ | -----: | --------------------------------------------------------------------------------- |
| `BodoniModa-Variable.ttf` | Bodoni Moda | `550f5e34ee0a828d7941b1fe9bc58b34e5260d3f33a61532e6d0a0114e79a5cf` | 162104 | exact Git blob `c5d582f8003ae692761dd8e9ce69de23cb9fea53` from historical PR #285 |
| `Montserrat-Variable.ttf` | Montserrat  | `0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7` | 744936 | exact Git blob `c97aca18592834d8706549c279cb8d5ac5d85f69` from historical PR #285 |

The Google Drive catalogue document `1bnidj7jlQ3oUBa69O-qFwwQ-ZvAq8gDbROTqFHbQNAo` identifies Bodoni Moda as the recommended runtime candidate for the Bodoni/Didot editorial class and Montserrat as the recommended runtime candidate for functional geometric sans text.

`font_identity_status` remains `VISUAL_MATCH_CANDIDATE_NOT_PROVEN_FROM_FLATTENED_PNG`. These files make rasterization deterministic, but they do not by themselves authorize `runtimeEligible=true`, `STORY_READY`, PREPARE, PUBLISH, or provider mutation. V1-V9 reference regression remains mandatory.
