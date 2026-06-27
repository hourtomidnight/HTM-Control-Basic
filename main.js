const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG = {
  timerMinutes: 60,
  volume: 0.4,
  logoPath: '',
  clues: Array(19).fill(''),
  gameDisplay: 1,     // 1-based index of the display for the game screen
  operatorDisplay: 0, // 0 = primary
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return Object.assign({}, DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    }
  } catch (e) {}
  return Object.assign({}, DEFAULT_CONFIG);
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ── Windows ───────────────────────────────────────────────────────────────────
let gameWin, operatorWin, configWin;

function getDisplayBounds(index) {
  const displays = screen.getAllDisplays();
  const d = displays[index] || displays[0];
  return d.bounds;
}

function createGameWindow(cfg) {
  const bounds = getDisplayBounds(cfg.gameDisplay ?? 1);
  gameWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width || 1920,
    height: bounds.height || 1080,
    fullscreen: true,
    backgroundColor: '#000000',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    title: 'HTM Game Clock',
    frame: false,
  });
  gameWin.loadFile('game.html');
  gameWin.setMenuBarVisibility(false);

  gameWin.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'F11' && input.type === 'keyDown')
      gameWin.setFullScreen(!gameWin.isFullScreen());
    if (input.key === 'F12' && input.type === 'keyDown')
      gameWin.webContents.openDevTools();
  });
}

function createOperatorWindow(cfg) {
  const bounds = getDisplayBounds(cfg.operatorDisplay ?? 0);
  operatorWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: 860,
    height: 900,
    backgroundColor: '#0d0d1a',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    title: 'HTM — Operator',
    alwaysOnTop: false,
  });
  operatorWin.loadFile('operator.html');
  operatorWin.setMenuBarVisibility(false);
}

// ── IPC: config ───────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });

// ── IPC: commands from operator → game ───────────────────────────────────────
ipcMain.on('game-command', (_, cmd) => {
  if (gameWin && !gameWin.isDestroyed()) {
    gameWin.webContents.send('game-command', cmd);
  }
});

// ── IPC: state from game → operator ──────────────────────────────────────────
ipcMain.on('game-state', (_, state) => {
  if (operatorWin && !operatorWin.isDestroyed()) {
    operatorWin.webContents.send('game-state', state);
  }
});

// ── IPC: open config window ───────────────────────────────────────────────────
ipcMain.on('open-config', () => {
  if (configWin && !configWin.isDestroyed()) { configWin.focus(); return; }
  configWin = new BrowserWindow({
    width: 920, height: 860,
    title: 'HTM Game Clock — Configuration',
    backgroundColor: '#1a1a2e',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  configWin.loadFile('config.html');
  configWin.setMenuBarVisibility(false);
  configWin.on('closed', () => {
    const updated = loadConfig();
    if (gameWin && !gameWin.isDestroyed())
      gameWin.webContents.send('config-updated');
    if (operatorWin && !operatorWin.isDestroyed())
      operatorWin.webContents.send('config-updated');
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  const cfg = loadConfig();
  createGameWindow(cfg);
  createOperatorWindow(cfg);
});

app.on('window-all-closed', () => app.quit());
