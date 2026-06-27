const channel = new BroadcastChannel('htm-game-clock');

// ── DOM ───────────────────────────────────────────────────────────────────────
const bigTimer    = document.getElementById('big-timer');
const statusBadge = document.getElementById('status-badge');
const volDisplay  = document.getElementById('vol-display');
const clueCountEl = document.getElementById('clue-count-display');
const hintsList   = document.getElementById('hints-list');
const pauseBtn    = document.getElementById('btn-pause');

const CLUE_KEYS = [
  'Numpad 1','Numpad 2','Numpad 3','Numpad 4','Numpad 5',
  'Numpad 6','Numpad 7','Numpad 8','Numpad 9',
  'Row 1','Row 2','Row 3','Row 4','Row 5',
  'Row 6','Row 7','Row 8','Row 9','Row 0',
];

function cmd(type, extra) {
  channel.postMessage(Object.assign({ type }, extra));
}

// ── Buttons ───────────────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click',   () => cmd('start'));
pauseBtn.addEventListener('click', () => {
  cmd(currentState.timerHasStopped ? 'resume' : 'pause');
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
document.getElementById('btn-cfg').addEventListener('click',     () => {
  window.open('/config.html', 'config', 'width=940,height=880');
});

// ── State ─────────────────────────────────────────────────────────────────────
let currentState = { currentMin:60, currentSec:0, clockForward:false,
  timerHasStopped:true, onSplash:true, clueCount:0, volume:0.4 };

function pad(n) { return n < 10 ? '0' + n : '' + n; }

channel.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || data.type !== 'state') return;
  currentState = data;

  const timeStr = pad(data.currentMin) + ':' + pad(data.currentSec);
  bigTimer.textContent = (data.clockForward ? '− ' : '') + timeStr;
  bigTimer.className = '';
  if (data.clockForward)            bigTimer.classList.add('negative');
  else if (!data.timerHasStopped)   bigTimer.classList.add('running');
  else                              bigTimer.classList.add('paused');

  let st = 'WAITING';
  if (!data.onSplash && !data.timerHasStopped) st = 'RUNNING';
  else if (!data.onSplash && data.timerHasStopped) st = 'PAUSED';
  statusBadge.textContent = st;

  pauseBtn.textContent = data.timerHasStopped ? '▶ Resume' : '⏸ Pause';
  volDisplay.textContent = Math.round((data.volume || 0) * 100) + '%';
  clueCountEl.textContent = data.clueCount || 0;
});

// ── Hints ─────────────────────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(localStorage.getItem('htm-config')) || {}; } catch(e) { return {}; }
}

function buildHints() {
  const cfg = loadConfig();
  const clues = cfg.clues || Array(19).fill('');
  hintsList.innerHTML = '';
  clues.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.className = 'hint-btn' + (text ? '' : ' empty');
    btn.innerHTML =
      '<span class="hint-key">' + CLUE_KEYS[i] + '</span>' +
      '<span class="hint-text' + (text ? '' : ' placeholder') + '">' +
        (text || '(no clue set)') + '</span>';
    if (text) btn.addEventListener('click', () => cmd('show-clue', { index: i }));
    hintsList.appendChild(btn);
  });
}

// Rebuild hints when config window posts a message
window.addEventListener('storage', (e) => {
  if (e.key === 'htm-config') { buildHints(); cmd('config-updated'); }
});

buildHints();

// Ask game window for current state on load
setTimeout(() => cmd('request-state'), 500);
