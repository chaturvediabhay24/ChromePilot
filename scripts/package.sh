#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
node scripts/verify.cjs
mkdir -p dist
version=$(node -p "require('./manifest.json').version")
archive="dist/chromepilot-$version-review-$(date +%Y%m%d%H%M%S).zip"
zip -q -r "$archive" manifest.json service-worker.js content-script.js system-prompt.md privacy.html sidepanel lib icons agents skills -x '*/.DS_Store'
unzip -t "$archive"
printf 'Review package: %s\n' "$archive"
