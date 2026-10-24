#!/bin/bash
# Downloads the Vosk speech models into models/.
#
#   ./scripts/fetch-assets.sh
#
# The app no longer bundles them: it downloads the one a user needs from
# https://vocalock.indidino.com/models/ (see VoskModels.kt). This fetches the
# upstream copies so scripts/publish-models.sh can put them on the server.
#
# They are 78 MB of binary and are deliberately NOT in git: once a large file is
# committed it is in the history forever. They are fetched from upstream and
# checked against the checksums the app verifies.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=models
mkdir -p "$OUT"

fetch() {
  local name=$1 sha=$2
  if [ -s "$OUT/$name" ] && [ "$(shasum -a 256 "$OUT/$name" | cut -d' ' -f1)" = "$sha" ]; then
    echo "  ok      $name (already present)"
    return
  fi
  echo "  fetching $name ..."
  curl -L --retry 8 --retry-all-errors --retry-delay 3 -C - \
    "https://alphacephei.com/vosk/models/$name" -o "$OUT/$name"
  [ "$(shasum -a 256 "$OUT/$name" | cut -d' ' -f1)" = "$sha" ] || { echo "  CORRUPT $name"; exit 1; }
  echo "  ok      $name"
}

# Must match MODELS in android/app/src/main/java/com/indidino/vocalock/service/VoskModels.kt.
fetch vosk-model-small-en-in-0.4.zip 20663dcac4d5cb783a579c54d98339344a688e4ec6e1b4a4b059fd1235454cc7
fetch vosk-model-small-hi-0.22.zip   7c50a10866889f0ac21d912c20537a055a597ed09fc1d3e5bcd798f9f0017e48

echo
echo "Done. libvosk.so is committed (see android/vosk/PROVENANCE.txt); rebuild it"
echo "with android/vosk/build-libvosk-arm64.sh only if you need to."
