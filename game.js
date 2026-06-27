const { ipcRenderer } = require('electron');

// ── Config ────────────────────────────────────────────────────────────────────
let cfg = { timerMinutes: 60, volume: 0.4, logoPath: '', clues: Array(19).fill('') };
let startMinutes = 60;

async function applyConfig() {
  cfg = await ipcRenderer.invoke('get-config');
  startMinutes = cfg.timerMinutes || 60;
  setVolume(cfg.volume ?? 0.4);
  logoEl.src = cfg.logoPath || '';
  if (timerHasStopped) resetTimer();
}
ipcRenderer.on('config-updated', () => applyConfig());

// ── State ─────────────────────────────────────────────────────────────────────
let clockForward    = false;
let currentMin      = 60;
let currentSec      = 0;
let timerHasStopped = true;
let onSplash        = true;
let volume          = 0.4;
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
const nodePath = require('path');
const fs       = require('fs');
const assetsDir = nodePath.join(__dirname, 'assets');

function makeAudio(file) {
  const p = nodePath.join(assetsDir, file);
  if (!fs.existsSync(p)) return null;
  return new Audio(p);
}

const timerMusic  = makeAudio('TimerMusic.mp3');
const finaleMusic = makeAudio('FinaleMusic.mp3');
const clueSound   = makeAudio('ClueSound.mp3');
if (timerMusic) timerMusic.loop = true;

function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (timerMusic)  timerMusic.volume  = volume;
  if (finaleMusic) finaleMusic.volume = volume;
  if (clueSound)   clueSound.volume   = volume;
  volumeBarEl.textContent = 'Vol: ' + Math.round(volume * 100) + '%';
}
function playTimerMusic() {
  if (!timerMusic) return;
  timerMusic.currentTime = musicPauseMs / 1000;
  timerMusic.play().catch(() => {});
}
function stopTimerMusic() {
  if (!timerMusic) return;
  musicPauseMs = timerMusic.currentTime * 1000;
  timerMusic.pause();
}
function playFinaleMusic() { if (finaleMusic) { finaleMusic.currentTime = 0; finaleMusic.play().catch(() => {}); } }
function stopFinaleMusic()  { if (finaleMusic) { finaleMusic.pause(); finaleMusic.currentTime = 0; } }
function playClueSound()    { if (clueSound)   { clueSound.currentTime = 0; clueSound.play().catch(() => {}); } }

// ── Helpers ───────────────────────────────────────────────────────────────────
function pad(n) { return n < 10 ? '0' + n : String(n); }

function updateTimerDisplay() {
  timerEl.textContent = pad(currentMin) + ':' + pad(currentSec);
  negativeEl.style.opacity = clockForward ? '1' : '0';
}

