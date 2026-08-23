const test = require('node:test');
const assert = require('node:assert/strict');
const { formatDuration, formatNetAdjustment, buildSessionRow, buildHintRow } = require('../sheets');
const { parseRowIndexFromUpdatedRange } = require('../sheets');

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

test('parseRowIndexFromUpdatedRange extracts the row number from an A1 range', () => {
  assert.equal(parseRowIndexFromUpdatedRange("'Sessions'!A15:N15"), 15);
  assert.equal(parseRowIndexFromUpdatedRange("'Hints'!A2:D2"), 2);
});
