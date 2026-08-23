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
