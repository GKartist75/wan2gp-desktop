#!/usr/bin/env bash
# Release script for Wan2GP Desktop Launcher (Linux track)
# Usage: ./scripts/release-linux.sh 2.4.4   (run from the linux branch)
# Requires: GH_TOKEN env var with repo scope
#
# Tags as linux-v<version> (pre-release) so Windows and Linux releases stay
# fully separate on the Releases page. Windows tags are v<version> on main;
# Linux tags are linux-v<version> on the linux branch.

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

BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "linux" ]; then
  echo "ERROR: Linux releases must be tagged from the 'linux' branch (currently on '$BRANCH')"
  exit 1
fi

REPO="GKartist75/wan2gp-desktop"
TAG="linux-v${VERSION}"
DEB="Wan2GP-Desktop-Launcher-${VERSION}-linux-amd64.deb"
APPIMAGE="Wan2GP-Desktop-Launcher-${VERSION}-linux-x86_64.AppImage"

echo "==> 1. Bump version to $VERSION (linux branch)"
npm --no-git-tag-version version "$VERSION"

echo "==> 2. Stage and commit (tag + push happen only after a successful build)"
git add -A
git commit -m "linux: v$VERSION"

echo "==> 3. Build Linux packages"
npx electron-builder --linux --config electron-builder.yml
echo "  -> Build done. Artifacts in dist/"

echo "==> 4. Tag and push (only after the build succeeded)"
git tag "$TAG"
git push origin linux --tags

echo "==> 5. Create draft PRE-RELEASE"
RESP=$(curl -fsS -X POST \
  -H "Authorization: token ${GH_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<END
{"tag_name":"$TAG","name":"$TAG","draft":true,"prerelease":true}
END
  )" \
  "https://api.github.com/repos/$REPO/releases")

RELEASE_ID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$RESP")
UPLOAD_URL="https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets"
echo "  -> Release draft created (ID: $RELEASE_ID)"

echo "==> 6. Upload assets"
for asset in "latest-linux.yml" "$DEB" "$APPIMAGE"; do
  if [ -f "dist/$asset" ]; then
    echo "  Uploading $asset..."
    curl -fsS -X POST \
      -H "Authorization: token ${GH_TOKEN}" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"dist/$asset" \
      "$UPLOAD_URL?name=$asset" > /dev/null
    echo "    OK"
  else
    echo "  WARNING: dist/$asset not found"
  fi
done

RELEASE_URL="https://github.com/$REPO/releases/tag/$TAG"
echo ""
echo "==> ✅ $TAG released (pre-release)!"
echo "    Go publish it: $RELEASE_URL"
