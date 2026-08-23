#!/usr/bin/env bash
# Run by cron — pulls latest from GitHub and restarts if changed
set -e

BRANCH="claude/modern-pc-app-conversion-pgpyy2"
DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$DIR"
git fetch origin "$BRANCH" --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/"$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0  # nothing to do
fi

echo "[$(date)] Updating HTM Game Clock: $LOCAL → $REMOTE"
git pull origin "$BRANCH"

echo "[$(date)] Installing npm dependencies..."
npm install --omit=dev

if pm2 list | grep -q htm-game-clock; then
  pm2 restart htm-game-clock
else
  pm2 start server.js --name htm-game-clock
  pm2 save
fi

echo "[$(date)] Done."
