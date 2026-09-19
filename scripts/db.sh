#!/bin/bash
# Pulls the app's SQLite database off the phone and inspects it.
#
#   ./scripts/db.sh              tables and row counts
#   ./scripts/db.sh users        dump one table
#   ./scripts/db.sh sql "SELECT ..."   run any query
#   ./scripts/db.sh open         open an interactive sqlite3 shell
#
# Requires the DEBUG build to be installed: Android only allows run-as on a
# debuggable package, which is the whole reason the release build is opaque.
set -euo pipefail

PKG=com.indidino.vocalock
ADB="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb"
REMOTE="/data/data/$PKG/databases/vocalockSQLite.db"
LOCAL="${TMPDIR:-/tmp}/vocalock-$(date +%s).db"

if ! "$ADB" shell "run-as $PKG true" >/dev/null 2>&1; then
  echo "Cannot read the database: the installed build is not debuggable."
  echo "Install the debug build first:"
  echo "    cd android && ./gradlew assembleDebug"
  echo "    adb install -r app/build/outputs/apk/debug/app-debug.apk"
  exit 1
fi

# -wal and -shm hold writes that have not been checkpointed into the main file
# yet; copying only the .db would silently show stale data.
for suffix in "" "-wal" "-shm"; do
  "$ADB" shell "run-as $PKG cat $REMOTE$suffix" > "$LOCAL$suffix" 2>/dev/null || true
done
[ -s "$LOCAL" ] || { echo "No database on the device yet — open the app and sign in once."; exit 1; }

case "${1:-summary}" in
  open) exec sqlite3 "$LOCAL" ;;
  sql)  sqlite3 -header -column "$LOCAL" "$2" ;;
  summary)
    echo "pulled: $LOCAL"
    echo
    for t in users subscriptions payments; do
      count=$(sqlite3 "$LOCAL" "SELECT count(*) FROM $t;" 2>/dev/null || echo "-")
      printf "  %-15s %s rows\n" "$t" "$count"
    done
    echo
    echo "schema version: $(sqlite3 "$LOCAL" 'PRAGMA user_version;')"
    ;;
  *) sqlite3 -header -column "$LOCAL" "SELECT * FROM $1;" ;;
esac