function broadcastState() {
  ipcRenderer.send('game-state', {
    currentMin, currentSec, clockForward,
    timerHasStopped, onSplash, clueCount, volume, startMinutes,
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────
function resetTimer() {
  currentMin = startMinutes;
  currentSec = 0;
  clockForward = false;
  timerHasStopped = true;
  updateTimerDisplay();
  statusEl.textContent = 'PAUSED';
  broadcastState();
}

function startGame() {
  splashEl.classList.add('hidden');
  logoEl.classList.add('visible');
  onSplash = false;
  timerHasStopped = false;
  musicPauseMs = 0;
  playTimerMusic();
  statusEl.textContent = 'RUNNING';
  broadcastState();
}

function pauseTimer() {
  if (timerHasStopped) return;
  stopTimerMusic();
  stopFinaleMusic();
  timerHasStopped = true;
  statusEl.textContent = 'PAUSED';
  broadcastState();
}

function resumeTimer() {
  if (!timerHasStopped || onSplash) return;
  timerHasStopped = false;
  playTimerMusic();
  stopFinaleMusic();
  statusEl.textContent = 'RUNNING';
  broadcastState();
}

function markEscaped() {
  stopTimerMusic();
  stopFinaleMusic();
  timerHasStopped = true;
  onSplash = true;
  logoEl.classList.remove('visible');
  splashTextEl.classList.remove('dim');
  splashTextEl.style.fontSize = '200px';
  splashTextEl.style.whiteSpace = 'pre-line';
  const remMin = clockForward ? currentMin : (startMinutes - 1) - currentMin;
  const remSec = clockForward ? currentSec : 59 - currentSec;
  const label  = clockForward ? 'over' : 'remaining';
  splashTextEl.textContent = 'You Escaped!\n' + pad(remMin) + ':' + pad(remSec) + ' ' + label;
  splashEl.classList.remove('hidden');
  playFinaleMusic();
  statusEl.textContent = 'ESCAPED';
  broadcastState();
}

function showWaitingSplash() {
  stopTimerMusic();
  stopFinaleMusic();
  musicPauseMs = 0;
  onSplash = true;
  logoEl.classList.remove('visible');
  negativeEl.style.opacity = '0';
  clueBoxEl.textContent = '...';
  clueCount = 0;
  clueCountEl.textContent = 'Clues: 0';
  splashTextEl.classList.add('dim');
  splashTextEl.style.fontSize = '';
  splashTextEl.style.whiteSpace = '';
  splashTextEl.textContent = 'Please wait until you are instructed to begin.';
  splashEl.classList.remove('hidden');
  resetTimer();
  statusEl.textContent = 'WAITING';
  broadcastState();
}

function adjustTime(deltaMin, deltaSec) {
  currentSec += deltaSec;
  if (currentSec >= 60) { currentMin++; currentSec -= 60; }
  if (currentSec < 0)   { currentMin--; currentSec += 60; }
  currentMin = Math.max(0, Math.min(999, currentMin + deltaMin));
  updateTimerDisplay();
  broadcastState();
}

function showClue(index) {
  const text = (cfg.clues || [])[index];
  if (text === undefined || text === null) return;
  clueBoxEl.textContent = text;
  clueCount++;
  clueCountEl.textContent = 'Clues: ' + clueCount;
  playClueSound();
  broadcastState();
}

function hideClue() { clueBoxEl.textContent = ''; }

// ── Click / Space ─────────────────────────────────────────────────────────────
function handleActivate() {
  if (onSplash && timerHasStopped) { startGame(); return; }
  if (!timerHasStopped) { markEscaped(); return; }
  resumeTimer();
}

// ── IPC from operator ─────────────────────────────────────────────────────────
ipcRenderer.on('game-command', (_, cmd) => {
  switch (cmd.type) {
    case 'start':     startGame();           break;
    case 'pause':     pauseTimer();          break;
    case 'resume':    resumeTimer();         break;
    case 'escaped':   markEscaped();         break;
    case 'reset':     showWaitingSplash();   break;
    case 'splash':    showWaitingSplash();   break;
    case 'add-min':   adjustTime(1, 0);      break;
    case 'sub-min':   adjustTime(-1, 0);     break;
    case 'add-sec':   adjustTime(0, 1);      break;
    case 'sub-sec':   adjustTime(0, -1);     break;
    case 'show-clue': showClue(cmd.index);   break;
    case 'hide-clue': hideClue();            break;
    case 'vol-up':    setVolume(volume + 0.01); broadcastState(); break;
    case 'vol-down':  setVolume(volume - 0.01); broadcastState(); break;
  }
});

// ── Keyboard ──────────────────────────────────────────────────────────────────
const NUMPAD_CLUE_MAP = {97:0,98:1,99:2,100:3,101:4,102:5,103:6,104:7,105:8};
const ROW_CLUE_MAP    = {49:9,50:10,51:11,52:12,53:13,54:14,55:15,56:16,57:17,48:18};

document.addEventListener('keydown', (e) => {
  const k = e.keyCode;
  if (k === 32)  { handleActivate(); return; }
  if (k === 19)  { timerHasStopped ? resumeTimer() : pauseTimer(); return; }
  if (k === 145 || k === 192) { showWaitingSplash(); return; }
  if (k === 107) { setVolume(volume + 0.01); broadcastState(); return; }
  if (k === 109) { setVolume(volume - 0.01); broadcastState(); return; }
  if (k === 111 || k === 96) { hideClue(); return; }
  if (k === 121) { ipcRenderer.send('open-config'); return; }
  if (NUMPAD_CLUE_MAP[k] !== undefined) { showClue(NUMPAD_CLUE_MAP[k]); return; }
  if (ROW_CLUE_MAP[k] !== undefined)    { showClue(ROW_CLUE_MAP[k]); return; }
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
  updateTimerDisplay();
  broadcastState();
}, 1000);

applyConfig();
