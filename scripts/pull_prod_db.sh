#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

# Pull production SQLite database from server to local for dev/test.
#
# Example:
#   REMOTE_HOST=14.103.37.105 REMOTE_USER=ubuntu ./scripts/pull_prod_db.sh
#
# Optional env:
#   REMOTE_DB_PATH=/opt/mytask/data/taskflow.db
#   LOCAL_DB_PATH=/Users/wentao/Desktop/MyTasks/data/taskflow.db
#   SSH_PORT=22
#   SSH_KEY=~/.ssh/id_rsa

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

REMOTE_HOST="${REMOTE_HOST:-}"
REMOTE_USER="${REMOTE_USER:-ubuntu}"
REMOTE_DB_PATH="${REMOTE_DB_PATH:-/opt/mytask/data/taskflow.db}"
LOCAL_DB_PATH="${LOCAL_DB_PATH:-$ROOT_DIR/data/taskflow.db}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-}"

if [[ -z "$REMOTE_HOST" ]]; then
  echo "[ERROR] REMOTE_HOST is required."
  echo "Example: REMOTE_HOST=14.103.37.105 REMOTE_USER=ubuntu ./scripts/pull_prod_db.sh"
  exit 1
fi

SSH_OPTS=("-p" "$SSH_PORT" "-o" "StrictHostKeyChecking=accept-new")
SCP_OPTS=("-P" "$SSH_PORT" "-o" "StrictHostKeyChecking=accept-new")
if [[ -n "$SSH_KEY" ]]; then
  SSH_OPTS+=("-i" "$SSH_KEY")
  SCP_OPTS+=("-i" "$SSH_KEY")
fi

REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
TS="$(date +%F-%H%M%S)"
REMOTE_TMP="/tmp/taskflow-prod-${TS}.db"
LOCAL_DIR="$(dirname "$LOCAL_DB_PATH")"
LOCAL_BAK_DIR="$LOCAL_DIR/backups"

mkdir -p "$LOCAL_DIR" "$LOCAL_BAK_DIR"

if [[ -f "$LOCAL_DB_PATH" ]]; then
  cp "$LOCAL_DB_PATH" "$LOCAL_BAK_DIR/taskflow-local-before-sync-${TS}.db"
  echo "[INFO] Local backup created: $LOCAL_BAK_DIR/taskflow-local-before-sync-${TS}.db"
fi

echo "[1/4] Creating consistent backup on remote..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "sqlite3 '$REMOTE_DB_PATH' '.backup $REMOTE_TMP'"

echo "[2/4] Pulling remote backup to local..."
scp "${SCP_OPTS[@]}" "$REMOTE:$REMOTE_TMP" "$LOCAL_DB_PATH"

echo "[3/4] Cleaning temporary remote backup..."
ssh "${SSH_OPTS[@]}" "$REMOTE" "rm -f '$REMOTE_TMP'"

echo "[4/4] Verifying pulled database..."
sqlite3 "$LOCAL_DB_PATH" "PRAGMA integrity_check;" | grep -q '^ok$'

echo "Done. Local DB updated: $LOCAL_DB_PATH"
