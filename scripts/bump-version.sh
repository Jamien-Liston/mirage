#!/bin/sh
# Bump MIRAGE_VERSION in js/version.js — the single source of truth for both
# the version shown in the UI and the service-worker cache name. Run from
# anywhere:
#   sh scripts/bump-version.sh            # patch: 0.1.0 -> 0.1.1
#   sh scripts/bump-version.sh minor      # 0.1.0 -> 0.2.0
#   sh scripts/bump-version.sh major      # 0.1.0 -> 1.0.0
#   sh scripts/bump-version.sh 1.2.3      # set explicitly
#
# The service worker serves the app shell cache-first, so this must be bumped
# on any change to index.html, css/, or js/*.js or installed clients keep the
# old files.

set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
file="$script_dir/../js/version.js"
part=${1:-patch}

if [ ! -f "$file" ]; then
  echo "error: js/version.js not found at $file" >&2
  exit 1
fi

current=$(sed -n "s/.*MIRAGE_VERSION *= *'\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)'.*/\1/p" "$file" | head -n1)

if [ -z "$current" ]; then
  echo "error: could not find a semver MIRAGE_VERSION in $file" >&2
  exit 1
fi

major=${current%%.*}
rest=${current#*.}
minor=${rest%%.*}
patch=${rest#*.}

case "$part" in
  major) next="$((major + 1)).0.0" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  patch) next="$major.$minor.$((patch + 1))" ;;
  [0-9]*.[0-9]*.[0-9]*) next="$part" ;;
  *)
    echo "error: expected major, minor, patch, or an explicit x.y.z — got '$part'" >&2
    exit 1
    ;;
esac

tmp=$(mktemp)
sed "s/MIRAGE_VERSION = '$current'/MIRAGE_VERSION = '$next'/" "$file" > "$tmp"
mv "$tmp" "$file"

echo "Bumped version: $current -> $next (UI label and cache name both follow)"
