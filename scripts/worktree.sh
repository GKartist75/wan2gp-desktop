#!/usr/bin/env bash
# worktree.sh — isolate experiments in a SEPARATE folder so your main
# wan2gp-desktop directory stays exactly as-is on the released version.
#
# Usage:
#   ./scripts/worktree.sh add exp/scratch            # new experiment folder off current branch
#   ./scripts/worktree.sh add feat/x main           # new folder off main
#   ./scripts/worktree.sh list                      # show active worktrees
#   ./scripts/worktree.sh remove exp/scratch        # tear down (asks before deleting files)
#
# Worktree folders live as siblings: ../wan2gp-desktop.exp-scratch
# Same git repo, fully isolated working tree, no effect on your main checkout.
set -euo pipefail

CMD="${1:-}"
ARG="${2:-}"
BASE="${3:-$(git branch --show-current)}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT_PARENT="$(dirname "$ROOT")"

case "$CMD" in
  add)
    [ -z "$ARG" ] && { echo "Usage: $0 add <branch-name> [base]" >&2; exit 1; }
    case "$ARG" in main|dev) echo "ERROR: do not use '$ARG' as a worktree branch." >&2; exit 1 ;; esac
    WT_DIR="$WT_PARENT/wan2gp-desktop.${ARG//\//-}"
    if [ -d "$WT_DIR" ]; then echo "ERROR: $WT_DIR already exists." >&2; exit 1; fi
    git fetch origin "$BASE" --quiet 2>/dev/null || true
    git worktree add -b "$ARG" "$WT_DIR" "origin/$BASE" 2>/dev/null \
      || git worktree add -b "$ARG" "$WT_DIR" "$BASE"
    echo "✅ Worktree ready: $WT_DIR"
    echo "   cd $(cygpath -w "$WT_DIR" 2>/dev/null || echo "$WT_DIR")"
    echo "   (your main folder $ROOT is untouched)"
    ;;
  list)
    git worktree list
    ;;
  remove)
    [ -z "$ARG" ] && { echo "Usage: $0 remove <branch-name>" >&2; exit 1; }
    WT_DIR="$WT_PARENT/wan2gp-desktop.${ARG//\//-}"
    if [ ! -d "$WT_DIR" ]; then echo "No worktree at $WT_DIR" >&2; exit 1; fi
    git worktree remove "$WT_DIR" --force 2>/dev/null || { echo "ERROR: worktree busy. cd out of it first, or use 'git worktree remove' manually." >&2; exit 1; }
    git branch -d "$ARG" 2>/dev/null || true
    echo "✅ Removed $WT_DIR"
    ;;
  *)
    echo "Usage:" >&2
    echo "  $0 add <branch> [base]   create isolated experiment folder" >&2
    echo "  $0 list                  list active worktrees" >&2
    echo "  $0 remove <branch>       tear down worktree" >&2
    exit 1
    ;;
esac
