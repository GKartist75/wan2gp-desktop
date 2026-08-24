# Build from source

```bash
git clone https://github.com/GKartist75/wan2gp-desktop.git
cd wan2gp-desktop
npm install
npm start          # dev
npm run build:win  # Windows NSIS installer
```

For a release upload that includes `latest.yml` (required for auto-update), use the release script rather than a manual `gh release create` — it always attaches `latest.yml` + the blockmap + the exe:

```bash
GH_TOKEN=*** ./scripts/release-win.sh 3.0.9
```

The script bumps the version, builds, tags, pushes, and uploads **all** artifacts (so `electron-updater` can find `latest.yml` and existing installs can update).
