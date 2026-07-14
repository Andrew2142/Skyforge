#!/usr/bin/env bash
# Skyforge installer — copies the skill + worker agent into your Claude Code config.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Andrew2142/Skyforge/main/install.sh | bash
# or, from a clone:
#   ./install.sh
set -euo pipefail

REPO_URL="https://github.com/Andrew2142/Skyforge.git"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILL_DIR="$CLAUDE_DIR/skills/skyforge"
AGENTS_DIR="$CLAUDE_DIR/agents"

say() { printf '%s\n' "$*"; }

# Use this checkout if the script is run from inside the repo; otherwise clone.
SRC=""
if [ -n "${BASH_SOURCE:-}" ] && [ -f "${BASH_SOURCE[0]:-}" ]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [ -f "$here/SKILL.md" ] && SRC="$here"
fi

CLEANUP=""
if [ -z "$SRC" ]; then
  command -v git >/dev/null 2>&1 || { say "error: git is required to install Skyforge"; exit 1; }
  TMP="$(mktemp -d)"
  CLEANUP="$TMP"
  say "Fetching Skyforge…"
  git clone --depth 1 --quiet "$REPO_URL" "$TMP/Skyforge"
  SRC="$TMP/Skyforge"
fi
trap '[ -n "$CLEANUP" ] && rm -rf "$CLEANUP"' EXIT

say "Installing into $CLAUDE_DIR"
mkdir -p "$SKILL_DIR/references" "$SKILL_DIR/scripts" "$AGENTS_DIR"
cp "$SRC/SKILL.md"                  "$SKILL_DIR/SKILL.md"
cp "$SRC/references/protocol.md"    "$SKILL_DIR/references/protocol.md"
cp "$SRC/scripts/board.mjs"         "$SKILL_DIR/scripts/board.mjs"
cp "$SRC/agents/skyforge-worker.md" "$AGENTS_DIR/skyforge-worker.md"

say ""
say "✓ Skill installed   → $SKILL_DIR"
say "✓ Worker agent      → $AGENTS_DIR/skyforge-worker.md"
say ""
say "Start a new Claude Code session, then say:  \"spin up the factory\""
