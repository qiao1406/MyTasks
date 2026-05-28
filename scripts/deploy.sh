#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

# TaskFlow one-click deploy script (Ubuntu/Debian)
# Usage example:
#   REPO_URL='git@github.com:you/your-repo.git' DOMAIN='task.example.com' EMAIL='you@example.com' ./deploy.sh

APP_NAME="mytask"
APP_PORT="${APP_PORT:-8787}"
APP_DIR="${APP_DIR:-/opt/mytask}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-feat-user-management}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
ENABLE_HTTPS="${ENABLE_HTTPS:-true}"

if [[ -z "$REPO_URL" ]]; then
  echo "[ERROR] REPO_URL is required."
  echo "Example: REPO_URL='git@github.com:you/repo.git' DOMAIN='task.example.com' EMAIL='you@example.com' ./deploy.sh"
  exit 1
fi

if [[ -z "$DOMAIN" ]]; then
  echo "[ERROR] DOMAIN is required."
  echo "Example: DOMAIN='task.example.com'"
  exit 1
fi

if [[ "$ENABLE_HTTPS" == "true" && -z "$EMAIL" ]]; then
  echo "[ERROR] EMAIL is required when ENABLE_HTTPS=true"
  exit 1
fi

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
fi

echo "[1/10] Installing base packages..."
$SUDO apt update -y
$SUDO apt install -y curl git nginx ufw

echo "[2/10] Installing Node.js 22.x..."
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v(22|23|24|25|26)\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt install -y nodejs
fi
node -v
npm -v

echo "[3/10] Installing PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
  $SUDO npm install -g pm2
fi

echo "[4/10] Pulling code..."
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --all
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  $SUDO mkdir -p "$(dirname "$APP_DIR")"
  $SUDO git clone "$REPO_URL" "$APP_DIR"
  $SUDO chown -R "$USER":"$USER" "$APP_DIR"
  git -C "$APP_DIR" checkout "$BRANCH"
fi

echo "[5/10] Ensuring data directory permissions..."
mkdir -p "$APP_DIR/data"

echo "[6/10] Starting app with PM2..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start "$APP_DIR/server.mjs" --name "$APP_NAME" --update-env --time
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | bash || true

echo "[7/10] Configuring Nginx reverse proxy..."
NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
$SUDO bash -c "cat > $NGINX_CONF" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

$SUDO ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$APP_NAME"
$SUDO rm -f /etc/nginx/sites-enabled/default
$SUDO nginx -t
$SUDO systemctl reload nginx

echo "[8/10] Configuring firewall..."
$SUDO ufw allow OpenSSH || true
$SUDO ufw allow 'Nginx Full' || true
$SUDO ufw --force enable || true

echo "[9/10] Enabling HTTPS (Let's Encrypt)..."
if [[ "$ENABLE_HTTPS" == "true" ]]; then
  $SUDO apt install -y certbot python3-certbot-nginx
  $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
fi

echo "[10/10] Installing daily SQLite backup cron..."
BACKUP_SCRIPT="/usr/local/bin/${APP_NAME}_backup.sh"
$SUDO bash -c "cat > $BACKUP_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail
SRC=\"$APP_DIR/data/taskflow.db\"
DST_DIR=\"$APP_DIR/data/backups\"
mkdir -p \"\$DST_DIR\"
cp \"\$SRC\" \"\$DST_DIR/taskflow-\$(date +%F-%H%M%S).db\"
find \"\$DST_DIR\" -type f -name 'taskflow-*.db' -mtime +14 -delete
EOF
$SUDO chmod +x "$BACKUP_SCRIPT"
( crontab -l 2>/dev/null | grep -v "$BACKUP_SCRIPT"; echo "0 3 * * * $BACKUP_SCRIPT" ) | crontab -

echo
echo "Deployment completed."
echo "URL: https://$DOMAIN"
echo "PM2 status: pm2 status"
echo "Logs: pm2 logs $APP_NAME"
