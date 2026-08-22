// channel is defined by channel.js (SSE + HTTP POST, works cross-device)

// ── DOM ───────────────────────────────────────────────────────────────────────
const bigTimer    = document.getElementById('big-timer');
const statusBadge = document.getElementById('status-badge');
const volDisplay  = document.getElementById('vol-display');
const clueCountEl = document.getElementById('clue-count-display');
const hintsList   = document.getElementById('hints-list');
const pauseBtn    = document.getElementById('btn-pause');

function cmd(type, extra) {
  channel.postMessage(Object.assign({ type }, extra));
}

// ── Timer buttons ─────────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click',     () => cmd('start'));
pauseBtn.addEventListener('click', () => cmd(currentState.timerHasStopped ? 'resume' : 'pause'));
document.getElementById('btn-escaped').addEventListener('click',   () => cmd('escaped'));
document.getElementById('btn-reset').addEventListener('click',     () => cmd('reset'));
document.getElementById('add-min').addEventListener('click',       () => cmd('add-min'));
document.getElementById('sub-min').addEventListener('click',       () => cmd('sub-min'));
document.getElementById('add-sec').addEventListener('click',       () => cmd('add-sec'));
document.getElementById('sub-sec').addEventListener('click',       () => cmd('sub-sec'));
document.getElementById('vol-up').addEventListener('click',        () => cmd('vol-up'));
document.getElementById('vol-down').addEventListener('click',      () => cmd('vol-down'));
document.getElementById('btn-hide-clue').addEventListener('click', () => cmd('hide-clue'));
document.getElementById('btn-cfg').addEventListener('click', () => {
  window.open('/config.html', 'config', 'width=960,height=900,resizable=yes');
});

// ── Multi-monitor / game window management ────────────────────────────────────
let screenDetails = null;
let gameWin = null;

function loadConfig() {
  try { return JSON.parse(sessionStorage.getItem('htm-config') || localStorage.getItem('htm-config')) || {}; } catch(e) { return {}; }
}
function saveConfig(cfg) {
  const json = JSON.stringify(cfg);
  sessionStorage.setItem('htm-config', json);
  localStorage.setItem('htm-config', json);
  fetch('/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json }).catch(() => {});
}
async function fetchAndCacheConfig() {
  try {
    const r = await fetch('/config');
    if (r.ok) {
      const cfg = await r.json();
      const json = JSON.stringify(cfg);
      sessionStorage.setItem('htm-config', json);
      localStorage.setItem('htm-config', json);
      return cfg;
    }
  } catch(e) {}
  return loadConfig();
}

function getScreens() {
  if (screenDetails && screenDetails.screens) return Array.from(screenDetails.screens);
  // Fallback: just report the one screen we know about
  return [{ label: 'Primary', width: screen.width, height: screen.height, left: 0, top: 0, isPrimary: true }];
}

function buildScreenUI() {
  const cfg = loadConfig();
  const screens = getScreens();
  const screenList = document.getElementById('screen-list');
  if (!screenList) return;
  screenList.innerHTML = '';

  const savedIdx = cfg.gameScreenIndex ?? 1;

  screens.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.className = 'screen-btn' + (i === savedIdx ? ' current' : '');
    const label = s.label || ('Screen ' + (i + 1));
    const dims  = s.width + '×' + s.height;
    const tag   = s.isPrimary ? ' ★' : '';
    btn.innerHTML = '<span class="sc-name">' + label + tag + '</span>' +
                    '<span class="sc-dims">' + dims + '</span>' +
                    '<span class="sc-act">' + (i === savedIdx ? 'Game ▶' : 'Move game') + '</span>';
    btn.addEventListener('click', () => moveGameToScreen(i));
    screenList.appendChild(btn);
  });

  const note = document.createElement('div');
  note.className = 'screen-note';
  note.textContent = screens.length <= 1
    ? 'Only one screen detected. Connect a second monitor and refresh.'
    : screens.length + ' screens detected.';
  screenList.appendChild(note);
}

function openGameWindow() {
  if (gameWin && !gameWin.closed) { gameWin.focus(); return; }

  const cfg = loadConfig();
  const screens = getScreens();
  const idx = cfg.gameScreenIndex ?? (screens.length > 1 ? 1 : 0);
  const s = screens[Math.min(idx, screens.length - 1)];
  const left = s.left ?? 0;
  const top  = s.top  ?? 0;
  const w    = s.width  || 1920;
  const h    = s.height || 1080;

  gameWin = window.open(
    '/game.html', 'htm-game-screen',
    'left=' + left + ',top=' + top + ',width=' + w + ',height=' + h
  );
}

function moveGameToScreen(idx) {
  const screens = getScreens();
  const s = screens[Math.min(idx, screens.length - 1)];
  const left = s.left ?? 0;
  const top  = s.top  ?? 0;
  const w    = s.width  || 1920;
  const h    = s.height || 1080;

  if (gameWin && !gameWin.closed) {
    gameWin.moveTo(left, top);
    gameWin.resizeTo(w, h);
    // Tell game to maximize itself to fill the screen it's now on
    setTimeout(() => channel.postMessage({ type: 'maximize' }), 200);
  } else {
    // Game window was closed — reopen on new screen
    gameWin = window.open(
      '/game.html', 'htm-game-screen',
      'left=' + left + ',top=' + top + ',width=' + w + ',height=' + h
    );
  }

  const cfg = loadConfig();
  cfg.gameScreenIndex = idx;
  saveConfig(cfg);
  buildScreenUI();
}

