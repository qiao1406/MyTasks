#!/usr/bin/env bash
set -euo pipefail

# TaskFlow deploy script (NO domain, public IP over HTTP)
# Usage example:
#   REPO_URL='git@github.com:you/your-repo.git' BRANCH='feat-user-management' ./deploy_no_domain.sh

APP_NAME="mytask"
APP_PORT="${APP_PORT:-8787}"
APP_DIR="${APP_DIR:-/opt/mytask}"
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-feat-user-management}"

if [[ -z "$REPO_URL" ]]; then
  echo "[ERROR] REPO_URL is required."
  echo "Example: REPO_URL='git@github.com:you/repo.git' BRANCH='feat-user-management' ./deploy_no_domain.sh"
  exit 1
fi

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  SUDO="sudo"
fi

echo "[1/9] Installing base packages..."
$SUDO apt update -y
$SUDO apt install -y curl git nginx ufw

echo "[2/9] Installing Node.js 22.x..."
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v(22|23|24|25|26)\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt install -y nodejs
fi
node -v
npm -v

echo "[3/9] Installing PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
  $SUDO npm install -g pm2
fi

echo "[4/9] Pulling code..."
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

echo "[5/9] Ensuring data directory permissions..."
mkdir -p "$APP_DIR/data"

echo "[6/9] Starting app with PM2..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start "$APP_DIR/server.mjs" --name "$APP_NAME" --update-env --time
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | bash || true

echo "[7/9] Configuring Nginx reverse proxy (public IP only)..."
NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
$SUDO bash -c "cat > $NGINX_CONF" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

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

echo "[8/9] Configuring firewall..."
$SUDO ufw allow OpenSSH || true
$SUDO ufw allow 80/tcp || true
$SUDO ufw --force enable || true

echo "[9/9] Installing daily SQLite backup cron..."
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

PUBLIC_IP="$(curl -s --max-time 5 ifconfig.me || true)"
echo
echo "Deployment completed."
if [[ -n "$PUBLIC_IP" ]]; then
  echo "URL: http://$PUBLIC_IP"
else
  echo "URL: http://<your-server-public-ip>"
fi
echo "PM2 status: pm2 status"
echo "Logs: pm2 logs $APP_NAME"
echo "Reminder: also open port 80 in your cloud security group."
