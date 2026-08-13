'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqtt-sessions-'));
const options = { path: dir, ttl: 60, secret: 'test-session-secret-that-is-long-enough', logFn: () => {} };
const first = new FileStore(options);
const call = (store, method, ...args) => new Promise((resolve, reject) => store[method](...args, (err, value) => err ? reject(err) : resolve(value)));

(async () => {
  await call(first, 'set', 'session-id', { cookie: { expires: new Date(Date.now() + 60000) }, admin: true, csrfToken: 'a'.repeat(64) });
  const second = new FileStore(options); // simulate a process restart/new store instance
  const restored = await call(second, 'get', 'session-id');
  assert(restored.admin && restored.csrfToken === 'a'.repeat(64));
  await call(second, 'destroy', 'session-id');
  await assert.rejects(call(first, 'get', 'session-id'), (e) => e && e.code === 'ENOENT');
  if (first.stopInterval) first.stopInterval();
  if (second.stopInterval) second.stopInterval();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('durable encrypted session-store tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
