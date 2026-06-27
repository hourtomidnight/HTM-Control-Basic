const { ipcRenderer } = require('electron');

// ── Config ────────────────────────────────────────────────────────────────────
let cfg = {
  timerMinutes: 60,
  volume: 0.4,
  logoPath: '',
  clues: Array(19).fill(''),
};

async function applyConfig() {
  cfg = await ipcRenderer.invoke('get-config');
  startMinutes = cfg.timerMinutes || 60;
  setVolume(cfg.volume || 0.4);
  logoEl.src = cfg.logoPath || '';
  if (!timerHasStopped) return; // don't reset if running
  resetTimer();
}

ipcRenderer.on('config-updated', () => applyConfig());

// ── State ─────────────────────────────────────────────────────────────────────
let startMinutes = 60;
let clockForward = false;
let currentMin = 60;
let currentSec = 0;
let timerHasStopped = true;
let onSplash = true;
let volume = 0.4;
let clueCount = 0;
let musicPauseMs = 0;

// ── DOM refs ──────────────────────────────────────────────────────────────────
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
const timerMusic  = new Audio('assets/TimerMusic.mp3');
const finaleMusic = new Audio('assets/FinaleMusic.mp3');
const clueSound   = new Audio('assets/ClueSound.mp3');
timerMusic.loop   = true;

function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  timerMusic.volume  = volume;
  finaleMusic.volume = volume;
  clueSound.volume   = volume;
  volumeBarEl.textContent = `Vol: ${Math.round(volume * 100)}%`;
}

function playTimerMusic() {
  timerMusic.currentTime = musicPauseMs / 1000;
  timerMusic.play().catch(() => {});
}
function stopTimerMusic() {
  musicPauseMs = timerMusic.currentTime * 1000;
  timerMusic.pause();
}
function playFinaleMusic() {
  finaleMusic.currentTime = 0;
  finaleMusic.play().catch(() => {});
}
function stopFinaleMusic() {
  finaleMusic.pause();
  finaleMusic.currentTime = 0;
}
function playClueSound() {
  clueSound.currentTime = 0;
  clueSound.play().catch(() => {});
}

// ── Timer display ──────────────────────────────────────────────────────────────
function pad(n) { return n < 10 ? '0' + n : String(n); }

function updateTimerDisplay() {
  timerEl.textContent = `${pad(currentMin)}:${pad(currentSec)}`;
  negativeEl.style.opacity = clockForward ? '1' : '0';
}

// ── Reset ──────────────────────────────────────────────────────────────────────
function resetTimer() {
  currentMin = startMinutes;
  currentSec = 0;
  clockForward = false;
  timerHasStopped = true;
  updateTimerDisplay();
  statusEl.textContent = 'PAUSED';
}

// ── Pause / Play (click) ───────────────────────────────────────────────────────
function pausePlay() {
  if (onSplash) {
    // Start the game
    splashEl.classList.add('hidden');
    logoEl.classList.add('visible');
    onSplash = false;
    timerHasStopped = false;
    musicPauseMs = 0;
    playTimerMusic();
    statusEl.textContent = 'RUNNING';
    return;
  }

  if (!timerHasStopped) {
    // Mark "You Escaped!"
    stopTimerMusic();
    stopFinaleMusic();
    timerHasStopped = true;
    onSplash = true;
    logoEl.classList.remove('visible');

    splashTextEl.classList.remove('dim');
    splashTextEl.style.fontSize = '200px';
    splashTextEl.style.whiteSpace = 'pre-line';

    const timeStr = computeEscapeTime();
    splashTextEl.textContent = `You Escaped!\n${timeStr}`;
    splashEl.classList.remove('hidden');

    playFinaleMusic();
    statusEl.textContent = 'ESCAPED';
  } else {
    // Resume after pause
    timerHasStopped = false;
    playTimerMusic();
    stopFinaleMusic();
    statusEl.textContent = 'RUNNING';
  }
}

function computeEscapeTime() {
  if (clockForward) {
    return `${pad(currentMin)}:${pad(currentSec)} over`;
  }
  const remMin = (startMinutes - 1) - currentMin;
  const remSec = 59 - currentSec;
  return `${pad(remMin)}:${pad(remSec)} remaining`;
}

// ── Show "Please wait" splash ──────────────────────────────────────────────────
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
}

// ── Clues ──────────────────────────────────────────────────────────────────────
function showClue(index) {
  const text = (cfg.clues || [])[index];
  if (text === undefined) return;
  clueBoxEl.textContent = text || '';
  clueCount++;
  clueCountEl.textContent = `Clues: ${clueCount}`;
  playClueSound();
}

function hideClue() {
  clueBoxEl.textContent = '';
}

// ── Keyboard ───────────────────────────────────────────────────────────────────
const NUMPAD_CLUE_MAP = {
  97: 0, 98: 1, 99: 2, 100: 3, 101: 4,
  102: 5, 103: 6, 104: 7, 105: 8,
};
const ROW_CLUE_MAP = {
  49: 9, 50: 10, 51: 11, 52: 12, 53: 13,
  54: 14, 55: 15, 56: 16, 57: 17, 48: 18,
};

document.addEventListener('keydown', (e) => {
  const k = e.keyCode;

  if (k === 32) { // Space — same as click
    pausePlay();
    return;
  }
  if (k === 19) { // Pause/Break — silent pause/resume
    if (!timerHasStopped) {
      stopTimerMusic();
      stopFinaleMusic();
      timerHasStopped = true;
      statusEl.textContent = 'PAUSED';
    } else if (!onSplash) {
      timerHasStopped = false;
      playTimerMusic();
      statusEl.textContent = 'RUNNING';
    }
    return;
  }
  if (k === 145) { // Scroll Lock — reset
    stopTimerMusic();
    stopFinaleMusic();
    musicPauseMs = 0;
    resetTimer();
    return;
  }
  if (k === 192) { // ` — waiting splash
    showWaitingSplash();
    return;
  }
  if (k === 107) { setVolume(volume + 0.01); return; } // Numpad +
  if (k === 109) { setVolume(volume - 0.01); return; } // Numpad -
  if (k === 111 || k === 96) { hideClue(); return; }   // Numpad / or Numpad0

  // Open config (F10)
  if (k === 121) { ipcRenderer.send('open-config'); return; }

  // Clues
  if (NUMPAD_CLUE_MAP[k] !== undefined) { showClue(NUMPAD_CLUE_MAP[k]); return; }
  if (ROW_CLUE_MAP[k] !== undefined)    { showClue(ROW_CLUE_MAP[k]); return; }
});

document.addEventListener('click', () => pausePlay());

// ── Timer interval (1 fps) ────────────────────────────────────────────────────
updateTimerDisplay();

setInterval(() => {
  if (timerHasStopped) return;

  if (!clockForward) {
    currentSec--;
    if (currentSec < 0) { currentMin--; currentSec = 59; }
    if (currentMin < 0) { clockForward = true; currentMin = 0; currentSec = 0; }
  } else {
    currentSec++;
    if (currentSec >= 60) { currentMin++; currentSec = 0; }
  }

  updateTimerDisplay();
}, 1000);

// ── Init ──────────────────────────────────────────────────────────────────────
applyConfig();
