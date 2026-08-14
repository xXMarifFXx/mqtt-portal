'use strict';
const assert = require('assert');
process.env.DYNSEC_MODE = 'mock';
process.env.COOKIE_SECURE = 'false';
const app = require('../server');
const fs = require('fs');

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const port = server.address().port;
    const text = await fetch(`http://127.0.0.1:${port}/console?u=ada`).then((r) => r.text());
    assert(text.includes('Your MQTT settings'));
    assert(text.includes('devices/ada/nodered/status'));
    assert(text.includes('id="nrstatus"'));
    assert(text.includes('.broker('), 'prefilled console should include Arduino sketch');
    const js = fs.readFileSync('public/console.js', 'utf8');
    assert(js.includes("addEventListener('input'"), 'settings should update while username is entered');
    assert(js.includes('prefill(username)'), 'Connect must synchronize settings with active username');
    console.log('MQTT console settings and Node-RED presence test passed');
  } finally { server.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
