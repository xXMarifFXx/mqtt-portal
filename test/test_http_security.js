'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqtt-http-security-'));
const port = 3460 + (process.pid % 300);
const password = 'admin-password-123';
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 32).toString('hex');
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(port), DYNSEC_MODE: 'mock', COOKIE_SECURE: 'false',
    ADMIN_PASSWORD_HASH: salt.toString('hex') + ':' + hash,
    CLASS_CODE: 'CLASS1', CODES_FILE: path.join(dir, 'codes.json'), STORE_FILE: path.join(dir, 'store.json') },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const base = `http://127.0.0.1:${port}`;
(async () => {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(base + '/healthz')).ok) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(password) });
  assert.strictEqual(login.status, 302);
  const cookie = String(login.headers.get('set-cookie')).split(';')[0];
  const admin = await fetch(base + '/admin', { headers: { cookie } });
  assert.strictEqual(admin.status, 200);
  const html = await admin.text();
  const match = html.match(/name="_csrf" value="([0-9a-f]{64})"/);
  assert(match, 'admin form must contain CSRF token');

  const rejected = await fetch(base + '/admin/code/add', { method: 'POST', redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=NEWCLASS' });
  assert.strictEqual(rejected.status, 403, 'admin mutation without CSRF must fail');
  const accepted = await fetch(base + '/admin/code/add', { method: 'POST', redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: `code=NEWCLASS&_csrf=${match[1]}` });
  assert.strictEqual(accepted.status, 302, 'valid CSRF token must pass');
  console.log('admin HTTP CSRF integration test passed');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  child.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
});
