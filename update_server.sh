#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

# Update app code on server and restart service.
# Usage:
#   BRANCH=main ./update_server.sh
# Optional env:
#   APP_DIR=/opt/mytask
#   APP_NAME=mytask
#   REMOTE=origin

APP_DIR="${APP_DIR:-/opt/mytask}"
APP_NAME="${APP_NAME:-mytask}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "[ERROR] $APP_DIR is not a git repository"
  exit 1
fi

cd "$APP_DIR"

echo "[1/6] Fetching latest code..."
git fetch --all --prune

echo "[2/6] Checking out branch: $BRANCH"
git checkout "$BRANCH"

echo "[3/6] Pulling latest commit..."
git pull --ff-only "$REMOTE" "$BRANCH"

echo "[4/6] Restarting PM2 app: $APP_NAME"
pm2 restart "$APP_NAME"
pm2 save >/dev/null

echo "[5/6] Verifying Nginx config..."
sudo nginx -t
sudo systemctl reload nginx

echo "[6/6] Health checks..."
pm2 status | sed -n '1,30p'
curl -fsS -I http://127.0.0.1:8787 | sed -n '1,5p'

echo
echo "Update complete. Branch: $BRANCH"
