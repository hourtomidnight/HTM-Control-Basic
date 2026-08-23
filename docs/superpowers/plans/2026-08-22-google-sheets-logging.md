# Google Sheets Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HTM-Control-Basic write live, incremental game-session and hint-usage data to Google Sheets, surviving mid-game power loss.

**Architecture:** All operator actions already funnel through `server.js`'s `POST /cmd` handler before being broadcast to clients (see `channel.js`). A new `session-tracker.js` module holds pure, unit-testable session state logic (no I/O). A new `sheets.js` module wraps the Google Sheets API (auth, append, update, read) behind small functions, with the row-building/formatting logic kept pure and separately testable from the network calls. `server.js` wires the two together inside the existing `/cmd` handler. New fields appear on `operator.html` (Team Name, Operator, player counts, Notes) and `config.html` (Room Name, two Sheets destinations).

**Tech Stack:** Node.js (built-in `http`/`fs`), `googleapis` npm package (new dependency), Node's built-in `node:test` + `node:assert` test runner (no new devDependency needed for tests).

**Spec:** [docs/superpowers/specs/2026-08-22-google-sheets-logging-design.md](../specs/2026-08-22-google-sheets-logging-design.md)

## Global Constraints

- Sheets integration must no-op silently (never throw / never block the in-browser game) when credentials are missing or a spreadsheet ID is blank — matches the tracker's existing fallback behavior.
- Notes / Team Name / player-count edits write to Sheets debounced (~5s after the operator stops typing or on blur), not on every keystroke.
- `show-hint` events append to the Hint Library tab **immediately** (not debounced) — hint data must survive independently of the session row.
- Room identity, and both Sheets destinations (spreadsheet ID + tab name), are config-time settings on `config.html`, not per-session operator input.
- Credentials file is `google-credentials.json` in the app root, gitignored, never committed (matches `tracker/.gitignore`'s `**/google-credentials.json` rule — add the same rule here).
- No app-generated charts. The Hint Library event log tab is plain appendable data only.

---

## File Structure

- `sheets.js` (new) — Google Sheets API wrapper: auth client creation, `appendRow`, `updateRow`, `readColumn`, plus pure row-formatting helpers (`formatDuration`, `formatNetAdjustment`, `buildSessionRow`, `buildHintRow`).
- `session-tracker.js` (new) — pure in-memory session state machine: `createSession`, `applyAdjustment`, `applyHint`, `updateField`, `finalizeSession`. No I/O; fully unit-testable.
- `server.js` (modify) — load config, create a `sheetsAPI` client at startup, wire `session-tracker.js` + `sheets.js` into the existing `/cmd` handler, add `GET /api/operators` endpoint.
- `config.html` (modify) — new "Game Sheets" card (Room Name, Game Sessions spreadsheet ID/tab, Hint Library spreadsheet ID/tab/hotkeys-tab).
- `operator.html` (modify) — new fields: Team Name, Operator dropdown, New Players, Experienced Players, Notes textarea.
- `operator.js` (modify) — wiring for the new fields: debounced save via `cmd()`, populate Operator dropdown from `/api/operators`.
- `package.json` (modify) — add `googleapis` dependency, add `"test": "node --test"` script.
- `.gitignore` (new) — `google-credentials.json`, matching the tracker's convention.
- `setup-pi.sh`, `update.sh` (modify) — add `npm install` step and a credentials reminder.
- Tests: `test/session-tracker.test.js`, `test/sheets.test.js` (new).

---

### Task 1: Project scaffolding — dependency, test runner, gitignore

**Files:**
- Modify: `package.json`
- Create: `.gitignore`
- Create: `test/smoke.test.js`

**Interfaces:**
- Produces: `npm test` runs Node's built-in test runner.

- [ ] **Step 1: Add the `googleapis` dependency and test script to `package.json`**

```json
{
  "name": "htm-game-clock",
  "version": "1.0.0",
  "description": "HTM Escape Room Game Clock",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder",
    "test": "node --test"
  },
  "build": {
    "appId": "com.htm.gameclock",
    "productName": "HTM Game Clock",
    "win": { "target": "nsis" },
    "mac": { "target": "dmg" },
    "linux": { "target": "AppImage" }
  },
  "dependencies": {
    "googleapis": "^144.0.0"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
google-credentials.json
config.json
```

(`config.json` is runtime data written by `server.js`'s `/config` endpoint — it shouldn't be source-controlled, matching how `tracker/data/*.json` is excluded in the GameTracker repo.)

- [ ] **Step 3: Write a smoke test to confirm the test runner works**

`test/smoke.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 4: Install dependencies and run the smoke test**

Run: `npm install && npm test`
Expected: `googleapis` installs, smoke test passes (1 pass, 0 fail).

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore test/smoke.test.js
git commit -m "Add googleapis dependency and node:test runner"
```

---

### Task 2: `session-tracker.js` — pure session state machine

**Files:**
- Create: `session-tracker.js`
- Test: `test/session-tracker.test.js`

**Interfaces:**
- Produces:
  - `createSession({ startTime, room, operator, teamName, newPlayers, experiencedPlayers })` → session object
  - `applyAdjustment(session, type)` where `type` is one of `'add-min' | 'sub-min' | 'add-sec' | 'sub-sec'` → mutates and returns `session`
  - `applyHint(session, text, time)` → mutates and returns `session`, also returns the hint record `{ text, time }` for the caller to log separately
  - `updateField(session, field, value)` where `field` is one of `'teamName' | 'operator' | 'newPlayers' | 'experiencedPlayers' | 'notes'` → mutates and returns `session`
  - `finalizeSession(session, endTime, status)` where `status` is `'Escaped' | 'Reset-Lost'` → mutates and returns `session`
  - Session shape: `{ startTime, room, operator, teamName, newPlayers, experiencedPlayers, notes, adjustments: [{type, time}], hints: [{text, time}], endTime, duration, status }`
  - `duration` is only set by `finalizeSession` (milliseconds, `endTime - startTime`).

- [ ] **Step 1: Write failing tests for `createSession` and `applyAdjustment`**

`test/session-tracker.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSession, applyAdjustment, applyHint, updateField, finalizeSession,
} = require('../session-tracker');

test('createSession sets initial fields and empty logs', () => {
  const s = createSession({
    startTime: 1000, room: 'Nibiru', operator: 'Alex',
    teamName: 'The Wanderers', newPlayers: 2, experiencedPlayers: 1,
  });
  assert.equal(s.startTime, 1000);
  assert.equal(s.room, 'Nibiru');
  assert.equal(s.operator, 'Alex');
  assert.equal(s.teamName, 'The Wanderers');
  assert.equal(s.newPlayers, 2);
  assert.equal(s.experiencedPlayers, 1);
  assert.equal(s.notes, '');
  assert.deepEqual(s.adjustments, []);
  assert.deepEqual(s.hints, []);
  assert.equal(s.endTime, null);
  assert.equal(s.duration, null);
  assert.equal(s.status, null);
});

test('applyAdjustment records each adjustment with a type and time', () => {
  const s = createSession({ startTime: 1000, room: 'Nibiru' });
  applyAdjustment(s, 'add-min', 2000);
  applyAdjustment(s, 'sub-sec', 3000);
  assert.deepEqual(s.adjustments, [
    { type: 'add-min', time: 2000 },
    { type: 'sub-sec', time: 3000 },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../session-tracker'`

- [ ] **Step 3: Implement `createSession` and `applyAdjustment`**

`session-tracker.js`:
```js
function createSession({ startTime, room, operator = '', teamName = '', newPlayers = 0, experiencedPlayers = 0 }) {
  return {
    startTime,
    room,
    operator,
    teamName,
    newPlayers,
    experiencedPlayers,
    notes: '',
    adjustments: [],
    hints: [],
    endTime: null,
    duration: null,
    status: null,
  };
}

function applyAdjustment(session, type, time) {
  session.adjustments.push({ type, time });
  return session;
}

module.exports = { createSession, applyAdjustment };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 5: Write failing tests for `applyHint`, `updateField`, `finalizeSession`**

Append to `test/session-tracker.test.js`:
```js
test('applyHint records the hint and returns the record', () => {
  const s = createSession({ startTime: 1000, room: 'Nibiru' });
  const record = applyHint(s, 'Check the drawer', 5000);
  assert.deepEqual(record, { text: 'Check the drawer', time: 5000 });
  assert.deepEqual(s.hints, [{ text: 'Check the drawer', time: 5000 }]);
});

test('updateField sets an editable field', () => {
  const s = createSession({ startTime: 1000, room: 'Nibiru' });
  updateField(s, 'notes', 'Group is stuck on puzzle 2');
  updateField(s, 'teamName', 'The Wanderers');
  updateField(s, 'newPlayers', 3);
  assert.equal(s.notes, 'Group is stuck on puzzle 2');
  assert.equal(s.teamName, 'The Wanderers');
  assert.equal(s.newPlayers, 3);
});

test('updateField rejects an unknown field', () => {
  const s = createSession({ startTime: 1000, room: 'Nibiru' });
  assert.throws(() => updateField(s, 'bogus', 'x'), /Unknown session field: bogus/);
});

test('finalizeSession sets endTime, duration, and status', () => {
  const s = createSession({ startTime: 1000, room: 'Nibiru' });
  finalizeSession(s, 61000, 'Escaped');
  assert.equal(s.endTime, 61000);
  assert.equal(s.duration, 60000);
  assert.equal(s.status, 'Escaped');
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `applyHint is not a function` (and similar for the other two)

- [ ] **Step 7: Implement `applyHint`, `updateField`, `finalizeSession`**

Extend `session-tracker.js`:
```js
function applyHint(session, text, time) {
  const record = { text, time };
  session.hints.push(record);
  return record;
}

const EDITABLE_FIELDS = ['teamName', 'operator', 'newPlayers', 'experiencedPlayers', 'notes'];

function updateField(session, field, value) {
  if (!EDITABLE_FIELDS.includes(field)) {
    throw new Error('Unknown session field: ' + field);
  }
  session[field] = value;
  return session;
}

function finalizeSession(session, endTime, status) {
  session.endTime = endTime;
  session.duration = endTime - session.startTime;
  session.status = status;
  return session;
}

module.exports = {
  createSession, applyAdjustment, applyHint, updateField, finalizeSession,
};
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (6 tests)

- [ ] **Step 9: Commit**

```bash
git add session-tracker.js test/session-tracker.test.js
git commit -m "Add pure session-tracker state machine with tests"
```

---

### Task 3: `sheets.js` — formatting helpers (pure, unit-tested)

**Files:**
- Create: `sheets.js`
- Test: `test/sheets.test.js`

**Interfaces:**
- Consumes: session object shape from Task 2 (`session-tracker.js`).
- Produces:
  - `formatDuration(ms)` → `"HH:MM:SS"` string
  - `formatNetAdjustment(adjustments)` → signed `"+MM:SS"` / `"-MM:SS"` string (net of all `add-min`/`sub-min`/`add-sec`/`sub-sec` entries; each `*-min` is ±60s, each `*-sec` is ±1s — this must match the actual per-press deltas used by `game.js`'s existing add-min/sub-min/add-sec/sub-sec handlers)
  - `buildSessionRow(session)` → array of 14 cell values matching the Game Sessions column order from the spec: `[Date, Start Time, Room, Operator, Team Name, New Players, Experienced Players, End Time, Duration, Status, # Time Adjustments, Net Time Adjusted, Hint Count, Notes]`
  - `buildHintRow(hintRecord, session)` → array of 4 cell values: `[Date, Time, Hint Text, Session Start Time]`

- [ ] **Step 1: Write failing tests for `formatDuration` and `formatNetAdjustment`**

`test/sheets.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration, formatNetAdjustment, buildSessionRow, buildHintRow } = require('../sheets');

test('formatDuration formats milliseconds as HH:MM:SS', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(61000), '00:01:01');
  assert.equal(formatDuration(3661000), '01:01:01');
});

test('formatNetAdjustment sums add/sub min/sec into a signed MM:SS string', () => {
  assert.equal(formatNetAdjustment([]), '+00:00');
  assert.equal(formatNetAdjustment([{ type: 'add-min' }, { type: 'add-min' }]), '+02:00');
  assert.equal(formatNetAdjustment([{ type: 'sub-min' }, { type: 'add-sec' }]), '-00:59');
  assert.equal(formatNetAdjustment([{ type: 'add-sec' }, { type: 'sub-sec' }]), '+00:00');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../sheets'`

- [ ] **Step 3: Implement `formatDuration` and `formatNetAdjustment`**

`sheets.js`:
```js
function pad(n) { return String(n).padStart(2, '0'); }

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return pad(h) + ':' + pad(m) + ':' + pad(s);
}

const ADJUSTMENT_DELTA_SEC = {
  'add-min': 60,
  'sub-min': -60,
  'add-sec': 1,
  'sub-sec': -1,
};

function formatNetAdjustment(adjustments) {
  const netSec = adjustments.reduce((sum, a) => sum + (ADJUSTMENT_DELTA_SEC[a.type] || 0), 0);
  const sign = netSec < 0 ? '-' : '+';
  const abs = Math.abs(netSec);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return sign + pad(m) + ':' + pad(s);
}

module.exports = { formatDuration, formatNetAdjustment };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (2 tests, plus Task 2's tests still passing)

- [ ] **Step 5: Write failing tests for `buildSessionRow` and `buildHintRow`**

Append to `test/sheets.test.js`:
```js
test('buildSessionRow produces columns in spec order', () => {
  const session = {
    startTime: new Date('2026-08-22T18:00:00Z').getTime(),
    room: 'Nibiru',
    operator: 'Alex',
    teamName: 'The Wanderers',
    newPlayers: 2,
    experiencedPlayers: 1,
    notes: 'Stuck on puzzle 2',
    adjustments: [{ type: 'add-min' }],
    hints: [{ text: 'a' }, { text: 'b' }],
    endTime: new Date('2026-08-22T19:00:00Z').getTime(),
    duration: 3600000,
    status: 'Escaped',
  };
  const row = buildSessionRow(session);
  assert.equal(row.length, 14);
  assert.equal(row[2], 'Nibiru');       // Room
  assert.equal(row[3], 'Alex');         // Operator
  assert.equal(row[4], 'The Wanderers');// Team Name
  assert.equal(row[5], 2);              // New Players
  assert.equal(row[6], 1);              // Experienced Players
  assert.equal(row[8], '01:00:00');     // Duration
  assert.equal(row[9], 'Escaped');      // Status
  assert.equal(row[10], 1);             // # Time Adjustments
  assert.equal(row[11], '+01:00');      // Net Time Adjusted
  assert.equal(row[12], 2);             // Hint Count
  assert.equal(row[13], 'Stuck on puzzle 2'); // Notes
});

test('buildHintRow produces [Date, Time, Hint Text, Session Start Time]', () => {
  const session = { startTime: new Date('2026-08-22T18:00:00Z').getTime() };
  const hintRecord = { text: 'Check the drawer', time: new Date('2026-08-22T18:05:00Z').getTime() };
  const row = buildHintRow(hintRecord, session);
  assert.equal(row.length, 4);
  assert.equal(row[2], 'Check the drawer');
  assert.equal(row[3], new Date(session.startTime).toLocaleTimeString());
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `buildSessionRow is not a function`

- [ ] **Step 7: Implement `buildSessionRow` and `buildHintRow`**

Extend `sheets.js`:
```js
function buildSessionRow(session) {
  const start = new Date(session.startTime);
  const end = session.endTime ? new Date(session.endTime) : null;
  return [
    start.toLocaleDateString(),                          // Date
    start.toLocaleTimeString(),                           // Start Time
    session.room || '',                                   // Room
    session.operator || '',                                // Operator
    session.teamName || '',                                // Team Name
    session.newPlayers || 0,                                // New Players
    session.experiencedPlayers || 0,                        // Experienced Players
    end ? end.toLocaleTimeString() : '',                    // End Time
    session.duration != null ? formatDuration(session.duration) : '', // Duration
    session.status || '',                                   // Status
    session.adjustments.length,                             // # Time Adjustments
    formatNetAdjustment(session.adjustments),                // Net Time Adjusted
    session.hints.length,                                    // Hint Count
    session.notes || '',                                     // Notes
  ];
}

function buildHintRow(hintRecord, session) {
  const at = new Date(hintRecord.time);
  return [
    at.toLocaleDateString(),
    at.toLocaleTimeString(),
    hintRecord.text,
    new Date(session.startTime).toLocaleTimeString(),
  ];
}

module.exports = {
  formatDuration, formatNetAdjustment, buildSessionRow, buildHintRow,
};
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (4 new tests; 12 total across the suite)

- [ ] **Step 9: Commit**

```bash
git add sheets.js test/sheets.test.js
git commit -m "Add pure Sheets row-formatting helpers with tests"
```

---

### Task 4: `sheets.js` — Google Sheets API client (auth, append, update, read)

**Files:**
- Modify: `sheets.js`

**Interfaces:**
- Consumes: `googleapis` package (Task 1), `formatDuration`/`formatNetAdjustment`/`buildSessionRow`/`buildHintRow` (Task 3, unchanged).
- Produces:
  - `createSheetsClient(credentialsPath)` → `sheetsAPI` object or `null` if the file doesn't exist
  - `async appendRow(sheetsAPI, spreadsheetId, tabName, rowValues)` → `{ rowIndex }` (1-based sheet row number)
  - `async updateRow(sheetsAPI, spreadsheetId, tabName, rowIndex, rowValues)` → `void`
  - `async readColumn(sheetsAPI, spreadsheetId, tabName, column, startRow)` → `string[]`
  - `parseRowIndexFromUpdatedRange(updatedRange)` → integer (pure helper, unit-tested; extracted so the append-row-index logic is testable without a real network call)

This step has no automated test for the network-calling functions themselves (they wrap a real external API) — `parseRowIndexFromUpdatedRange` carries the only logic worth unit-testing here; the rest is verified manually in Task 9's end-to-end check.

- [ ] **Step 1: Write a failing test for `parseRowIndexFromUpdatedRange`**

Append to `test/sheets.test.js`:
```js
const { parseRowIndexFromUpdatedRange } = require('../sheets');

test('parseRowIndexFromUpdatedRange extracts the row number from an A1 range', () => {
  assert.equal(parseRowIndexFromUpdatedRange("'Sessions'!A15:N15"), 15);
  assert.equal(parseRowIndexFromUpdatedRange("'Hints'!A2:D2"), 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `parseRowIndexFromUpdatedRange is not a function`

- [ ] **Step 3: Implement the Sheets API client functions**

Extend `sheets.js` (add near the top, after `pad`):
```js
const fs = require('fs');
const { google } = require('googleapis');

function createSheetsClient(credentialsPath) {
  if (!fs.existsSync(credentialsPath)) return null;
  const auth = new google.auth.GoogleAuth({
    keyFile: credentialsPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function parseRowIndexFromUpdatedRange(updatedRange) {
  const match = updatedRange.match(/![A-Z]+(\d+):/);
  if (!match) throw new Error('Could not parse row index from range: ' + updatedRange);
  return parseInt(match[1], 10);
}

async function appendRow(sheetsAPI, spreadsheetId, tabName, rowValues) {
  const response = await sheetsAPI.spreadsheets.values.append({
    spreadsheetId,
    range: tabName + '!A1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] },
  });
  const rowIndex = parseRowIndexFromUpdatedRange(response.data.updates.updatedRange);
  return { rowIndex };
}

async function updateRow(sheetsAPI, spreadsheetId, tabName, rowIndex, rowValues) {
  const endCol = String.fromCharCode('A'.charCodeAt(0) + rowValues.length - 1);
  await sheetsAPI.spreadsheets.values.update({
    spreadsheetId,
    range: tabName + '!A' + rowIndex + ':' + endCol + rowIndex,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowValues] },
  });
}

async function readColumn(sheetsAPI, spreadsheetId, tabName, column, startRow) {
  const response = await sheetsAPI.spreadsheets.values.get({
    spreadsheetId,
    range: tabName + '!' + column + startRow + ':' + column,
  });
  return (response.data.values || []).map(row => row[0]).filter(Boolean);
}

module.exports = {
  formatDuration, formatNetAdjustment, buildSessionRow, buildHintRow,
  createSheetsClient, parseRowIndexFromUpdatedRange, appendRow, updateRow, readColumn,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (13 tests total)

- [ ] **Step 5: Commit**

```bash
git add sheets.js test/sheets.test.js
git commit -m "Add Google Sheets API client wrapper to sheets.js"
```

---

### Task 5: Config schema — Game Sheets fields

**Files:**
- Modify: `config.html:130-155` (insert new card after the Timer card, before Logo)

**Interfaces:**
- Produces: `config.json` (via existing `POST /config`) gains these fields, all strings, all defaulting to `''` when unset:
  - `roomName`
  - `sessionsSpreadsheetId`, `sessionsTabName`
  - `hintsSpreadsheetId`, `hintsTabName`, `hotkeysTabName`
- Consumes: existing `fetchConfig()`/`saveConfig()`/`populateForm()` pattern already in `config.html`.

- [ ] **Step 1: Add the "Game Sheets" card HTML**

Insert into `config.html`, right after the closing `</div>` of the Timer card (currently ending around line 155) and before the `<!-- Logo -->` comment:

```html
<!-- Game Sheets -->
<div class="card">
  <h2>Game Sheets</h2>
  <div class="field-row">
    <label>Room name</label>
    <input type="text" id="room-name" placeholder="e.g. Nibiru" />
  </div>
  <div class="field-row" style="margin-top:10px;padding-top:10px;border-top:1px solid #0f3460;">
    <label>Sessions spreadsheet ID</label>
    <input type="text" id="sessions-spreadsheet-id" placeholder="Google Sheet ID" />
  </div>
  <div class="field-row">
    <label>Sessions tab name</label>
    <input type="text" id="sessions-tab-name" placeholder="e.g. Sessions" />
  </div>
  <div class="field-row" style="margin-top:10px;padding-top:10px;border-top:1px solid #0f3460;">
    <label>Hints spreadsheet ID</label>
    <input type="text" id="hints-spreadsheet-id" placeholder="Google Sheet ID" />
  </div>
  <div class="field-row">
    <label>Hints tab name</label>
    <input type="text" id="hints-tab-name" placeholder="e.g. Nibiru-Hints" />
  </div>
  <div class="field-row">
    <label>Hotkeys tab name</label>
    <input type="text" id="hotkeys-tab-name" placeholder="e.g. Hotkeys" />
  </div>
</div>
```

- [ ] **Step 2: Read the new fields in `populateForm(cfg)`**

In `config.html`'s `populateForm` function (around line 431), add after the existing `logoPathEl.value = cfg.logoPath || '';` line:

```js
  document.getElementById('room-name').value = cfg.roomName || '';
  document.getElementById('sessions-spreadsheet-id').value = cfg.sessionsSpreadsheetId || '';
  document.getElementById('sessions-tab-name').value = cfg.sessionsTabName || '';
  document.getElementById('hints-spreadsheet-id').value = cfg.hintsSpreadsheetId || '';
  document.getElementById('hints-tab-name').value = cfg.hintsTabName || '';
  document.getElementById('hotkeys-tab-name').value = cfg.hotkeysTabName || '';
```

- [ ] **Step 3: Write the new fields in the Save handler**

In `config.html`'s save button handler (around line 452), add to the `saved` object literal:

```js
  const saved = {
    timerMinutes:     parseInt(document.getElementById('timer-minutes').value) || 60,
    hintCycleSeconds: parseInt(document.getElementById('hint-cycle-seconds').value) || 5,
    volume:           parseInt(volSlider.value) / 100,
    logoPath:         logoPathEl.value.trim(),
    startStopKey:     startStopCapture.dataset.key || '',
    hintGroups:       readGroupsFromDOM(),
    roomName:                document.getElementById('room-name').value.trim(),
    sessionsSpreadsheetId:   document.getElementById('sessions-spreadsheet-id').value.trim(),
    sessionsTabName:         document.getElementById('sessions-tab-name').value.trim(),
    hintsSpreadsheetId:      document.getElementById('hints-spreadsheet-id').value.trim(),
    hintsTabName:            document.getElementById('hints-tab-name').value.trim(),
    hotkeysTabName:          document.getElementById('hotkeys-tab-name').value.trim(),
  };
```

- [ ] **Step 4: Manually verify in a browser**

Run: `node server.js`, open `http://localhost:4000/config.html`, fill in the new "Game Sheets" fields, click Save, reload the page.
Expected: all six new fields retain their values after reload (confirms round-trip through `GET`/`POST /config` and `config.json`).

- [ ] **Step 5: Commit**

```bash
git add config.html
git commit -m "Add Game Sheets config fields to config.html"
```

---

### Task 6: Wire session tracking into `server.js`

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `session-tracker.js` (Task 2: `createSession`, `applyAdjustment`, `applyHint`, `updateField`, `finalizeSession`), `sheets.js` (Tasks 3-4: `createSheetsClient`, `appendRow`, `updateRow`, `buildSessionRow`, `buildHintRow`).
- Produces: on the running server, every `/cmd` POST with `type` in `start`, `add-min`, `sub-min`, `add-sec`, `sub-sec`, `show-hint`, `escaped`, `reset` now also updates Sheets as described in the spec's "Write timing" section.

- [ ] **Step 1: Add the session-tracker/sheets wiring to `server.js`**

At the top of `server.js`, after the existing `const CONFIG_FILE = ...` line (line 9), add:

```js
const {
  createSession, applyAdjustment, applyHint, updateField, finalizeSession,
} = require('./session-tracker');
const {
  createSheetsClient, appendRow, updateRow, buildSessionRow, buildHintRow,
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
```

- [ ] **Step 2: Call `handleGameCommand` from the existing `/cmd` handler**

In `server.js`'s `POST /cmd` block (around line 84-94), change:

```js
  if (url === '/cmd' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const msg  = JSON.parse(body);
      broadcast(msg);
      res.writeHead(204); res.end();
    } catch(e) {
      res.writeHead(400); res.end('Bad JSON');
    }
    return;
  }
```

to:

```js
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
```

(Response is sent before `handleGameCommand` runs so Sheets latency never delays the operator's UI — matches the "never block the in-browser game" constraint.)

- [ ] **Step 3: Manually verify end-to-end with a test spreadsheet**

Prerequisites: copy a `google-credentials.json` service account key into the app root (see Task 9), share a test Google Sheet with that service account's email, and set `sessionsSpreadsheetId`/`sessionsTabName` (and hints equivalents) in `config.html` to that test sheet.

Run: `node server.js`, open `http://localhost:4000/operator.html`, click Start, click "add 1 min" once, trigger a hint, click Escaped.
Expected: a new row appears in the test sheet's Sessions tab immediately after Start (Room filled in, rest blank), updates in place after the add-min and hint, and shows final Duration/Status/Hint Count after Escaped. A row also appears in the Hints tab immediately when the hint was triggered.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "Wire session-tracker and Sheets logging into the /cmd handler"
```

---

### Task 7: Operator screen — new fields (Team Name, Operator, player counts, Notes)

**Files:**
- Modify: `operator.html` (add form fields near the existing hint/status UI)
- Modify: `operator.js`
- Modify: `server.js` (add `GET /api/operators`)

**Interfaces:**
- Consumes: `session-tracker.js`'s `updateField` (Task 2, already wired via `handleGameCommand` for the `update-field` command type added below), `sheets.js`'s `readColumn` (Task 4).
- Produces: `cmd('update-field', { field, value })` — a new command type handled by `handleGameCommand` in `server.js`; `GET /api/operators` → `{ operators: string[] }`.

- [ ] **Step 1: Add `update-field` handling to `handleGameCommand` in `server.js`**

In `server.js`'s `handleGameCommand` (Task 6), add this branch just before the `escaped`/`reset` block:

```js
  if (msg.type === 'update-field') {
    updateField(currentSession, msg.field, msg.value);
    await syncSessionRow(cfg, sessionsReady);
    return;
  }
```

- [ ] **Step 2: Add `GET /api/operators` to `server.js`**

Add near the existing `GET /config` block:

```js
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
```

Add `readColumn` to the `sheets.js` import list at the top of `server.js` (it's already exported from Task 4 — just add it to the destructured `require('./sheets')`).

- [ ] **Step 3: Add an `operatorsSpreadsheetId` config field**

In `config.html`'s Game Sheets card (Task 5), add one more field and wire it through `populateForm`/save the same way as the others:

```html
  <div class="field-row" style="margin-top:10px;padding-top:10px;border-top:1px solid #0f3460;">
    <label>Operators spreadsheet ID</label>
    <input type="text" id="operators-spreadsheet-id" placeholder="Tracker's spreadsheet ID (Drop Down options tab)" />
  </div>
```
Populate: `document.getElementById('operators-spreadsheet-id').value = cfg.operatorsSpreadsheetId || '';`
Save: `operatorsSpreadsheetId: document.getElementById('operators-spreadsheet-id').value.trim(),`

- [ ] **Step 4: Add the new fields to `operator.html`**

Add a new card to `operator.html` (place near the top of the operator panel, above the hints list — check the existing layout for the right insertion point) with this markup:

```html
<div class="card" id="session-info-card">
  <h2>Session Info</h2>
  <div class="field-row">
    <label>Team name</label>
    <input type="text" id="team-name-input" placeholder="Team name" />
  </div>
  <div class="field-row">
    <label>Operator</label>
    <select id="operator-select"><option value="">— select —</option></select>
  </div>
  <div class="field-row">
    <label>New players</label>
    <input type="number" id="new-players-input" min="0" value="0" style="width:60px;" />
  </div>
  <div class="field-row">
    <label>Experienced players</label>
    <input type="number" id="experienced-players-input" min="0" value="0" style="width:60px;" />
  </div>
  <div class="field-row">
    <label>Notes</label>
    <textarea id="notes-input" rows="3" style="flex:1;background:#0f3460;border:1px solid #1a4a80;color:#fff;border-radius:6px;padding:5px 9px;"></textarea>
  </div>
</div>
```

- [ ] **Step 5: Wire the new fields in `operator.js` with debounced saves**

Add to `operator.js`, after the existing `cmd()` function definition:

```js
// ── Session info fields (debounced live-sync to Sheets) ────────────────────────
let debounceTimers = {};
function debouncedUpdateField(field, value) {
  clearTimeout(debounceTimers[field]);
  debounceTimers[field] = setTimeout(() => cmd('update-field', { field, value }), 5000);
}

document.getElementById('team-name-input').addEventListener('input', (e) => {
  debouncedUpdateField('teamName', e.target.value);
});
document.getElementById('operator-select').addEventListener('change', (e) => {
  cmd('update-field', { field: 'operator', value: e.target.value }); // immediate, not debounced — infrequent, deliberate action
});
document.getElementById('new-players-input').addEventListener('input', (e) => {
  debouncedUpdateField('newPlayers', parseInt(e.target.value) || 0);
});
document.getElementById('experienced-players-input').addEventListener('input', (e) => {
  debouncedUpdateField('experiencedPlayers', parseInt(e.target.value) || 0);
});
document.getElementById('notes-input').addEventListener('input', (e) => {
  debouncedUpdateField('notes', e.target.value);
});

async function loadOperators() {
  try {
    const r = await fetch('/api/operators');
    const { operators } = await r.json();
    const select = document.getElementById('operator-select');
    operators.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      select.appendChild(opt);
    });
  } catch (e) {}
}
loadOperators();
```

- [ ] **Step 6: Manually verify in a browser**

Run: `node server.js`, open `http://localhost:4000/operator.html`.
Expected: the Operator dropdown populates (empty if `operatorsSpreadsheetId` isn't configured — no error thrown). Typing in Team Name/Notes/player counts doesn't error; after 5s idle, check server console/log or the test sheet (if a session is active) to confirm the debounced update fired.

- [ ] **Step 7: Commit**

```bash
git add server.js config.html operator.html operator.js
git commit -m "Add Team Name, Operator, player count, and Notes fields to operator screen"
```

---

### Task 8: Hotkeys reference tab sync

**Files:**
- Modify: `server.js` (extend the `POST /config` handler)
- Modify: `sheets.js` (add `buildHotkeysRows`)

**Interfaces:**
- Consumes: `cfg.hintGroups` (existing config shape: `[{ name, hints: [{ text, key }] }]`), `sheets.js`'s `updateRow`/`appendRow`.
- Produces: `buildHotkeysRows(hintGroups)` → `string[][]` (pure, unit-tested); on every config save, the Hotkeys tab is fully rewritten (clear + re-append) to mirror current hint config.

- [ ] **Step 1: Write a failing test for `buildHotkeysRows`**

Append to `test/sheets.test.js`:
```js
const { buildHotkeysRows } = require('../sheets');

test('buildHotkeysRows flattens hint groups into [Group, Key, Hint Text] rows', () => {
  const hintGroups = [
    { name: 'Kitchen', hints: [{ text: 'Check the oven', key: 'F1' }, { text: 'Look under the sink', key: 'F2' }] },
    { name: 'Study', hints: [{ text: 'Try the bookshelf', key: 'F3' }] },
  ];
  const rows = buildHotkeysRows(hintGroups);
  assert.deepEqual(rows, [
    ['Kitchen', 'F1', 'Check the oven'],
    ['Kitchen', 'F2', 'Look under the sink'],
    ['Study', 'F3', 'Try the bookshelf'],
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildHotkeysRows is not a function`

- [ ] **Step 3: Implement `buildHotkeysRows`**

Add to `sheets.js`, export it in the final `module.exports`:

```js
function buildHotkeysRows(hintGroups) {
  const rows = [];
  (hintGroups || []).forEach(group => {
    (group.hints || []).forEach(hint => {
      rows.push([group.name || '', hint.key || '', hint.text || '']);
    });
  });
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (14 tests total)

- [ ] **Step 5: Sync the Hotkeys tab on config save in `server.js`**

In `server.js`'s `POST /config` handler, add the sync call after `saveConfig(cfg)`:

```js
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
```

Add the `syncHotkeysTab` function near `handleGameCommand`:

```js
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
```

Add `buildHotkeysRows` to the `sheets.js` import destructuring at the top of `server.js`.

- [ ] **Step 6: Manually verify in a browser**

Prerequisite: create a "Hotkeys" tab (or whatever name is configured) with a header row (`Group | Key | Hint Text`) in the test Hints spreadsheet.
Run: `node server.js`, open `http://localhost:4000/config.html`, add a hint group with a couple of hints, Save.
Expected: the Hotkeys tab's rows below the header match the saved hint groups exactly.

- [ ] **Step 7: Commit**

```bash
git add sheets.js test/sheets.test.js server.js
git commit -m "Sync Hotkeys reference tab whenever hint config is saved"
```

---

### Task 9: Deploy — install step, credentials, docs

**Files:**
- Modify: `setup-pi.sh`
- Modify: `update.sh`

**Interfaces:**
- Consumes: nothing new — this task only touches shell scripts.
- Produces: `npm install` runs on every setup/update; setup output reminds the operator to place `google-credentials.json`.

- [ ] **Step 1: Add `npm install` to `setup-pi.sh`**

In `setup-pi.sh`, right after the `echo "  Repository up to date."` block and before the "Assets reminder" section, add:

```bash
# ── Install dependencies ──────────────────────────────────────────────────────
echo ""
echo "  Installing npm dependencies..."
cd "$INSTALL_DIR"
npm install --omit=dev
```

- [ ] **Step 2: Add a Google credentials reminder to `setup-pi.sh`**

Right after the existing "Assets reminder" block, add:

```bash
# ── Google Sheets credentials reminder ────────────────────────────────────────
echo ""
if [ ! -f "$INSTALL_DIR/google-credentials.json" ]; then
  echo "  [!] No google-credentials.json found — Sheets logging is disabled until"
  echo "      you copy a service-account key to:"
  echo "        $INSTALL_DIR/google-credentials.json"
  echo "      Then configure the spreadsheet IDs/tab names at http://<pi>/room-control/config.html"
fi
```

- [ ] **Step 3: Add `npm install` to `update.sh`**

In `update.sh`, after the `git pull origin "$BRANCH"` line and before the `pm2` restart block, add:

```bash
echo "[$(date)] Installing npm dependencies..."
npm install --omit=dev
```

- [ ] **Step 4: Manually verify on the Pi**

Run (on the Pi, via SSH): `cd ~/HTM-Control-Basic && bash setup-pi.sh` (choosing "n" for the nginx re-prompt since it's already configured), then check `node_modules/googleapis` exists.
Expected: `npm install` completes without error; the credentials reminder prints since no `google-credentials.json` exists there yet.

- [ ] **Step 5: Commit**

```bash
git add setup-pi.sh update.sh
git commit -m "Install npm dependencies and remind about Sheets credentials on deploy"
```

---

## Self-Review Notes

- **Spec coverage:** Game Sessions row (Task 3/6), Hint Library event log (Task 3/6), Hotkeys reference tab (Task 8), incremental/debounced writes (Task 6/7), operator UI fields (Task 7), config UI fields (Task 5), credentials/deploy (Task 9), silent no-op when unconfigured (Task 6's `sessionsReady`/`hintsReady` guards and Task 7's `/api/operators` empty-array fallback) — all covered.
- **Type consistency:** `session` object shape defined once in Task 2 and consumed unchanged by `sheets.js` (Task 3/4) and `server.js` (Task 6/7) — field names (`startTime`, `room`, `operator`, `teamName`, `newPlayers`, `experiencedPlayers`, `notes`, `adjustments`, `hints`, `endTime`, `duration`, `status`) match everywhere they're used.
- **Config field names** (`roomName`, `sessionsSpreadsheetId`, `sessionsTabName`, `hintsSpreadsheetId`, `hintsTabName`, `hotkeysTabName`, `operatorsSpreadsheetId`) are consistent between Task 5's `config.html` and Task 6/7/8's `server.js` reads.
