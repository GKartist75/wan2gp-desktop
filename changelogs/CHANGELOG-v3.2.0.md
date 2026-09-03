# v3.2.0

## Topbar cleanup — no more twin-refresh confusion

**Removed the duplicate refresh icon.** The topbar had two identical ⟳ icons side by side in Desktop mode: "Refresh metrics" and "Reload view". Users clicked reload thinking it refreshed the metrics. The metrics refresh is gone — it only duplicated the automatic 2s metrics poll (plus static hardware info and event-driven dashboard refreshes). One ⟳ left, and it's the view reload.

**Removed dead `<` / `>` navigation buttons.** The embedded view is a single-page Gradio app with no URL bar — history never grows, so both buttons sat permanently disabled. Removed the buttons, their listeners, the `bv-nav-state` IPC plumbing, and narrowed `bv-navigate` to reload-only.

**Removed the popout button.** "Open in separate window" duplicated the dashboard's browser launch modes. If you want Wan2GP in a real window, launch it in a browser from the dashboard.

**Stop is now red** (`#EF4444`, same red as the Stopped LED) with a red-tinted hover — no more grey square lost among grey icons.

**Desktop group order:** `zoom · ← Back to Dashboard · ⊞ Console · ⟳ reload → ■ stop`. Reload sits next to stop, never next to the metrics.

**Console toggle is labeled.** The floating-terminal toggle was an icon-only `⊞` — now a `⊞ Console` button matching ← Back to Dashboard.

**Metrics/title overlap fixed.** The app title was absolutely positioned, so the metrics slid underneath it once the Desktop controls appeared. The title is now in-flow with ellipsis; narrow windows shed sparklines below 1150px, then the title below 900px, instead of overlapping.
