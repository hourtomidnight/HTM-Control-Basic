// ── BroadcastChannel (replaces Electron IPC) ──────────────────────────────────
const channel = new BroadcastChannel('htm-game-clock');

// ── Config (localStorage) ─────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(localStorage.getItem('htm-config')) || {}; } catch(e) { return {}; }
}

let cfg = loadConfig();
let startMinutes = cfg.timerMinutes || 60;

function applyConfig() {
  cfg = loadConfig();
  startMinutes = cfg.timerMinutes || 60;
  setVolume(cfg.volume ?? 0.4);
  logoEl.src = cfg.logoPath || '';
  if (timerHasStopped) resetTimer();
}

// ── State ─────────────────────────────────────────────────────────────────────
let clockForward    = false;
let currentMin      = startMinutes;
let currentSec      = 0;
let timerHasStopped = true;
let onSplash        = true;
let volume          = cfg.volume ?? 0.4;
let clueCount       = 0;
let musicPauseMs    = 0;

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
function playTimerMusic()  { timerMusic.currentTime = musicPauseMs / 1000; timerMusic.play().catch(()=>{}); }
function stopTimerMusic()  { musicPauseMs = timerMusic.currentTime * 1000; timerMusic.pause(); }
function playFinaleMusic() { finaleMusic.currentTime = 0; finaleMusic.play().catch(()=>{}); }
function stopFinaleMusic() { finaleMusic.pause(); finaleMusic.currentTime = 0; }
function playClueSound()   { clueSound.currentTime = 0; clueSound.play().catch(()=>{}); }

setVolume(volume);
if (cfg.logoPath) logoEl.src = cfg.logoPath;

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(n) { return n < 10 ? '0' + n : '' + n; }

function updateTimerDisplay() {
  timerEl.textContent = pad(currentMin) + ':' + pad(currentSec);
  negativeEl.style.opacity = clockForward ? '1' : '0';
}

function broadcastState() {
  channel.postMessage({ type: 'state', currentMin, currentSec, clockForward,
    timerHasStopped, onSplash, clueCount, volume, startMinutes });
}

// ── Actions ───────────────────────────────────────────────────────────────────
function resetTimer() {
  currentMin = startMinutes; currentSec = 0; clockForward = false; timerHasStopped = true;
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
  timerHasStopped = true; onSplash = true;
  logoEl.classList.remove('visible');
  splashTextEl.classList.remove('dim');
  splashTextEl.style.fontSize = '12vw';
  const remMin = clockForward ? currentMin : (startMinutes - 1) - currentMin;
  const remSec = clockForward ? currentSec : 59 - currentSec;
  const label  = clockForward ? 'over' : 'remaining';
  splashTextEl.textContent = 'You Escaped!\n' + pad(remMin) + ':' + pad(remSec) + ' ' + label;
  splashEl.classList.remove('hidden');
  playFinaleMusic(); statusEl.textContent = 'ESCAPED'; broadcastState();
}

function showWaitingSplash() {
  stopTimerMusic(); stopFinaleMusic(); musicPauseMs = 0; onSplash = true;
  logoEl.classList.remove('visible'); negativeEl.style.opacity = '0';
  clueBoxEl.textContent = '...'; clueCount = 0; clueCountEl.textContent = 'Clues: 0';
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

function showClue(index) {
  const text = (cfg.clues || [])[index];
  if (!text && text !== '') return;
  clueBoxEl.textContent = text;
  clueCount++; clueCountEl.textContent = 'Clues: ' + clueCount;
  playClueSound(); broadcastState();
}

function hideClue() { clueBoxEl.textContent = ''; }

// ── Operator commands via BroadcastChannel ────────────────────────────────────
channel.addEventListener('message', (e) => {
  const cmd = e.data;
  if (!cmd || cmd.type === 'state') return;
  switch (cmd.type) {
    case 'start':          startGame(); break;
    case 'pause':          pauseTimer(); break;
    case 'resume':         resumeTimer(); break;
    case 'escaped':        markEscaped(); break;
    case 'reset':          showWaitingSplash(); break;
    case 'add-min':        adjustTime(1, 0); break;
    case 'sub-min':        adjustTime(-1, 0); break;
    case 'add-sec':        adjustTime(0, 1); break;
    case 'sub-sec':        adjustTime(0, -1); break;
    case 'show-clue':      showClue(cmd.index); break;
    case 'hide-clue':      hideClue(); break;
    case 'vol-up':         setVolume(volume + 0.01); broadcastState(); break;
    case 'vol-down':       setVolume(volume - 0.01); broadcastState(); break;
    case 'config-updated': applyConfig(); break;
    case 'request-state':  broadcastState(); break;
  }
});

// ── Click / keyboard ──────────────────────────────────────────────────────────
function handleActivate() {
  if (onSplash && timerHasStopped) { startGame(); return; }
  if (!timerHasStopped) { markEscaped(); return; }
  resumeTimer();
}

const NUMPAD_CLUE = {97:0,98:1,99:2,100:3,101:4,102:5,103:6,104:7,105:8};
const ROW_CLUE    = {49:9,50:10,51:11,52:12,53:13,54:14,55:15,56:16,57:17,48:18};

document.addEventListener('keydown', (e) => {
  const k = e.keyCode;
  if (k===32)  { handleActivate(); return; }
  if (k===19)  { timerHasStopped ? resumeTimer() : pauseTimer(); return; }
  if (k===145||k===192) { showWaitingSplash(); return; }
  if (k===107) { setVolume(volume+0.01); broadcastState(); return; }
  if (k===109) { setVolume(volume-0.01); broadcastState(); return; }
  if (k===111||k===96) { hideClue(); return; }
  if (NUMPAD_CLUE[k]!==undefined) { showClue(NUMPAD_CLUE[k]); return; }
  if (ROW_CLUE[k]!==undefined)    { showClue(ROW_CLUE[k]); return; }
});
document.addEventListener('click', handleActivate);

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
