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

# ── pm2 service (auto-start, no sudo needed, matches GitHub Actions deploy) ───
echo ""
if ! command -v pm2 &>/dev/null; then
  echo "  Installing pm2..."
  npm install -g pm2
fi

cd "$INSTALL_DIR"
if pm2 list | grep -q "$SERVICE_NAME"; then
  pm2 restart "$SERVICE_NAME"
  echo "  pm2 service restarted."
else
  pm2 start server.js --name "$SERVICE_NAME"
  pm2 save
  echo "  pm2 service started and saved."
fi

# Make pm2 survive reboots
pm2 startup | tail -1 | bash 2>/dev/null || \
  echo "  [!] Run 'pm2 startup' manually and follow its instructions to survive reboots."

echo ""
echo "  Manage with:"
echo "    pm2 status"
echo "    pm2 restart $SERVICE_NAME"
echo "    pm2 logs    $SERVICE_NAME"

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
