const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG = {
  timerMinutes: 60,
  volume: 0.4,
  logoPath: '',
  clues: Array(19).fill(''),
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

ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });
ipcMain.handle('config-path', () => CONFIG_PATH);

let mainWin, configWin;

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1920,
    height: 1080,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: 'HTM Game Clock',
  });
  mainWin.loadFile('index.html');
  mainWin.setMenuBarVisibility(false);

  mainWin.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      mainWin.setFullScreen(!mainWin.isFullScreen());
    }
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWin.webContents.openDevTools();
    }
  });
}

function createConfigWindow() {
  if (configWin && !configWin.isDestroyed()) {
    configWin.focus();
    return;
  }
  configWin = new BrowserWindow({
    width: 900,
    height: 820,
    title: 'HTM Game Clock — Configuration',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  configWin.loadFile('config.html');
  configWin.setMenuBarVisibility(false);

  configWin.on('closed', () => {
    // Reload config in main window when config closes
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('config-updated');
    }
  });
}

ipcMain.on('open-config', () => createConfigWindow());

app.whenReady().then(() => {
  createMainWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
