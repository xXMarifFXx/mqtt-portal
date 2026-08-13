'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqtt-privacy-'));
const file = path.join(dir, 'registrations.json');
fs.writeFileSync(file, JSON.stringify({
  oldstudent: { createdAt: '2020-01-01T00:00:00Z', privacyNoticeVersion: 'old' },
  newstudent: { createdAt: new Date().toISOString(), privacyNoticeVersion: 'current' },
}));
const env = { ...process.env, STORE_FILE: file, DYNSEC_MODE: 'mock', DATA_RETENTION_DAYS: '180' };
const run = (args) => spawnSync(process.execPath, ['scripts/purge-expired.js', ...args], {
  cwd: path.join(__dirname, '..'), env, encoding: 'utf8',
});

const dry = run([]);
assert.strictEqual(dry.status, 0, dry.stderr);
assert(dry.stdout.includes('oldstudent') && dry.stdout.includes('Dry run only'));
assert(JSON.parse(fs.readFileSync(file)).oldstudent, 'dry run must not delete');

const applied = run(['--apply', '--yes']);
assert.strictEqual(applied.status, 0, applied.stderr);
const after = JSON.parse(fs.readFileSync(file));
assert(!after.oldstudent, 'expired account metadata should be deleted');
assert(after.newstudent, 'current account must remain');
fs.rmSync(dir, { recursive: true, force: true });
console.log('privacy retention dry-run/apply tests passed');
