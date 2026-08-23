// HTM Game Clock server — Node.js built-ins only, no npm required
// Serves static files + SSE event relay + server-side config storage
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT        = 4000;
const ROOT        = __dirname;
const CONFIG_FILE = path.join(__dirname, 'config.json');

const {
  createSession, applyAdjustment, applyHint, updateField, finalizeSession,
} = require('./session-tracker');
const {
  createSheetsClient, appendRow, updateRow, buildSessionRow, buildHintRow, readColumn, buildHotkeysRows,
} = require('./sheets');

const CREDENTIALS_PATH = path.join(__dirname, 'google-credentials.json');
const sheetsAPI = createSheetsClient(CREDENTIALS_PATH);
if (!sheetsAPI) console.warn('Google credentials not found. Sheets logging disabled.');

let currentSession = null;
let sessionRowIndex = null;

const ADJUSTMENT_TYPES = new Set(['add-min', 'sub-min', 'add-sec', 'sub-sec']);

async function handleGameCommand(msg) {
  const cfg = loadConfig();
  const sessionsReady = sheetsAPI && cfg.sessionsSpreadsheetId && cfg.sessionsTabName;
  const hintsReady = sheetsAPI && cfg.hintsSpreadsheetId && cfg.hintsTabName;

  if (msg.type === 'start' && !currentSession) {
    currentSession = createSession({
      startTime: Date.now(),
      room: cfg.roomName || '',
    });
    sessionRowIndex = null;
    if (sessionsReady) {
      try {
        const { rowIndex } = await appendRow(
          sheetsAPI, cfg.sessionsSpreadsheetId, cfg.sessionsTabName, buildSessionRow(currentSession)
        );
        sessionRowIndex = rowIndex;
      } catch (e) { console.error('Sheets append (session start) failed:', e.message); }
    }
    return;
  }

  if (!currentSession) return; // ignore events with no active session

  if (ADJUSTMENT_TYPES.has(msg.type)) {
    applyAdjustment(currentSession, msg.type, Date.now());
    await syncSessionRow(cfg, sessionsReady);
    return;
  }

  if (msg.type === 'show-hint') {
    const hintRecord = applyHint(currentSession, msg.text || '', Date.now());
    await syncSessionRow(cfg, sessionsReady);
    if (hintsReady) {
      try {
        await appendRow(
          sheetsAPI, cfg.hintsSpreadsheetId, cfg.hintsTabName, buildHintRow(hintRecord, currentSession)
        );
      } catch (e) { console.error('Sheets append (hint) failed:', e.message); }
    }
    return;
  }

  if (msg.type === 'update-field') {
    updateField(currentSession, msg.field, msg.value);
    await syncSessionRow(cfg, sessionsReady);
    return;
  }

  if (msg.type === 'escaped' || msg.type === 'reset') {
    finalizeSession(currentSession, Date.now(), msg.type === 'escaped' ? 'Escaped' : 'Reset-Lost');
    await syncSessionRow(cfg, sessionsReady);
    currentSession = null;
    sessionRowIndex = null;
    return;
  }
}

async function syncSessionRow(cfg, sessionsReady) {
  if (!sessionsReady || sessionRowIndex == null) return;
  try {
    await updateRow(sheetsAPI, cfg.sessionsSpreadsheetId, cfg.sessionsTabName, sessionRowIndex, buildSessionRow(currentSession));
  } catch (e) { console.error('Sheets update (session) failed:', e.message); }
}

async function syncHotkeysTab(cfg) {
  if (!sheetsAPI || !cfg.hintsSpreadsheetId || !cfg.hotkeysTabName) return;
  const rows = buildHotkeysRows(cfg.hintGroups);
  // Clear the tab's existing rows below the header, then append the current set.
  await sheetsAPI.spreadsheets.values.clear({
    spreadsheetId: cfg.hintsSpreadsheetId,
    range: cfg.hotkeysTabName + '!A2:Z',
  });
  if (rows.length) {
    await sheetsAPI.spreadsheets.values.update({
      spreadsheetId: cfg.hintsSpreadsheetId,
      range: cfg.hotkeysTabName + '!A2',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  }
}

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.txt':  'text/plain',
};

// ── SSE client registry ───────────────────────────────────────────────────────
const clients = new Set();

function broadcast(data) {
  const line = 'data: ' + JSON.stringify(data) + '\n\n';
  for (const res of clients) {
    try { res.write(line); } catch(e) { clients.delete(res); }
  }
}

// ── Config persistence ────────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch(e) { return {}; }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ── Body reader ───────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ── CORS / common headers ─────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── HTTP server ───────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  // ── GET /events — SSE stream ─────────────────────────────────────────────
  if (url === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n'); // client reconnects after 3 s if connection drops
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // ── POST /cmd — relay a command to all clients ───────────────────────────
  if (url === '/cmd' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const msg  = JSON.parse(body);
      broadcast(msg);
      res.writeHead(204); res.end();
      handleGameCommand(msg).catch(e => console.error('handleGameCommand error:', e.message));
    } catch(e) {
      res.writeHead(400); res.end('Bad JSON');
    }
    return;
  }

  // ── GET /config — return stored config ──────────────────────────────────
  if (url === '/config' && req.method === 'GET') {
    const cfg = loadConfig();
    const json = JSON.stringify(cfg);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(json);
    return;
  }

  // ── GET /api/operators — return operator dropdown options ────────────────
  if (url === '/api/operators' && req.method === 'GET') {
    const cfg = loadConfig();
    if (!sheetsAPI || !cfg.operatorsSpreadsheetId) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ operators: [] }));
      return;
    }
    try {
      const operators = await readColumn(sheetsAPI, cfg.operatorsSpreadsheetId, 'Drop Down options', 'B', 2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ operators }));
    } catch (e) {
      console.error('Failed to read operators:', e.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ operators: [] }));
    }
    return;
  }

  // ── POST /config — save config & broadcast update ───────────────────────
  if (url === '/config' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const cfg  = JSON.parse(body);
      saveConfig(cfg);
      broadcast({ type: 'config-updated' });
      res.writeHead(204); res.end();
      syncHotkeysTab(cfg).catch(e => console.error('Hotkeys tab sync failed:', e.message));
    } catch(e) {
      res.writeHead(400); res.end('Bad JSON');
    }
    return;
  }

  // ── Static file serving ──────────────────────────────────────────────────
  const filePath = path.join(ROOT, url === '/' ? '/operator.html' : url);

  // Security: prevent path traversal outside ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + url); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });

}).listen(PORT, '0.0.0.0', () => {
  const ifaces = require('os').networkInterfaces();
  let localIP = 'localhost';
  for (const iface of Object.values(ifaces)) {
    const ext = iface.find(i => i.family === 'IPv4' && !i.internal);
    if (ext) { localIP = ext.address; break; }
  }
  console.log('HTM Game Clock running on:');
  console.log('  Local   : http://localhost:' + PORT + '/operator.html');
  console.log('  Network : http://' + localIP + ':' + PORT + '/operator.html');
});
