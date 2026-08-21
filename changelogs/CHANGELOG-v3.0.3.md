# Changelog — v3.0.3

**Topic:** Hotfix for the v3.0.2 SageAttention swap on **RTX 40/50**. v3.0.2 shipped
with a broken swap that made **Sync Kernels** fail. This release fixes both root
causes and bumps the version so the auto-updater actually offers it to everyone
still on the broken 3.0.2 (a same-version re-upload would NOT trigger an update,
because the client and `latest.yml` would both still read `3.0.2`).

> The feature set is otherwise identical to v3.0.2: the RTX 3080 `accelerate` /
> z-image fix, the install progress heartbeat, and the SAGE sync banner are all
> unchanged and already correct.

## 🐞 Bug 1 — `Sync Kernels` produced `undefinedsageattention-…whl`

**Symptom users saw:**
```
WARNING: Requirement 'undefinedsageattention-2.2.0+cu128torch2.7.1-cp310-cp310-win_amd64.whl' looks like a filename, but the file does not exist
ERROR: undefinedsageattention-2.2.0+cu128torch2.7.1-cp310-cp310-win_amd64.whl is not a supported wheel on this platform.
[!] SageAttention: could not replace wheel (pip exited 1).
```

**Root cause:** `services/kernel-resolver.js` defined the constant
`SAGE_CU128_BASE` (the release-URL prefix) but **forgot to export it**.
`main.js` then assembled the wheel URL as `kernelResolver.SAGE_CU128_BASE +
kernelResolver.SAGE_CU128_WHEEL` → `undefined + 'sageattention-…whl'` →
`undefinedsageattention-…whl`, which pip could not resolve.

**Fix:** `SAGE_CU128_BASE` is now included in `module.exports`, so the URL is
correctly built as
`https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows/sageattention-2.2.0+cu128torch2.8.0-cp311-cp311-win_amd64.whl`.
(PR #68.)

## 🐞 Bug 2 — swap target was a Python-3.10-only wheel (pip-rejected on 3.11)

Even with the URL fixed, the original target wheel was
`sageattention-2.2.0+cu128torch2.7.1-**cp310-cp310**-win_amd64.whl` — a
**Python 3.10-only** build. The launcher provisions **Python 3.11.14** for
RTX 30–50 (per Wan2GP's `INSTALLATION.md` and `setup_config.json`), so pip
rejects a `cp310` wheel on 3.11 with *"not a supported wheel on this platform."*

**Fix:** the swap now targets
`sageattention-2.2.0+**cu128torch2.8.0-cp311-cp311**-win_amd64.whl` — the
stable fp8-safe SageAttention2++ build for Python 3.11, verified live
(HTTP 200, 12.1 MB). The `cu128` family avoids the broken `cu130` fp8-PV
CUDA kernel that corrupted the CUDA context on RTX 40/50. (PR #67.)

## Why this is a new version (3.0.3) and not a 3.0.2 re-upload

The embedded auto-updater compares the running app's version string against the
`version:` field in `latest.yml`. If both say `3.0.2`, it reports "already
up to date" and offers nothing — so every user who downloaded the broken 3.0.2
(including anyone who hit the `undefined` error) would be stuck forever. Bumping
to **3.0.3** makes `3.0.3 > 3.0.2`, so existing 3.0.2 clients are correctly
prompted to update. This is why the corrected build ships as a new tag/release
rather than overwriting the old asset.

## Files changed

- `services/kernel-resolver.js` — export `SAGE_CU128_BASE`; swap target is now the
  `cu128torch2.8.0-cp311-cp311` wheel (Python 3.11 compatible).
- `main.js` — `setSageAttentionSafe()` doc comment updated to the correct wheel.
- `tests/kernel-resolver.test.js` — assertions updated to the `cp311` wheel.
- `package.json` — version `3.0.2 → 3.0.3`.

## Verification

- `npm test` → 118 pass. `node --check` on all sources OK.
- The swap URL now resolves to a real, downloadable `cp311` wheel (HTTP 200).
- The release notes name the correct wheel (`cu128torch2.8.0-cp311-cp311`).

## Upgrade

Install v3.0.3. **RTX 40/50** users: after updating, click **Sync Kernels** once
(or run one Update) to apply the stable SageAttention wheel. **RTX 30/20/older**:
no action needed (different, safe kernel paths; the swap only fires on RTX 40/50
+ torch ≥ 2.10).

Full write-up: [CHANGELOG-v3.0.2.md](https://github.com/GKartist75/wan2gp-desktop/blob/main/changelogs/CHANGELOG-v3.0.2.md)
