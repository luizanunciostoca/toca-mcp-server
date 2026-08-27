# Sunset Story font pin readiness

The V1-V9 Google Drive manuals are authoritative for typography roles and visual matching. They identify Didone/Didot-like editorial display and clean/geometric sans families such as Montserrat/Poppins/Avenir/Gotham/Helvetica-like depending on the template.

A search of the canonical typography area did not establish an approved downloadable font binary for these roles. Therefore family names from manuals are treated as visual specifications, not as an authorization to guess or silently substitute a font file.

Runtime promotion requires, per role:

1. authorized font binary;
2. immutable asset identity/location;
3. SHA-256 pin verified against the bytes used by the renderer;
4. license/distribution status recorded;
5. deterministic V1-V9 visual regression against the approved references.

Until then the renderer architecture may resolve test/staging font adapters, but production readiness remains fail-closed and `runtimeEligible=false`.
