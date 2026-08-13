'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqtt-portal-integrity-'));
process.env.STORE_FILE = path.join(dir, 'registrations.json');
process.env.CODES_FILE = path.join(dir, 'classcodes.json');
const store = require('../lib/store');
const codes = require('../lib/codes');

fs.writeFileSync(process.env.STORE_FILE, '{broken');
assert.throws(() => store.record('ada', '', new Date().toISOString()), /Refusing to overwrite unreadable JSON/);
assert.strictEqual(fs.readFileSync(process.env.STORE_FILE, 'utf8'), '{broken');

fs.writeFileSync(process.env.CODES_FILE, '{broken');
assert.throws(() => codes.add('CLASS1'), /Refusing to overwrite unreadable JSON/);
assert.strictEqual(fs.readFileSync(process.env.CODES_FILE, 'utf8'), '{broken');

fs.unlinkSync(process.env.CODES_FILE);
process.env.CLASS_CODE = 'SEED1';
assert.strictEqual(codes.list()[0].code, 'SEED1');
console.log('JSON integrity fail-closed tests passed');
