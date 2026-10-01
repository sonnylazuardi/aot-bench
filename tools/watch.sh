#!/usr/bin/env bash
# Integrator regression watch: every ~15 min run tools/health.mjs (every 3rd run --full); when it passes and HEAD
# moved since the last publish, publish HEAD to the stable preview (:4173). Appends to $1 (log file).
LOG=${1:-/tmp/claude-1000/aot-watch.log}
cd "$(dirname "$0")/.." || exit 1
i=0
while true; do
  if [ $((i % 3)) -eq 2 ]; then out=$(bun tools/health.mjs --full 2>&1); else out=$(bun tools/health.mjs 2>&1); fi
  rc=$?
  echo "$out" >> "$LOG"
  # health passed and builders left uncommitted work: snapshot-commit it (local only, never pushed)
  if [ $rc -eq 0 ] && [ -n "$(git status --porcelain)" ]; then
    areas=$(git status --porcelain | awk '{print $2}' | awk -F/ '{print ($1=="src" ? $2 : $1)}' | sort -u | tr '\n' ' ')
    git add -A && git commit -q -m "Auto-snapshot (health OK): ${areas}

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UZKmJ5SUz5eyijfriKn4fN" >> "$LOG" 2>&1
  fi
  head=$(git rev-parse --short HEAD)
  pub=$(cat dist/SNAPSHOT.txt 2>/dev/null | head -1)
  if [ $rc -eq 0 ] && [ "$head" != "$pub" ]; then
    # only publish a commit whose tree matches what was just checked (working tree may be ahead; that's fine)
    bun tools/publish.mjs >> "$LOG" 2>&1 && echo "[watch $(date +%H:%M)] PUBLISHED $head: $(git log -1 --format=%s | cut -c1-160)" >> "$LOG"
  elif [ $rc -ne 0 ]; then
    echo "[watch $(date +%H:%M)] HEALTH FAILED — not publishing $head" >> "$LOG"
  fi
  echo "--- cycle $i $(date +%H:%M)" >> "$LOG"
  i=$((i+1))
  sleep 600
done
