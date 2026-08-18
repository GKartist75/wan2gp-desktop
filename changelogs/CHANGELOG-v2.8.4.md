# v2.8.4 — boot.log now lives in the launcher's own folder

Small follow-up to v2.8.3.

## Changed
- **`boot.log` is written to the launcher's own data folder**
  (`%LOCALAPPDATA%\Wan2GP Desktop Launcher\boot.log` on Windows) instead of
  `getDataDir()`.

  `getDataDir()` can be redirected by the data-dir override file
  (`%USERPROFILE%\.wan2gp-desktop-data-dir`) — which on some setups points at
  the user's home root, dumping `boot.log` (and `desktop-config.json`) straight
  into `C:\Users\<user>\`. The boot tracer is purely a launcher diagnostic, so it
  now lives in the launcher's own folder, independent of where Wan2GP core is
  installed or what the data-dir override says.

  Implementation note: the first attempt used `app.getPath('userData')`, but that
  is *also* redirected by the data-dir override, so it still landed in the home
  root. v2.8.4 computes the folder explicitly from `LOCALAPPDATA` + the app name,
  which the override cannot affect.

- The **"Report an issue" bundle** reads `boot.log` from the same launcher
  folder, so it still attaches correctly.

## No behavior change to the fix
The v2.8.3 black-screen fix (show-on-`ready-to-show`, not `did-finish-load`) is
unchanged. This release only relocates the diagnostic file.
