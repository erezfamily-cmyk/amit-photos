#!/usr/bin/env bash
# Preserve generated commits; never overwrite remote state or auto-resolve conflicts.
set -euo pipefail

for attempt in 1 2 3 4 5; do
  if git push origin HEAD:main; then
    exit 0
  fi
  if [ "$attempt" -eq 5 ]; then
    echo '::error::Could not persist generated changes after five push attempts.' >&2
    exit 1
  fi
  git fetch origin main
  if ! git rebase origin/main; then
    git rebase --abort
    echo '::error::Generated data conflicts with main; refusing to overwrite it.' >&2
    exit 1
  fi
  sleep "$attempt"
done
