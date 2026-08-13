#!/usr/bin/env bash
# Release script for Wan2GP Desktop Launcher (Windows)
# Usage: ./scripts/release-win.sh 2.1.5
# Requires: GH_TOKEN env var with repo scope

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./package.json').version")
  echo "No version arg — using package.json version: $VERSION"
fi

if [ -z "${GH_TOKEN:-}" ]; then
  echo "ERROR: GH_TOKEN environment variable not set"
  exit 1
fi

REPO="GKartist75/wan2gp-desktop"
ARTIFACT="Wan2GP-Desktop-Launcher-${VERSION}-win-x64.exe"
BLOCKMAP="${ARTIFACT}.blockmap"
UPLOAD_URL=""

echo "==> 1. Bump version to $VERSION"
npm --no-git-tag-version version "$VERSION"

echo "==> 2. Stage, commit, tag, push"
git add -A
git commit -m "v$VERSION"
git tag "v$VERSION"
# Push to the CURRENT branch only — never force main. dev and main are kept
# strictly separate; releases are cut from whatever branch you run this on.
git push origin HEAD --tags

echo "==> 3. Build Windows installer"
npx electron-builder --win --config electron-builder.yml
echo "  -> Build done. Artifacts in dist/"

echo "==> 4. Create draft GitHub release"
RESP=$(curl -sf -X POST \
  -H "Authorization: token $GH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(cat <<END
{"tag_name":"v$VERSION","name":"v$VERSION","draft":true}
END
  )" \
  "https://api.github.com/repos/$REPO/releases")

RELEASE_ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
UPLOAD_URL="https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets"
echo "  -> Release draft created (ID: $RELEASE_ID)"

echo "==> 5. Upload assets"
for asset in "latest.yml" "$BLOCKMAP" "$ARTIFACT"; do
  if [ -f "dist/$asset" ]; then
    echo "  Uploading $asset..."
    curl -sf -X POST \
      -H "Authorization: token $GH_TOKEN" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"dist/$asset" \
      "$UPLOAD_URL?name=$asset" > /dev/null
    echo "    OK"
  else
    echo "  WARNING: dist/$asset not found"
  fi
done

RELEASE_URL="https://github.com/$REPO/releases/tag/v$VERSION"
echo ""
echo "==> ✅ v$VERSION released!"
echo "    Go publish it: $RELEASE_URL"
