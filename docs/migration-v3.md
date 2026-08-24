# v3.0 — Install folders moved (READ THIS)

v3.0 changes **where Wan2GP lives on your disk**. This is the one thing you must check before/after upgrading.

## Old vs new default locations

| What | ❌ Before (v2.8.x) | ✅ Now (v3.0.0) |
|------|--------------------|-----------------|
| Repo + venv + `wgp_config.json` | `%APPDATA%\wan2gp-desktop\Wan2GP\Wan2GP` | **`C:\Wan2GP`** |
| Model checkpoints | `<repo>\ckpts` (inside the repo) | **`C:\Wan2GP-Models\ckpts`** |
| LoRAs | `<repo>\loras` | **`C:\Wan2GP-Models\loras`** |
| Generated outputs | `<repo>\outputs` | **`C:\Wan2GP-Models\outputs`** |

The old location was inside your **roaming AppData** profile — it travels with your account, can sync/backup unexpectedly, and counts against profile quotas. For tens–hundreds of GB of checkpoints that's a bad place to be. `C:\Wan2GP` is a dedicated top-level folder on a fast drive; `C:\Wan2GP-Models` keeps your large files separate from the code so backups and drive swaps are trivial.

> **All paths are user-selectable** — `C:\Wan2GP` and `C:\Wan2GP-Models\ckpts` are just the **recommended defaults**, pre-filled on the install screen. Click **Browse** to place the repo, checkpoints, LoRAs, or outputs on any drive/folder; your choice is saved. Nothing is hard-coded.

## How to upgrade — pick one

> **🧹 For v3.x, a clean reinstall is the recommended path.** v3.0 moved Wan2GP out of roaming AppData into dedicated `C:\Wan2GP` (repo) and `C:\Wan2GP-Models` (models). Because of that structural change, the most reliable upgrade is to **uninstall the old version and install v3.x fresh** — this sidesteps any leftover path/legacy confusion.

**✅ Preferred: uninstall, then install fresh**
1. Launcher → **Manage** → **Uninstall** (keep or delete your old models — they sit in the old AppData path).
2. **Close the launcher completely.**
3. Run the new v3.x `.exe` → it creates `C:\Wan2GP` fresh.
4. Copy/point your checkpoints at `C:\Wan2GP-Models\ckpts`.

**🧪 Built-in migration (experimental — test it, no guarantee).** If you'd rather keep your current install, v3.x also ships an in-app **"Migrate to new location"** button (dashboard `MODELS` banner or Manage). It moves your data off AppData and rewrites `wgp_config.json` to the new folders. **This is experimental software:** please test it, and **back up your models first** — there is **no guarantee** it will work correctly on every setup. Use it at your own risk; a clean reinstall remains the safe option.

**🟡 Also works: in-place update (v3.0.0).** Updating an existing v2.8.x install **auto-migrated** your old AppData data dir into `C:\Wan2GP` on first launch (rollback-safe: source removed only after the move verified on disk).

> **⚠️ v3.0.0 → v3.0.1 upgrade note.** v3.0.0's automatic pre-paint migration could leave some roaming installs with no window at all. **v3.0.1 does NOT auto-migrate** — on first launch it only opens the **"Migrate to new location"** dialog and waits for you to choose (prefilled `C:\Wan2GP` + `C:\Wan2GP-Models`). If you upgraded and saw a blank launch, just reinstall v3.0.1 fresh (or use the in-app Migrate button) — your old data is not deleted, it's still in `Roaming\wan2gp-desktop` until you move it.

> Either path lands you at `C:\Wan2GP`. Uninstall-first is cleaner; update-in-place is fine if you just want the new build. **No data is deleted by the migration.**

## Installation process (v3.0)

```
1. RUN the installer (.exe)
   → detects GPU, shows the packages it will install
        ▼
2. INSTALL SCREEN — check the defaults (now editable):
   • Wan2GP install location : C:\Wan2GP          ⚠ keep OUT of AppData
   • Model folders           : C:\Wan2GP-Models\ckpts  (loras/outputs)
     ⚠ checkpoints/LoRAs are large — use a fast, non-system drive
        ▼
3. CLICK Install (~5–20 min)
   → git clone Wan2GP → uv venv → PyTorch+CUDA → requirements
   → attention kernels (Sage/Sparge/Flash/Nunchaku/GGUF/bnb)
   → writes wgp_config.json (ckpts=C:\Wan2GP-Models\ckpts)
        ▼
4. LAUNCH — Desktop (green, in-app) or Browser (amber)
   → Wan2GP opens, ready to use
```

## 🔄 Auto-update & the GitHub token

The launcher checks **GitHub Releases** for a newer build. Two independent checks run (each is a separate GitHub API call):

| Check | What it does | Where it's controlled |
|-------|--------------|----------------------|
| **Launcher self-update** | looks for a newer `wan2gp-desktop` release (`releases/latest`) | **Manage → Desktop → *Auto-update*** toggle (on by default at launch) + the dashboard *↻ Check for updates* button |
| **Wan2GP core update** | shows the green "new commit available" dot on the dashboard | polls the upstream `deepbeepmeep/Wan2GP` repo, cached 5 min |

> **⚠️ GitHub API rate limit.** Both calls are **unauthenticated** by default, and GitHub caps anonymous API access at **60 requests/hour per IP**. If you restart the launcher often (e.g. while testing) or share an IP with others, that bucket can empty and you'll see *"GitHub rate limited — add a token in Manage settings"*. The check then fails until the window resets.

> **Fix — add a GitHub token (your own, per-user):** open **Manage → Settings → *GitHub token***, paste a **classic personal access token** with the **`repo`** (or at least `public_repo`) scope, and **Save**, then **restart** the launcher. This raises the limit to **5000 requests/hour** and is drawn against **your** token only — it is stored in your local `desktop-config.json` and is **never shipped in the `.exe`**, so it can't be seen by or shared with other users.
> Generate one at GitHub → *Settings → Developer settings → Personal access tokens → Tokens (classic)*.

> **Note:** the Wan2GP-core poll is cached 5 minutes, so normal day-to-day use won't exhaust the anonymous limit — the rate-limit message almost always comes from repeated launcher restarts or a busy shared IP, and is resolved by adding the token above.
