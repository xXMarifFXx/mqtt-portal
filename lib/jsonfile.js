'use strict';

const fs = require('fs');
const path = require('path');

function read(file) {
  try {
    return { exists: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { exists: false, value: undefined };
    const wrapped = new Error(`Refusing to overwrite unreadable JSON file ${file}: ${err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
}

module.exports = { read, write };
