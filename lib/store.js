'use strict';
// Tiny JSON-file store for registration metadata (display name, timestamp).
// The broker (dynsec) is the source of truth for who exists; this is just context.

const path = require('path');
const jsonfile = require('./jsonfile');

const FILE = process.env.STORE_FILE || path.join(__dirname, '..', 'data', 'registrations.json');

function _load() {
  const loaded = jsonfile.read(FILE);
  if (!loaded.exists) return {};
  if (!loaded.value || Array.isArray(loaded.value) || typeof loaded.value !== 'object')
    throw new Error(`Invalid registration store shape in ${FILE}`);
  return loaded.value;
}
function _save(obj) {
  jsonfile.write(FILE, obj);
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
