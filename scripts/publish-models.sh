#!/usr/bin/env bash
# Puts the speech models on the droplet, where the app downloads them from.
#
#   scripts/fetch-assets.sh && scripts/publish-models.sh
#
# nginx already serves /opt/vocalock/site (with byte ranges, which the app uses
# to resume), so this is files only: no restart. The models are Apache 2.0;
# their licence travels with them.
set -euo pipefail

HOST=root@143.110.190.26
SSH="ssh -i $HOME/.ssh/vocalock_deploy -o BatchMode=yes"
cd "$(dirname "$0")/.."

$SSH "$HOST" 'mkdir -p /opt/vocalock/site/models'
rsync -az --partial -e "$SSH" models/vosk-model-small-*.zip "$HOST:/opt/vocalock/site/models/"
$SSH "$HOST" 'chmod -R o+rX /opt/vocalock/site/models'

for f in models/vosk-model-small-*.zip; do
  name=$(basename "$f")
  want=$(shasum -a 256 "$f" | cut -d' ' -f1)
  got=$(curl -fsS "https://vocalock.indidino.com/models/$name" | shasum -a 256 | cut -d' ' -f1)
  [ "$want" = "$got" ] || { echo "  MISMATCH $name"; exit 1; }
  echo "  ok      https://vocalock.indidino.com/models/$name"
done
