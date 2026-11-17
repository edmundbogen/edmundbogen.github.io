#!/bin/bash
# Publish a new version of Switch Guide.
#   ./bump-version.sh 1.0.1
# Updates the version in js/config.js and sw.js (they must match). Then commit and push;
# agents' phones see "Update available" the next time they open the app online.
set -e
cd "$(dirname "$0")"
NEW="$1"
if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: ./bump-version.sh 1.0.1   (current: $(grep -o "APP_VERSION = '[^']*'" js/config.js | cut -d"'" -f2))"
  exit 1
fi
sed -i '' -E "s/APP_VERSION = '[^']*'/APP_VERSION = '$NEW'/" js/config.js
sed -i '' -E "s/^const VERSION = '[^']*'/const VERSION = '$NEW'/" sw.js
grep -n "APP_VERSION = " js/config.js
grep -n "^const VERSION" sw.js
echo "Now commit and push. If you added a new file to the app, also add it to FILES in sw.js."
