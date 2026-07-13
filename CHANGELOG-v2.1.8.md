# Wan2GP Desktop Launcher v2.1.8

**Bugfix release** — terminal docking/floating reliability and the floating console resize.

## Fixes
- **Grey field on terminal close** — the main BrowserView never re-expanded after closing the
  console because the reattach handler was a no-op when the view was already attached. It now
  always resets the view and restores it to full size, so closing the terminal leaves Wan2GP
  full and interactable with no grey gap.
- **Wan2GP always visible** — the floating terminal no longer detaches the Wan2GP view. In
  floating mode Wan2GP stays full and interactable in the main window while the console lives in
  its own movable window (can be dragged to a second monitor).
- **Floating console resizes with its window** — the floating terminal content was locked to a
  fixed 480px width from the shared `.floating-term.dock-floating` style. It now fills the
  window (`width:100%`/`height:100%`) and reflows when you resize the console window.

## Docked terminal
Bottom / top / left / right docks shrink the Wan2GP view and show the console panel beside it,
exactly as before. Use the dock buttons in the console header to switch between docked and
floating modes.
