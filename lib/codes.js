'use strict';
// Class-code store: a JSON file of active codes the admin manages from the UI.
// Seeds from the CLASS_CODE env var on first use (backward compatible).

const path = require('path');
const V = require('./validate');
const jsonfile = require('./jsonfile');

const FILE = process.env.CODES_FILE || path.join(__dirname, '..', 'data', 'classcodes.json');

function _save(list) {
  jsonfile.write(FILE, list);
}

function list() {
  const loaded = jsonfile.read(FILE);
  let l = loaded.value;
  if (!loaded.exists) {
    l = [];
    const seed = (process.env.CLASS_CODE || '').trim();
    if (seed) l.push({ code: seed, addedAt: new Date().toISOString() });
    _save(l);
  }
  if (!Array.isArray(l) || l.some((x) => !x || typeof x.code !== 'string'))
    throw new Error(`Invalid class-code store shape in ${FILE}`);
  return l;
}

function add(code) {
  code = String(code || '').trim();
  if (code.length < 3 || code.length > 64) return false;
  const l = list();
  if (l.some((x) => x.code === code)) return false;
  l.push({ code, addedAt: new Date().toISOString() });
  _save(l);
  return true;
}

function remove(code) {
  _save(list().filter((x) => x.code !== String(code)));
  return true;
}

// Constant-time check against any active code.
function isValid(input) {
  input = String(input || '');
  let ok = false;
  for (const x of list()) if (V.secretEquals(x.code, input)) ok = true;
  return ok;
}

module.exports = { list, add, remove, isValid, FILE };
