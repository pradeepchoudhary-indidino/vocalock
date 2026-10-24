#!/usr/bin/env bash
# Sets the paywall video, live in the app without a release.
#
#   scripts/paywall-video.sh path/to/video.mp4    upload it and switch it on
#   scripts/paywall-video.sh https://…/video.mp4  use a video hosted elsewhere
#   scripts/paywall-video.sh --off                back to the feature slides
#   scripts/paywall-video.sh --status             what the app is getting now
#
# The app asks GET /api/config each time the paywall opens (src/lib/remoteConfig.ts)
# and the server reads /opt/vocalock/config/app-config.json on every request
# (server/src/config.ts), so a change here is what the next paywall shows.
#
# Uploaded files are named by their content hash, so a new video is a new URL
# and no phone can be stuck on a cached old one. Keep them small — every
# paywall view downloads it on mobile data: H.264 MP4, under ~8 MB, 30–60 s.
set -euo pipefail

HOST=root@143.110.190.26
SSH="ssh -i $HOME/.ssh/vocalock_deploy -o BatchMode=yes"
SITE=https://vocalock.indidino.com
CONFIG=/opt/vocalock/config/app-config.json

usage() { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[ $# -eq 1 ] || usage

write_config() {
  local json=$1
  # Written to a temp file and renamed, so the server never reads half a file.
  $SSH "$HOST" "mkdir -p $(dirname $CONFIG) && cat > $CONFIG.tmp && chmod 644 $CONFIG.tmp && mv $CONFIG.tmp $CONFIG" <<<"$json"
}

status() {
  echo "  server file: $($SSH "$HOST" "cat $CONFIG 2>/dev/null || echo '(none: slides)'")"
  echo "  app gets:    $(curl -fsS "$SITE/api/config" 2>/dev/null || echo '(endpoint not deployed yet)')"
}

case "$1" in
  --status)
    status
    ;;
  --off)
    write_config '{"paywallVideoUrl": null}'
    echo "  paywall video off: the app shows the feature slides"
    status
    ;;
  https://*)
    code=$(curl -s -o /dev/null -w '%{http_code}' -I "$1")
    [ "$code" = 200 ] || { echo "  $1 answered $code; not switching to it"; exit 1; }
    write_config "{\"paywallVideoUrl\": \"$1\"}"
    echo "  paywall video on: $1"
    status
    ;;
  *)
    file=$1
    [ -f "$file" ] || { echo "  no such file: $file"; exit 1; }
    case "$file" in *.mp4|*.MP4) ;; *) echo "  use an .mp4 (H.264): it plays in every Android WebView"; exit 1 ;; esac
    size=$(stat -f %z "$file" 2>/dev/null || stat -c %s "$file")
    [ "$size" -le 15000000 ] || { echo "  $((size / 1000000)) MB is too big for a paywall on mobile data; keep it under ~8 MB"; exit 1; }
    name="paywall-$(shasum -a 256 "$file" | cut -c1-12).mp4"
    $SSH "$HOST" 'mkdir -p /opt/vocalock/site/media'
    rsync -az -e "$SSH" "$file" "$HOST:/opt/vocalock/site/media/$name"
    $SSH "$HOST" "chmod 644 /opt/vocalock/site/media/$name"
    url="$SITE/media/$name"
    code=$(curl -s -o /dev/null -w '%{http_code}' -I "$url")
    [ "$code" = 200 ] || { echo "  uploaded but $url answers $code; not switching to it"; exit 1; }
    write_config "{\"paywallVideoUrl\": \"$url\"}"
    echo "  paywall video on: $url ($((size / 1000)) KB)"
    status
    ;;
esac
