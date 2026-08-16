# v2.8.0 — The queue keeps up with the queue, and kernel wheels stay current

User report: *"I had a big queue running today. It finished everything, but
the queue panel never updated — it still looked like the generation was not
finished yet."*

The generation was fine — every job completed server-side. What froze was the
**display**: while the launcher window is hidden or minimized (tray, alt-tab,
covered by another window), Chromium throttles timers in the embedded Wan2GP
page. The queue panel stops updating even though the Python server keeps
processing, so a finished queue can sit looking "still running" until a manual
reload.

The launcher now keeps the embedded page live while hidden, and catches up the
queue panel automatically when you come back. While investigating, another gap
surfaced and was fixed too: **GPU kernel wheels were never refreshed on
update** — installs got the wheels `setup_config.json` wanted, but updates only
reinstalled `requirements.txt`, so an upstream wheel bump (like the GGUF
llama.cpp CUDA kernels 1.0.7 → 1.0.8 release) silently never landed even after
the repo code was current.

## Fixed

- **The embedded Wan2GP page is no longer throttled while the launcher is in
  the background.** `backgroundThrottling: false` on the BrowserView (and on
  the pop-out window) means timers and the SSE stream keep flowing when the
  window is hidden, minimized, or covered — the queue panel updates live even
  when you can't see it.
- **The queue re-syncs on window restore.** If the window was away for more
  than 30 seconds **and** a queue event was seen while it was hidden, the
  embedded view is reloaded once on restore so the queue panel catches up with
  the server — no manual F5 needed. The server itself is never touched, so a
  running generation is unaffected (same principle as the crash-watchdog
  reload).
- **The re-sync never clobbers your work.** A lightweight activity stamp
  (independent of the notifier/pulsebar config) tracks queue events from the
  launch-log stream. The reload only fires when a queue was actually running
  while the window was away — if you were just idle or typing a prompt, the
  page is left exactly as you left it. Quick alt-tab/minimize blips under 30
  seconds are ignored too, and a restore+show double-fire can't reload twice.
- **GPU kernel wheels now sync on install AND update.** Wan2GP's own
  `setup.py update` only reinstalls `requirements.txt` — kernel wheels
  (Nunchaku, Lightx2v, GGUF llama.cpp CUDA kernels) were installed only at
  fresh-install time. The launcher now reads the repo's `setup_config.json`
  (the authoritative source), resolves the GPU profile exactly like
  `setup.py`, and pip-installs any kernel wheel whose version differs from
  what's installed — cheap no-op when everything is current, and it runs even
  when the repo was already at the latest commit. That's how the **GGUF kernels
  1.0.8** upgrade (accurate native BF16, lower VRAM, CUDA-graph-safe Stream-K)
  reaches existing installs.

## Impact

- Desktop mode: a big queue that finishes while the window is hidden now looks
  finished when you come back — the panel either stayed live the whole time or
  re-syncs itself in one reload (with a
  `[*] Launcher window restored — reloading embedded Wan2GP view…` line in the
  launch log).
- Kernel wheels are always the ones `setup_config.json` specifies — after any
  Update, the launch log shows
  `[*] Kernel wheel sync (GPU …, profile …): nunchaku_cu13, gguf…` and
  `[*] Kernel 'gguf': installing llamacpp-gguf-cuda 1.0.8… (had 1.0.7)` when a
  bump is applied.
- No behavior change for healthy sessions: nothing reloads unless the window
  was away for a meaningful time with a queue actually running, and the kernel
  sync does nothing when the wheels already match.
- Browser mode and external-terminal mode are unaffected (the throttling and
  re-sync only apply to the launcher's own embedded view).