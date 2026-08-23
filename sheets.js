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

function buildHotkeysRows(hintGroups) {
  const rows = [];
  (hintGroups || []).forEach(group => {
    (group.hints || []).forEach(hint => {
      rows.push([group.name || '', hint.key || '', hint.text || '']);
    });
  });
  return rows;
}

module.exports = {
  formatDuration, formatNetAdjustment, buildSessionRow, buildHintRow,
  createSheetsClient, parseRowIndexFromUpdatedRange, appendRow, updateRow, readColumn,
  buildHotkeysRows,
};
