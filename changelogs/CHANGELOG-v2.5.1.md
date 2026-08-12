# v2.5.1 — RAM tier boundary fix

Small follow-up to v2.5.0 addressing reports of the Auto-Tune recommending
Profile 5 on hardware that should get P4 (e.g. RTX 5080 + 32GB RAM).

## Fixed

- **RAM tier boundary tolerance.** A "32GB" kit often reports **31.4–31.9 GiB**
  to the OS (BIOS/GFX reservations eat the difference) — the old strict
  `>= 32` boundary rounded that down to `very_low`, flipping the matrix cell
  to P5 on hardware that is really 32GB. Detection now keeps one decimal
  (`ram_gb` shows 31.8, not 32) and treats `>= 31.5` as the 32GB tier;
  `>= 63.5` as the 64GB tier. Real kits are no longer demoted.

- **Display honesty.** The detection card now shows the actual reported RAM
  (e.g. 31.8 GB) instead of a rounded number, so "why P5?" questions can be
  answered from the card itself.

## Notes

- If the recommendation card still reads "Failsafe · P5", that is the
  **Prefer failsafe** preference being on — it intentionally forces P5 on any
  hardware. Untick it to return to the matrix recommendation.

Tests: 35/35 green (4 new boundary tests).
