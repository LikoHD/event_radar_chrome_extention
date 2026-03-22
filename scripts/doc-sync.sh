#!/usr/bin/env bash
# doc-sync.sh — Change report + doc freshness detection for Tea Event Radar
# Usage: bash scripts/doc-sync.sh [base-ref]

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── Config ────────────────────────────────────────────────────────
DOCS_DIR="docs"
DIFF_MAX_LINES=200
METADATA_LINES=10
TRACK_PATHS=(
  "tea_event_radar/service-worker.js"
  "tea_event_radar/background.js"
  "tea_event_radar/content-script.js"
  "tea_event_radar/panel.js"
  "tea_event_radar/panel.html"
  "tea_event_radar/panel.css"
  "tea_event_radar/analytics-core.js"
  "tea_event_radar/platform-adapters.js"
  "tea_event_radar/platform-catalog.js"
  "tea_event_radar/manifest.json"
  "tea_event_radar/in-page-panel.css"
  "build.js"
  "package.json"
)

# ── Resolve refs ──────────────────────────────────────────────────
BASE_REF="${1:-}"
if [ -z "$BASE_REF" ]; then
  if git rev-parse --verify ORIG_HEAD >/dev/null 2>&1; then
    BASE_REF="ORIG_HEAD"
  else
    BASE_REF="main"
  fi
fi

HEAD_SHA="$(git rev-parse --short HEAD)"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
TODAY="$(date +%Y-%m-%d)"

if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "WARNING: Current branch is '$CURRENT_BRANCH', not 'main'"
  echo ""
fi

echo "=== DOC-SYNC CHANGE REPORT ==="
echo "Date: $TODAY"
echo "Base: $BASE_REF"
echo "Head: HEAD ($HEAD_SHA)"
echo ""

PATHSPECS=()
for p in "${TRACK_PATHS[@]}"; do
  PATHSPECS+=("$p")
done

echo "=== CHANGED FILES ==="
git diff --name-only "$BASE_REF"..HEAD -- "${PATHSPECS[@]}" 2>/dev/null || echo "(no changes or invalid base ref)"
echo ""

echo "=== CHANGE STATS ==="
git diff --stat "$BASE_REF"..HEAD -- "${PATHSPECS[@]}" 2>/dev/null || echo "(no stats)"
echo ""

echo "=== COMMITS ==="
git log --oneline "$BASE_REF"..HEAD -- "${PATHSPECS[@]}" 2>/dev/null || echo "(no commits)"
echo ""

echo "=== PER-FILE DIFFS ==="
CHANGED_FILES=$(git diff --name-only "$BASE_REF"..HEAD -- "${PATHSPECS[@]}" 2>/dev/null || true)
if [ -n "$CHANGED_FILES" ]; then
  while IFS= read -r file; do
    echo "--- FILE: $file ---"
    git diff "$BASE_REF"..HEAD -- "$file" 2>/dev/null | head -n "$DIFF_MAX_LINES"
    TOTAL_LINES=$(git diff "$BASE_REF"..HEAD -- "$file" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$TOTAL_LINES" -gt "$DIFF_MAX_LINES" ]; then
      echo "... (truncated, $TOTAL_LINES total lines)"
    fi
    echo ""
  done <<< "$CHANGED_FILES"
else
  echo "(no file diffs)"
  echo ""
fi

echo "=== DOC FRESHNESS ==="
NOW_TS=$(date +%s)
for doc in "$DOCS_DIR"/*.md; do
  [ -f "$doc" ] || continue
  LAST_COMMIT_TS=$(git log -1 --format="%at" -- "$doc" 2>/dev/null || echo "")
  if [ -z "$LAST_COMMIT_TS" ]; then
    echo "UNKNOWN:       $doc (untracked)"
    continue
  fi
  DAYS_AGO=$(( (NOW_TS - LAST_COMMIT_TS) / 86400 ))
  if [ "$DAYS_AGO" -le 14 ]; then
    BADGE="FRESH"
  elif [ "$DAYS_AGO" -le 30 ]; then
    BADGE="AGING"
  else
    BADGE="STALE"
  fi
  printf "%-18s (%2d days): %s\n" "$BADGE" "$DAYS_AGO" "$doc"
done
echo ""

echo "=== BROKEN LINKS ==="
FOUND_BROKEN=false
for doc in "$DOCS_DIR"/*.md; do
  [ -f "$doc" ] || continue
  DOC_DIR=$(dirname "$doc")
  while IFS= read -r link; do
    [ -z "$link" ] && continue
    TARGET="$DOC_DIR/$link"
    if [ ! -f "$TARGET" ]; then
      echo "$doc -> $link (NOT FOUND)"
      FOUND_BROKEN=true
    fi
  done < <(grep -oE '\[([^]]*)\]\(([^)]+\.md)\)' "$doc" 2>/dev/null \
           | sed 's/.*](\(.*\))/\1/' \
           | grep -v '^https\?://' \
           | grep -v '^#' \
           || true)
done
if [ "$FOUND_BROKEN" = false ]; then
  echo "(no broken links)"
fi
echo ""

echo "=== CURRENT DOCS METADATA ==="
for doc in "$DOCS_DIR"/*.md; do
  [ -f "$doc" ] || continue
  echo "--- DOC: $doc ---"
  head -n "$METADATA_LINES" "$doc"
  echo ""
done

echo "=== END REPORT ==="
