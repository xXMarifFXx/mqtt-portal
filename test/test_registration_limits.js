'use strict';
// Starts a separate mock portal and proves >20 students behind one IP can register,
// while repeated wrong class codes are still throttled.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const privacy = require('../lib/privacy');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqtt-reg-limit-'));
const port = 3151 + (process.pid % 300);
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(port), DYNSEC_MODE: 'mock', COOKIE_SECURE: 'false',
    CLASS_CODE: 'CLASS1', CODES_FILE: path.join(dir, 'codes.json'), STORE_FILE: path.join(dir, 'store.json') },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const post = (body) => fetch(`http://127.0.0.1:${port}/register`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
});

(async () => {
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  for (let i = 0; i < 25; i++) {
    const user = 'student' + String(i).padStart(2, '0');
    const res = await post(`username=${user}&password=password123&classcode=CLASS1&privacy_notice=${privacy.NOTICE_VERSION}`);
    assert.strictEqual(res.status, 200, `valid shared-IP registration ${i + 1}`);
  }
  const noNotice = await post('username=nonotice&password=password123&classcode=CLASS1');
  assert.strictEqual(noNotice.status, 400, 'privacy notice acknowledgement is required');
  const noticePage = await fetch(`http://127.0.0.1:${port}/privacy`);
  assert.strictEqual(noticePage.status, 200);
  const noticeText = await noticePage.text();
  assert(noticeText.includes('Data collected') && noticeText.includes('180 days'));
  let last;
  for (let i = 0; i < 11; i++) last = await post(`username=wrong${i}&password=password123&classcode=BAD`);
  assert.strictEqual(last.status, 429, 'wrong class-code attempts should be throttled');
  console.log('classroom registration limit integration test passed');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  child.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
});
