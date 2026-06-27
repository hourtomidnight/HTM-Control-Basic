const channel = new BroadcastChannel('htm-game-clock');

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
});

// ── Build grouped hints from config ──────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(localStorage.getItem('htm-config')) || {}; } catch(e) { return {}; }
}

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

// Reload hints when config changes (storage event fires in other tabs)
window.addEventListener('storage', (e) => {
  if (e.key === 'htm-config') { buildHints(); cmd('config-updated'); }
});

buildHints();

// Ask game for current state on load
setTimeout(() => cmd('request-state'), 500);
