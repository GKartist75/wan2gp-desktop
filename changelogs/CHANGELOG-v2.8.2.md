# v2.8.2 — the launcher no longer black-screens (and you can fix it without reopening it)

A blank/black launcher window on first launch — title bar visible, content
never appears — turned out to be a **GPU-compositor first-present failure**, not
a setup problem. This release makes the launcher recover on its own, and gives
users a one-file escape hatch when it doesn't.

## Fixed

- **The window now shows the moment the HTML is parsed**, instead of waiting for
  the compositor's `ready-to-show` event. On some drivers, RDP/VM/virtual
  displays, and Parsec-style setups the first present can stall for several
  seconds — that stall read as a black screen. The splash now paints
  immediately, so the worst case is "splash appears a beat later", not "nothing".
- **Blank-screen watchdog shortened to 4s.** If the renderer still hasn't
  painted, the window is force-shown and a splash diagnostic explains the
  GPU-compositing cause — instead of sitting on a silent black window
  (issue #39, and the "~5s blank" reports).
- **Home-directory GPU-off override file.** Create an empty file at
  - Windows: `%USERPROFILE%\.wan2gp-desktop-gpu-off`
  - macOS/Linux: `~/.wan2gp-desktop-gpu-off`
  
  and restart. The launcher disables hardware acceleration at module load — before
  the window ever tries to paint — so a user stuck on a permanently black launcher
  can recover **without reaching Settings** (which they couldn't open anyway).
  This is the same switch as Settings → General → "Enable GPU acceleration",
  honored earlier in the boot so it actually helps.

## Root-cause note (empirically tested)

The black screen is **not** a git problem. The launcher was tested three ways
with a deliberately broken git environment —

1. an unreachable git remote (every call hangs then errors),
2. the real 2.8.1 release under that broken git,
3. a corrupted / non-executable `git` shadowing the real one —

and the launcher painted normally in all three. Every launcher git call is
wrapped in try/catch with a 5s timeout and returns null on failure; the
auto-update check is plain HTTP to the GitHub releases API, not git. Git
reachability categorically cannot blank the launcher. The black screen comes
from the GPU process failing to present its first frame (the title bar is drawn
by the OS; the webview content is composited by the GPU process), which the
GPU-off override fixes by moving compositing to software.

## Other

- Version bumped to 2.8.2.
