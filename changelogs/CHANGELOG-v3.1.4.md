# v3.1.4

## Desktop minimal + console + auto-update polling

**Desktop (BrowserView):** minimal — `backgroundThrottling:false` + `http://localhost:7860` only, no `bv-shim` H3/queue. Original `gradio_queue_focus_patch.py` handles keepalive alone, same as Browser. Removes double-wrap that froze `Prompt 2/2 37.5%` / `H3 3/8` progress and delayed `Video file saved` → `Done` + next queue. H3 `root(...).getElementById` spam will reappear in Desktop but is non-fatal.

**Console:** Desktop/Browser now log `[*] Environment` + `[*] Python` + `[*] Args` preamble, mirroring Terminal’s `echo Activating environment` — dockable console (`Ctrl+``) shows same startup as external terminal.

**Auto-update:** `autoUpdateEnabled` default `true` (was `false`). `setDesktopUpdateIndicator` toggles green border + dot on both Dashboard (`updateCheckBtn`) and Manage → Updates (`manageUpdateDesktopBtn`). `startDesktopPolling()` every **5h** + immediate `checkUpdate()` on dashboard load (mirrors Wan2GP 30min), so update dot appears without clicking.

176 tests pass.
