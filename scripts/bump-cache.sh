#!/bin/sh
# Bump the service-worker cache version: finds the current mirage-vN in
# service-worker.js and increments N by one. Run from anywhere:
#   sh scripts/bump-cache.sh
#
# The service worker serves the app shell cache-first, so this must be bumped
# on any change to index.html, css/, or js/*.js or installed clients keep the
# old files.

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sw="$script_dir/../service-worker.js"

if [ ! -f "$sw" ]; then
  echo "error: service-worker.js not found at $sw" >&2
  exit 1
fi

current=$(sed -n "s/.*mirage-v\([0-9][0-9]*\).*/\1/p" "$sw" | head -n1)

if [ -z "$current" ]; then
  echo "error: could not find mirage-vN in $sw" >&2
  exit 1
fi

next=$((current + 1))

tmp=$(mktemp)
sed "s/mirage-v$current/mirage-v$next/" "$sw" > "$tmp"
mv "$tmp" "$sw"

echo "Bumped cache: mirage-v$current -> mirage-v$next"
