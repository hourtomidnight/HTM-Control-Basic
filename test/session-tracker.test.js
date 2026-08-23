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