async function initScreens() {
  if ('getScreenDetails' in window) {
    try {
      screenDetails = await window.getScreenDetails();
      screenDetails.addEventListener('screenschange', buildScreenUI);
    } catch(e) {
      // Permission denied or API unavailable — use fallback
    }
  }
  buildScreenUI();
  openGameWindow();
}

document.getElementById('btn-reopen-game').addEventListener('click', () => {
  if (gameWin && !gameWin.closed) { gameWin.focus(); return; }
  gameWin = null;
  openGameWindow();
});

initScreens();

// ── State mirror ──────────────────────────────────────────────────────────────
let currentState = { currentMin:60, currentSec:0, clockForward:false,
  timerHasStopped:true, onSplash:true, clueCount:0, volume:0.4 };

function pad(n) { return n < 10 ? '0' + n : '' + n; }

channel.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || data.type !== 'state') return;
  currentState = data;

  bigTimer.textContent = (data.clockForward ? '− ' : '') + pad(data.currentMin) + ':' + pad(data.currentSec);
  bigTimer.className = '';
  if (data.gameLocked)             bigTimer.classList.add('escaped');
  else if (data.clockForward)      bigTimer.classList.add('negative');
  else if (!data.timerHasStopped)  bigTimer.classList.add('running');
  else                             bigTimer.classList.add('paused');

  let st = 'WAITING';
  if (data.gameLocked)                                    st = 'LOCKED — RESET TO PLAY AGAIN';
  else if (!data.onSplash && !data.timerHasStopped)       st = 'RUNNING';
  else if (!data.onSplash && data.timerHasStopped)        st = 'PAUSED';
  statusBadge.textContent = st;

  // Disable Start/Resume when locked
  const locked = !!data.gameLocked;
  document.getElementById('btn-start').disabled  = locked;
  pauseBtn.disabled = locked;
  pauseBtn.textContent = data.timerHasStopped ? '▶ Resume' : '⏸ Pause';

  volDisplay.textContent = Math.round((data.volume || 0) * 100) + '%';
  clueCountEl.textContent = data.clueCount || 0;

  buildActiveHints(data.activeHints || []);
});

function buildActiveHints(hints) {
  const list = document.getElementById('active-hints-list');
  list.innerHTML = '';
  if (!hints.length) {
    list.innerHTML = '<div id="no-active-hints">None</div>';
    return;
  }
  hints.forEach(text => {
    const row = document.createElement('div');
    row.className = 'active-hint-row';

    const textEl = document.createElement('div');
    textEl.className = 'active-hint-text';
    textEl.textContent = text;

    const btn = document.createElement('button');
    btn.className = 'btn-dismiss-hint';
    btn.textContent = 'Dismiss';
    btn.addEventListener('click', () => cmd('dismiss-hint', { text }));

    row.appendChild(textEl);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

// ── Build grouped hints from config ──────────────────────────────────────────
function buildHints() {
  const cfg = loadConfig();
  const groups = cfg.hintGroups || [];
  hintsList.innerHTML = '';

  if (!groups.length || groups.every(g => !g.hints || g.hints.length === 0)) {
    hintsList.innerHTML = '<div id="no-hints-msg">No hints configured. Open ⚙ Config to add hint groups.</div>';
    return;
  }

  groups.forEach((group, gi) => {
    if (!group.hints || group.hints.length === 0) return;

    const groupEl = document.createElement('div');
    groupEl.className = 'hint-group';

    // Collapsible header
    const hdr = document.createElement('div');
    hdr.className = 'hint-group-header';
    hdr.innerHTML = '<span>' + (group.name || 'Group ' + (gi + 1)) + '</span>' +
                    '<span class="toggle-icon">▾</span>';
    hdr.addEventListener('click', () => {
      const body = groupEl.querySelector('.hint-group-body');
      const icon = hdr.querySelector('.toggle-icon');
      body.classList.toggle('collapsed');
      icon.textContent = body.classList.contains('collapsed') ? '▸' : '▾';
    });

    const body = document.createElement('div');
    body.className = 'hint-group-body';

    group.hints.forEach((hint, hi) => {
      const btn = document.createElement('button');
      btn.className = 'hint-btn';

      const badge = document.createElement('span');
      badge.className = 'hint-key-badge' + (hint.key ? '' : ' no-key');
      badge.textContent = hint.key || '—';

      const textEl = document.createElement('span');
      textEl.className = 'hint-text';
      textEl.textContent = hint.text;

      btn.appendChild(badge);
      btn.appendChild(textEl);

      btn.addEventListener('click', () => {
        cmd('show-hint', { text: hint.text });
        // Flash the button
        btn.style.background = '#2a2a80';
        setTimeout(() => btn.style.background = '', 300);
      });

      body.appendChild(btn);
    });

    groupEl.appendChild(hdr);
    groupEl.appendChild(body);
    hintsList.appendChild(groupEl);
  });
}

// Reload hints when config changes (storage event fires in same-browser tabs)
window.addEventListener('storage', (e) => {
  if (e.key === 'htm-config') buildHints();
});

// Initial load — fetch from server so all devices share the same config
fetchAndCacheConfig().then(() => buildHints());

// Ask game for current state on load
setTimeout(() => cmd('request-state'), 500);
