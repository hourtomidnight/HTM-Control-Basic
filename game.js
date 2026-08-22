// channel is defined by channel.js (SSE + HTTP POST, works cross-device)

// ── Config ────────────────────────────────────────────────────────────────────
let cfg = {};
let startMinutes = 60;
let keyMap = {}; // key string → hint text

function loadConfig() {
  // Sync fallback — config is fetched async on init; this returns the cached copy
  try { return JSON.parse(sessionStorage.getItem('htm-config') || localStorage.getItem('htm-config')) || {}; } catch(e) { return {}; }
}

async function fetchConfig() {
  try {
    const r = await fetch('/config');
    if (r.ok) {
      const cfg = await r.json();
      sessionStorage.setItem('htm-config', JSON.stringify(cfg));
      return cfg;
    }
  } catch(e) {}
  return loadConfig();
}

function buildKeyMap(config) {
  keyMap = {};
  (config.hintGroups || []).forEach(group => {
    (group.hints || []).forEach(hint => {
      if (hint.key && hint.text) keyMap[hint.key] = hint.text;
    });
  });
}

function applyConfig() {
  cfg = loadConfig();
  startMinutes = cfg.timerMinutes || 60;
  setVolume(cfg.volume ?? 0.4);
  logoEl.src = cfg.logoPath || '';
  buildKeyMap(cfg);
  restartHintCycle(); // pick up new cycle speed if changed
  if (timerHasStopped) resetTimer();
}

window.addEventListener('storage', (e) => {
  if (e.key === 'htm-config') applyConfig();
});

async function applyConfigAsync() {
  cfg = await fetchConfig();
  startMinutes = cfg.timerMinutes || 60;
  setVolume(cfg.volume ?? 0.4);
  logoEl.src = cfg.logoPath || '';
  buildKeyMap(cfg);
  restartHintCycle();
  if (timerHasStopped) resetTimer();
}

// ── State ─────────────────────────────────────────────────────────────────────
let clockForward    = false;
let currentMin      = 60;
let currentSec      = 0;
let timerHasStopped = true;
let onSplash        = true;
let gameLocked      = false; // true after Stop — must reset to clear
let volume          = 0.4;
let clueCount       = 0;
let musicPauseMs    = 0;
let activeHints     = [];   // texts currently shown on screen
let hintCycleIdx    = 0;
let hintCycleTimer  = null;

// ── DOM ───────────────────────────────────────────────────────────────────────
const splashEl     = document.getElementById('splash');
const splashTextEl = document.getElementById('splash-text');
const logoEl       = document.getElementById('logo');
const timerEl      = document.getElementById('timer-display');
const negativeEl   = document.getElementById('negative-symbol');
const clueBoxEl    = document.getElementById('clue-box');
const clueCountEl  = document.getElementById('clue-counter');
const volumeBarEl  = document.getElementById('volume-bar');
const statusEl     = document.getElementById('status');

// ── Audio ─────────────────────────────────────────────────────────────────────
function makeAudio(file) {
  const a = new Audio('assets/' + file);
  a.preload = 'auto';
  return a;
}
const timerMusic  = makeAudio('TimerMusic.mp3');
const finaleMusic = makeAudio('FinaleMusic.mp3');
const clueSound   = makeAudio('ClueSound.mp3');
timerMusic.loop = true;

