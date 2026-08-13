'use strict';
// Tiny JSON-file store for registration metadata (display name, timestamp).
// The broker (dynsec) is the source of truth for who exists; this is just context.

const fs = require('fs');
const path = require('path');

const FILE = process.env.STORE_FILE || path.join(__dirname, '..', 'data', 'registrations.json');

function _load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return {}; }
}
function _save(obj) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';   // atomic write: temp then rename
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, FILE);
}

function record(username, displayName, isoDate, privacyNoticeVersion = '') {
  const db = _load();
  db[username] = { displayName: displayName || '', createdAt: isoDate, privacyNoticeVersion };
  _save(db);
}
function remove(username) {
  const db = _load();
  delete db[username];
  _save(db);
}
function setDisabled(username, val) {
  const db = _load();
  if (!db[username]) db[username] = { displayName: '', createdAt: '' };
  db[username].disabled = !!val;
  _save(db);
}
function meta(username) {
  return _load()[username] || { displayName: '', createdAt: '', disabled: false };
}
function entries() { return Object.entries(_load()).map(([username, value]) => ({ username, ...value })); }

module.exports = { record, remove, setDisabled, meta, entries };
