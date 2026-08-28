# HTM Game Clock (HTM-Control-Basic)

Escape-room game timer and operator control system. Runs headless on a Raspberry Pi as a web app, and is also packaged as an Electron desktop app. Remote repo: `github.com/hourtomidnight/HTM-Control-Basic`. **Stays its own repo** — not merged into the `htm-escape-tracker` intranet monorepo (different deployment topology; see below).

> This local copy (`…\HTM\GameControl\HTM-Control-Basic`) is **not a git checkout**. The canonical repo is on GitHub; another local clone exists at `C:\Users\mytho\Documents\HTM-Control-Basic\`. Confirm which tree is authoritative before committing.

## Deployment direction

- **Today:** a single staging instance runs on the shared HTM intranet Pi (alongside `tracker`/`roomreset`), purely to build the app out. This is scaffolding, not the destination — don't couple its repo or deploy flow to the intranet monorepo.
- **Target:** one dedicated Pi **per room**, each driving that room's hardware over **GPIO** (Node-side: `onoff` / `pigpio` / `rpi-gpio` in the server or Electron main process — the HTML UI never touches pins, it sends commands to the Node side). Each room Pi shows the clock on an attached display via either Electron kiosk mode or headless `server.js` + `chromium --kiosk`.
- The Windows/macOS `electron-builder` targets are legacy from the desktop-app era. Once it's Pi-only, keep just the Linux/ARM target (or drop Electron for headless + kiosk browser).
- Intranet integration is edges-only: a link from `tracker/home.html` and shared Google Sheets logging — no shared code.

## Two runtimes, one codebase

- **Pi / web** — `server.js`, Node.js **built-ins only, no npm for the server**. Port `4000`. Serves the static HTML/JS clients, an SSE event relay, and server-side config storage (`config.json`). Installed via `setup-pi.sh` as systemd service `htm-game-clock` (install branch pinned in that script: `claude/modern-pc-app-conversion-pgpyy2`). `nginx-htm.conf` fronts it.
- **Desktop** — Electron (`main.js`), `npm start` = `electron .`, `npm run build` = electron-builder (NSIS / dmg / AppImage). `googleapis` is the only runtime dependency.

## Pieces

- `session-tracker.js` — session state machine: `createSession`, `applyAdjustment`, `applyHint`, `updateField`, `finalizeSession`. A `gameLocked` flag blocks starting a new session until reset. Time adjustments are `add-min` / `sub-min` / `add-sec` / `sub-sec`.
- `sheets.js` — Google Sheets logging via `googleapis`, credentials at `google-credentials.json` (**not committed**). Logs sessions and hints to spreadsheet/tab IDs from `config.json`. If credentials are missing it logs a warning and **degrades gracefully** — Sheets logging just disabled, game clock still runs.
- Clients: `game.html` / `game.js` (player-facing clock), `operator.html` / `operator.js` (operator console), `config.html` (settings UI), `home-page-card.html`. `channel.js` is the SSE channel helper.
- `update.sh` — pull latest on the Pi.

## Notes

- Sheets writes are wrapped in try/catch and must never break gameplay — keep that pattern for any new external call in `server.js`.
- `config.json` and `google-credentials.json` are runtime/secret files, not committed.
- Tests: `npm test` = `node --test`.