function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  timerMusic.volume = finaleMusic.volume = clueSound.volume = volume;
  volumeBarEl.textContent = 'Vol: ' + Math.round(volume * 100) + '%';
}
function playTimerMusic()  { timerMusic.currentTime = musicPauseMs/1000; timerMusic.play().catch(()=>{}); }
function stopTimerMusic()  { musicPauseMs = timerMusic.currentTime*1000; timerMusic.pause(); }
function playFinaleMusic() { finaleMusic.currentTime = 0; finaleMusic.play().catch(()=>{}); }
function stopFinaleMusic() { finaleMusic.pause(); finaleMusic.currentTime = 0; }
function playClueSound()   { clueSound.currentTime = 0; clueSound.play().catch(()=>{}); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(n) { return n < 10 ? '0' + n : '' + n; }

function updateTimerDisplay() {
  timerEl.textContent = pad(currentMin) + ':' + pad(currentSec);
  negativeEl.style.opacity = clockForward ? '1' : '0';
}

function broadcastState() {
  channel.postMessage({ type: 'state', currentMin, currentSec, clockForward,
    timerHasStopped, onSplash, gameLocked, clueCount, volume, startMinutes,
    activeHints: activeHints.slice() });
}

// ── Actions ───────────────────────────────────────────────────────────────────
function resetTimer() {
  currentMin = startMinutes; currentSec = 0;
  clockForward = false; timerHasStopped = true; gameLocked = false;
  updateTimerDisplay(); statusEl.textContent = 'PAUSED'; broadcastState();
}

function startGame() {
  splashEl.classList.add('hidden'); logoEl.classList.add('visible');
  onSplash = false; timerHasStopped = false; musicPauseMs = 0;
  playTimerMusic(); statusEl.textContent = 'RUNNING'; broadcastState();
}

function pauseTimer() {
  if (timerHasStopped) return;
  stopTimerMusic(); stopFinaleMusic(); timerHasStopped = true;
  statusEl.textContent = 'PAUSED'; broadcastState();
}

function resumeTimer() {
  if (!timerHasStopped || onSplash) return;
  timerHasStopped = false; playTimerMusic(); stopFinaleMusic();
  statusEl.textContent = 'RUNNING'; broadcastState();
}

function markEscaped() {
  stopTimerMusic(); stopFinaleMusic();
  timerHasStopped = true; onSplash = true; gameLocked = true;
  logoEl.classList.remove('visible');
  splashTextEl.classList.remove('dim');
  splashTextEl.style.fontSize = '12vw';
  const remMin = clockForward ? currentMin : (startMinutes - 1) - currentMin;
  const remSec = clockForward ? currentSec : 59 - currentSec;
  splashTextEl.textContent = 'You Escaped!\n' + pad(remMin) + ':' + pad(remSec) +
    (clockForward ? ' over' : ' remaining');
  splashEl.classList.remove('hidden');
  playFinaleMusic(); statusEl.textContent = 'ESCAPED'; broadcastState();
}

// ── Start/Stop key logic ──────────────────────────────────────────────────────
// WAITING → START (running), RUNNING → STOP (locked), LOCKED → nothing
function handleStartStop() {
  if (gameLocked) return;                          // locked — ignore
  if (onSplash && timerHasStopped) { startGame(); return; } // start
  if (!timerHasStopped) { markEscaped(); return; } // stop
  // if paused but not locked, also allow stop
  if (timerHasStopped && !onSplash) { markEscaped(); }
}

function showWaitingSplash() {
  stopTimerMusic(); stopFinaleMusic(); musicPauseMs = 0; onSplash = true;
  gameLocked = false; // reset clears the lock
  activeHints = []; hintCycleIdx = 0; stopHintCycle();
  logoEl.classList.remove('visible'); negativeEl.style.opacity = '0';
  clueBoxEl.textContent = ''; clueCount = 0; clueCountEl.textContent = 'Clues: 0';
  splashTextEl.classList.add('dim'); splashTextEl.style.fontSize = '';
  splashTextEl.textContent = 'Please wait until you are instructed to begin.';
  splashEl.classList.remove('hidden');
  resetTimer(); statusEl.textContent = 'WAITING'; broadcastState();
}

function adjustTime(dMin, dSec) {
  currentSec += dSec;
  if (currentSec >= 60) { currentMin++; currentSec -= 60; }
  if (currentSec < 0)   { currentMin--; currentSec += 60; }
  currentMin = Math.max(0, Math.min(999, currentMin + dMin));
  updateTimerDisplay(); broadcastState();
}

// ── Hint cycling ──────────────────────────────────────────────────────────────
function getCycleMs() { return ((cfg.hintCycleSeconds || 5) * 1000); }

function renderCurrentHint() {
  if (activeHints.length === 0) { clueBoxEl.textContent = ''; return; }
  if (hintCycleIdx >= activeHints.length) hintCycleIdx = 0;
  clueBoxEl.textContent = activeHints[hintCycleIdx];
}

function fadeToNextHint() {
  clueBoxEl.classList.add('fading');
  setTimeout(() => {
    hintCycleIdx = (hintCycleIdx + 1) % activeHints.length;
    renderCurrentHint();
    clueBoxEl.classList.remove('fading');
  }, 420);
}

function startHintCycle() {
  if (hintCycleTimer || activeHints.length <= 1) return;
  hintCycleTimer = setInterval(fadeToNextHint, getCycleMs());
}

function stopHintCycle() {
  if (hintCycleTimer) { clearInterval(hintCycleTimer); hintCycleTimer = null; }
}

function restartHintCycle() {
  stopHintCycle();
  if (activeHints.length > 1) startHintCycle();
}

function showHint(text) {
  if (!text) return;
  if (!activeHints.includes(text)) {
    activeHints.push(text);
    clueCount++;
    clueCountEl.textContent = 'Clues: ' + clueCount;
    if (activeHints.length === 1) {
      hintCycleIdx = 0;
      renderCurrentHint();
    }
    restartHintCycle();
    playClueSound();
  }
  broadcastState();
}

function dismissHint(text) {
  const idx = activeHints.indexOf(text);
  if (idx === -1) return;
  activeHints.splice(idx, 1);
  if (hintCycleIdx >= activeHints.length) hintCycleIdx = 0;
  restartHintCycle();
  clueBoxEl.classList.add('fading');
  setTimeout(() => { renderCurrentHint(); clueBoxEl.classList.remove('fading'); }, 420);
  broadcastState();
}

function hideClue() {
  activeHints = []; hintCycleIdx = 0;
  stopHintCycle();
  clueBoxEl.classList.add('fading');
  setTimeout(() => { clueBoxEl.textContent = ''; clueBoxEl.classList.remove('fading'); }, 420);
  broadcastState();
}

// ── Key event → key string (mirrors config.html formatKey) ───────────────────
function eventToKeyString(e) {
  const mods = [];
  if (e.ctrlKey)  mods.push('Ctrl');
  if (e.altKey)   mods.push('Alt');
  if (e.shiftKey && e.key.length > 1) mods.push('Shift');
  let k = e.key;
  if (k === ' ') k = 'Space';
  if (e.code && e.code.startsWith('Numpad')) k = e.code.replace('Numpad', 'Num');
  mods.push(k);
  return mods.join('+');
}

// ── BroadcastChannel commands ─────────────────────────────────────────────────
channel.addEventListener('message', (e) => {
  const c = e.data;
  if (!c || c.type === 'state') return;
  switch (c.type) {
    case 'start':          if (!gameLocked) startGame(); break;
    case 'pause':          pauseTimer(); break;
    case 'resume':         if (!gameLocked) resumeTimer(); break;
    case 'escaped':        markEscaped(); break;
    case 'reset':          showWaitingSplash(); break;
    case 'add-min':        adjustTime(1, 0); break;
    case 'sub-min':        adjustTime(-1, 0); break;
    case 'add-sec':        adjustTime(0, 1); break;
    case 'sub-sec':        adjustTime(0, -1); break;
    case 'show-hint':      showHint(c.text); break;
    case 'dismiss-hint':   dismissHint(c.text); break;
    case 'hide-clue':      hideClue(); break;
    case 'vol-up':         setVolume(volume + 0.01); broadcastState(); break;
    case 'vol-down':       setVolume(volume - 0.01); broadcastState(); break;
    case 'config-updated': applyConfigAsync(); break;
    case 'request-state':  broadcastState(); break;
    case 'maximize':       maximizeWindow(); break;
  }
});

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const k = e.keyCode;
  const keyStr = eventToKeyString(e);

  // Start/Stop key (configured)
  if (cfg.startStopKey && keyStr === cfg.startStopKey) {
    e.preventDefault(); handleStartStop(); return;
  }

  // Space = same as Start/Stop
  if (k === 32)  { handleStartStop(); return; }
  // Pause/Break = silent pause/resume only (no lock)
  if (k === 19)  { timerHasStopped ? resumeTimer() : pauseTimer(); return; }
  // Reset keys
  if (k === 145 || k === 192) { showWaitingSplash(); return; }
  // Volume
  if (k === 107) { setVolume(volume + 0.01); broadcastState(); return; }
  if (k === 109) { setVolume(volume - 0.01); broadcastState(); return; }
  // Hide clue
  if (k === 111 || k === 96) { hideClue(); return; }

  // Configured hint keys
  if (keyMap[keyStr]) { e.preventDefault(); showHint(keyMap[keyStr]); return; }
});

document.addEventListener('click', handleStartStop);

// ── Timer loop ────────────────────────────────────────────────────────────────
updateTimerDisplay();
setInterval(() => {
  if (timerHasStopped) return;
  if (!clockForward) {
    currentSec--;
    if (currentSec < 0)  { currentMin--; currentSec = 59; }
    if (currentMin < 0)  { clockForward = true; currentMin = 0; currentSec = 0; }
  } else {
    currentSec++;
    if (currentSec >= 60) { currentMin++; currentSec = 0; }
  }
  updateTimerDisplay(); broadcastState();
}, 1000);

// ── Window maximize ───────────────────────────────────────────────────────────
function maximizeWindow() {
  window.moveTo(screen.availLeft || 0, screen.availTop || 0);
  window.resizeTo(screen.availWidth || screen.width, screen.availHeight || screen.height);
}

// ── Init ──────────────────────────────────────────────────────────────────────
applyConfigAsync();
// Maximize on load after a short delay so the window is fully positioned first
setTimeout(maximizeWindow, 300);
