const { ipcRenderer } = require('electron');

// ── DOM refs ──────────────────────────────────────────────────────────────────
const bigTimer    = document.getElementById('big-timer');
const statusBadge = document.getElementById('status-badge');
const volDisplay  = document.getElementById('vol-display');
const clueCountEl = document.getElementById('clue-count-display');
const hintsList   = document.getElementById('hints-list');

// ── Key labels for each clue slot ─────────────────────────────────────────────
const CLUE_KEYS = [
  'Numpad 1','Numpad 2','Numpad 3','Numpad 4','Numpad 5',
  'Numpad 6','Numpad 7','Numpad 8','Numpad 9',
  'Row 1','Row 2','Row 3','Row 4','Row 5',
  'Row 6','Row 7','Row 8','Row 9','Row 0',
];

// ── Send command helper ───────────────────────────────────────────────────────
function cmd(type, extra) {
  ipcRenderer.send('game-command', Object.assign({ type }, extra));
}

// ── Wire up timer control buttons ─────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click',   () => cmd('start'));
document.getElementById('btn-pause').addEventListener('click',   () => {
  if (currentState.timerHasStopped) cmd('resume'); else cmd('pause');
});
document.getElementById('btn-escaped').addEventListener('click', () => cmd('escaped'));
document.getElementById('btn-reset').addEventListener('click',   () => cmd('reset'));
document.getElementById('add-min').addEventListener('click',     () => cmd('add-min'));
document.getElementById('sub-min').addEventListener('click',     () => cmd('sub-min'));
document.getElementById('add-sec').addEventListener('click',     () => cmd('add-sec'));
document.getElementById('sub-sec').addEventListener('click',     () => cmd('sub-sec'));
document.getElementById('vol-up').addEventListener('click',      () => cmd('vol-up'));
document.getElementById('vol-down').addEventListener('click',    () => cmd('vol-down'));
document.getElementById('btn-hide-clue').addEventListener('click', () => cmd('hide-clue'));
document.getElementById('btn-cfg').addEventListener('click',     () => ipcRenderer.send('open-config'));

// ── State mirror ──────────────────────────────────────────────────────────────
let currentState = {
  currentMin: 60, currentSec: 0,
  clockForward: false, timerHasStopped: true, onSplash: true,
  clueCount: 0, volume: 0.4,
};

function pad(n) { return n < 10 ? '0' + n : String(n); }

ipcRenderer.on('game-state', (_, state) => {
  currentState = state;

  // Timer display
  const timeStr = pad(state.currentMin) + ':' + pad(state.currentSec);
  bigTimer.textContent = (state.clockForward ? '− ' : '') + timeStr;

  bigTimer.className = '';
  if (state.clockForward)       bigTimer.classList.add('negative');
  else if (!state.timerHasStopped) bigTimer.classList.add('running');
  else                          bigTimer.classList.add('paused');

  // Status
  let statusText = 'WAITING';
  if (!state.onSplash && !state.timerHasStopped) statusText = 'RUNNING';
  else if (!state.onSplash && state.timerHasStopped) statusText = 'PAUSED';
  else if (state.onSplash && !state.timerHasStopped) statusText = 'RUNNING';
  statusBadge.textContent = statusText;

  // Pause button label
  document.getElementById('btn-pause').textContent =
    state.timerHasStopped ? '▶ Resume' : '⏸ Pause';

  // Volume
  volDisplay.textContent = Math.round((state.volume || 0) * 100) + '%';

  // Clue count
  clueCountEl.textContent = state.clueCount || 0;
});

// ── Build hint buttons from config ────────────────────────────────────────────
function buildHints(clues) {
  hintsList.innerHTML = '';
  clues.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.className = 'hint-btn' + (text ? '' : ' empty');
    btn.innerHTML =
      '<span class="hint-key">' + CLUE_KEYS[i] + '</span>' +
      '<span class="hint-text' + (text ? '' : ' placeholder') + '">' +
        (text || '(no clue set)') +
      '</span>';
    if (text) {
      btn.addEventListener('click', () => cmd('show-clue', { index: i }));
    }
    hintsList.appendChild(btn);
  });
}

// ── Load config on start ──────────────────────────────────────────────────────
async function loadConfig() {
  const cfg = await ipcRenderer.invoke('get-config');
  buildHints(cfg.clues || Array(19).fill(''));
}

ipcRenderer.on('config-updated', loadConfig);
loadConfig();
