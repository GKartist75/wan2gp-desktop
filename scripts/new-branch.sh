#!/usr/bin/env bash
# new-branch.sh — start a safe topic branch WITHOUT touching main.
#
# Usage:
#   ./scripts/new-branch.sh feat/my-thing          # branch off current branch
#   ./scripts/new-branch.sh fix/bug-123 main       # branch off main (must be clean)
#   ./scripts/new-branch.sh exp/scratch dev        # branch off dev
#
# Rules enforced:
#   - Refuses to run while the working tree is dirty (so you never lose uncommitted work).
#   - If you name the branch "main" or "dev" it aborts — those are integration/release branches.
#   - Never resets, never force-pushes.
#
# After it runs you are ON the new branch, clean, ready to edit + commit.
set -euo pipefail

NAME="${1:-}"
BASE="${2:-$(git branch --show-current)}"

if [ -z "$NAME" ]; then
  echo "Usage: $0 <branch-name> [base-branch]" >&2
  echo "  e.g. $0 feat/my-thing" >&2
  exit 1
fi

# Guard: never clobber the protected branches.
case "$NAME" in
  main|dev|release/*) echo "ERROR: do not create a branch named '$NAME' (protected). Use feat/* or fix/*." >&2; exit 1 ;;
esac

# Guard: clean tree only.
if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is dirty. Commit or stash first so nothing is lost." >&2
  git status --short >&2
  exit 1
fi

# Make sure the base is current.
git fetch origin "$BASE" --quiet 2>/dev/null || true
git checkout "$BASE"
git merge --ff-only "origin/$BASE" 2>/dev/null || echo "  (note: origin/$BASE not fast-forwardable or absent — using local $BASE)"

git checkout -b "$NAME"
echo "✅ On new branch '$NAME' (based on $BASE). Edit freely, commit, then:"
echo "   git push -u origin $NAME"
echo "   gh pr create --base dev --title \"...\""
