#!/bin/bash
# Downloads the Vosk speech models the app bundles.
#
#   ./scripts/fetch-assets.sh
#
# They are 78 MB of binary and are deliberately NOT in git: once a large file is
# committed it is in the history forever. They are fetched from upstream and
# checked, so a fresh clone is one command away from building.
set -euo pipefail
cd "$(dirname "$0")/.."

ASSETS=android/app/src/main/assets
mkdir -p "$ASSETS"

fetch() {
  local url=$1 out=$2
  if [ -s "$ASSETS/$out" ] && unzip -t "$ASSETS/$out" >/dev/null 2>&1; then
    echo "  ok      $out (already present)"
    return
  fi
  echo "  fetching $out ..."
  curl -L --retry 8 --retry-all-errors --retry-delay 3 -C - "$url" -o "$ASSETS/$out"
  unzip -t "$ASSETS/$out" >/dev/null || { echo "  CORRUPT $out"; exit 1; }
  echo "  ok      $out"
}

fetch https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip vosk-model-en-in.zip
fetch https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip   vosk-model-hi.zip

echo
echo "Done. libvosk.so is committed (see android/vosk/PROVENANCE.txt); rebuild it"
echo "with android/vosk/build-libvosk-arm64.sh only if you need to."
