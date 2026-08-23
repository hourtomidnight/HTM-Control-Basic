#!/usr/bin/env bash
# HTM Game Clock — Raspberry Pi setup script
# Run once: bash setup-pi.sh
set -e

BRANCH="claude/modern-pc-app-conversion-pgpyy2"
REPO="https://github.com/hourtomidnight/HTM-Control-Basic"
INSTALL_DIR="$HOME/HTM-Control-Basic"
SERVICE_NAME="htm-game-clock"

echo ""
echo "=================================================="
echo "  HTM Game Clock — Pi Setup"
echo "=================================================="
echo ""

# ── Node.js check ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[!] Node.js not found. Installing via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "  Node.js  $(node -v)   OK"

# ── Git check ─────────────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo "[!] Git not found. Installing..."
  sudo apt-get install -y git
fi
echo "  Git      $(git --version | awk '{print $3}')   OK"

# ── Clone or update repo ──────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo ""
  echo "  Updating existing installation..."
  cd "$INSTALL_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  echo ""
  echo "  Cloning repository..."
  git clone --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

echo ""
echo "  Repository up to date."

# ── Assets reminder ───────────────────────────────────────────────────────────
echo ""
echo "  Audio assets needed in: $INSTALL_DIR/assets/"
echo "    TimerMusic.mp3   FinaleMusic.mp3   ClueSound.mp3"
echo "  (App runs without them — audio commands are silent)"

# ── Systemd service (optional) ────────────────────────────────────────────────
echo ""
read -r -p "  Install as a systemd service (auto-start on boot)? [y/N] " INSTALL_SERVICE
if [[ "$INSTALL_SERVICE" =~ ^[Yy]$ ]]; then
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=HTM Game Clock
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) $INSTALL_DIR/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"
  echo ""
  echo "  Service installed and started."
  echo "  Manage with:"
  echo "    sudo systemctl start   $SERVICE_NAME"
  echo "    sudo systemctl stop    $SERVICE_NAME"
  echo "    sudo systemctl restart $SERVICE_NAME"
  echo "    sudo journalctl -u     $SERVICE_NAME -f"
else
  echo ""
  echo "  Skipped service install. Start manually with:"
  echo "    cd $INSTALL_DIR && node server.js"
fi

# ── nginx integration ─────────────────────────────────────────────────────────
echo ""
SNIPPET_DEST="/etc/nginx/snippets/htm-game-clock.conf"
read -r -p "  Add /room-control to nginx (integrates with your existing site)? [Y/n] " INSTALL_NGINX
if [[ ! "$INSTALL_NGINX" =~ ^[Nn]$ ]]; then
  if ! command -v nginx &>/dev/null; then
    echo "  Installing nginx..."
    sudo apt-get install -y nginx
  fi

  sudo mkdir -p /etc/nginx/snippets
  sudo cp "$INSTALL_DIR/nginx-htm.conf" "$SNIPPET_DEST"
  echo "  Snippet installed to $SNIPPET_DEST"
  echo ""

  # Find the active nginx server block file
  NGINX_SITE=""
  for f in /etc/nginx/sites-enabled/*; do
    if sudo grep -q "listen 80" "$f" 2>/dev/null; then
      NGINX_SITE="$f"
      break
    fi
  done

  if [ -n "$NGINX_SITE" ]; then
    # Check if already included
    if sudo grep -q "htm-game-clock" "$NGINX_SITE"; then
      echo "  Snippet already included in $NGINX_SITE"
    else
      # Insert include before the closing brace of the first server block
      sudo sed -i '/^}/{ /^}/!b; s|^}|    include /etc/nginx/snippets/htm-game-clock.conf;\n}|; :a; n; ba }' "$NGINX_SITE" 2>/dev/null || true
      # Fallback: tell them to add it manually
      if ! sudo grep -q "htm-game-clock" "$NGINX_SITE"; then
        echo "  [!] Could not auto-insert — add this line inside your server {} block in:"
        echo "      $NGINX_SITE"
        echo ""
        echo "      include /etc/nginx/snippets/htm-game-clock.conf;"
        echo ""
      else
        echo "  Added include to $NGINX_SITE"
      fi
    fi
  else
    echo "  No existing nginx site found on port 80."
    echo "  Add this line inside your server {} block:"
    echo ""
    echo "      include $SNIPPET_DEST;"
    echo ""
  fi

  sudo nginx -t && sudo systemctl reload nginx
  echo "  nginx reloaded."
else
  echo ""
  echo "  Skipped nginx. App accessible on port 4000 only."
fi

# ── Print access URLs ─────────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I | awk '{print $1}')
HNAME=$(hostname)
echo ""
echo "=================================================="
echo "  Setup complete!"
echo ""
if [[ ! "$INSTALL_NGINX" =~ ^[Nn]$ ]]; then
echo "  Room Control sub-page:"
echo "    http://${HNAME}.local/room-control/"
echo "    http://${LOCAL_IP}/room-control/"
echo ""
echo "  Add the card snippet to your home page:"
echo "    cat $INSTALL_DIR/home-page-card.html"
else
echo "  Access from any device on your network:"
echo "    http://${HNAME}.local:4000/"
echo "    http://${LOCAL_IP}:4000/"
fi
echo ""
echo "  Game screen opens automatically from the operator."
echo "=================================================="
echo ""
