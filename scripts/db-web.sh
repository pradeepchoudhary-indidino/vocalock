#!/bin/bash
# Pulls the app's SQLite database off the phone and serves it in your browser.
#
#   ./scripts/db-web.sh
#
# Everything runs on localhost — the database holds a real phone number, so it
# is never uploaded to an online "sqlite viewer". Ctrl-C to stop.
#
# Needs the DEBUG build installed: Android only permits run-as on a debuggable
# package.
set -euo pipefail

cd "$(dirname "$0")/.."
PKG=com.indidino.vocalock
ADB="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb"
REMOTE="/data/data/$PKG/databases/vocalockSQLite.db"
WORK=".venv-tools/pulled"
PORT="${PORT:-8001}"

mkdir -p "$WORK"

if ! "$ADB" shell "run-as $PKG true" >/dev/null 2>&1; then
  echo "The installed build is not debuggable, so its data cannot be read."
  echo "  cd android && ./gradlew assembleDebug"
  echo "  adb install -r app/build/outputs/apk/debug/app-debug.apk"
  exit 1
fi

# -wal holds writes not yet checkpointed into the main file. Copy only the .db
# and you will be looking at stale rows and wondering why your last login is
# missing.
for suffix in "" "-wal" "-shm"; do
  "$ADB" shell "run-as $PKG cat $REMOTE$suffix" > "$WORK/vocalock.db$suffix" 2>/dev/null || true
done
[ -s "$WORK/vocalock.db" ] || { echo "No database yet — open the app and sign in once."; exit 1; }

echo "Opening http://127.0.0.1:$PORT — Ctrl-C to stop"
echo "(a snapshot: re-run this after using the app to see new rows)"
sleep 1 && open "http://127.0.0.1:$PORT" &

# Read-only: this is a viewer, not a way to accidentally edit real data.
exec ./.venv-tools/bin/datasette serve "$WORK/vocalock.db" \
  --port "$PORT" \
  --setting sql_time_limit_ms 5000 \
  --setting default_page_size 50 \
  --immutable "$WORK/vocalock.db"
