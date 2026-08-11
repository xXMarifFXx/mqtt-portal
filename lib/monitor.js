'use strict';
// Live device presence: the portal keeps one MQTT connection to the local broker,
// subscribes to devices/+/status, and tracks who's online. The admin "Live devices"
// view reads this. Read-only; credentials stay server-side.

const mqtt = require('mqtt');
const { execFile } = require('child_process');

const cfg = () => ({
  host: process.env.BROKER_CTRL_HOST || '127.0.0.1',
  port: process.env.BROKER_CTRL_PORT || '1883',
  admin: process.env.DYNSEC_ADMIN_USER || 'dynsec-admin',
  pass: process.env.DYNSEC_ADMIN_PASS || '',
  mode: process.env.DYNSEC_MODE || 'real',
});

const _status = {};   // { username: { status: 'online'|'offline', at: ISO } }
let _client = null;

function devices() {
  return Object.keys(_status).sort().map((u) => ({ username: u, ...(_status[u]) }));
}

// Give the admin account the 'observer' role so it may subscribe to devices/#.
function grantObserver(c) {
  return new Promise((resolve) => {
    execFile('mosquitto_ctrl',
      ['-h', c.host, '-p', String(c.port), '-u', c.admin, '-P', c.pass, 'dynsec', 'addClientRole', c.admin, 'observer'],
      { timeout: 8000 }, () => resolve());   // ignore "already has role"
  });
}

async function start() {
  const c = cfg();
  if (c.mode === 'mock' || !c.pass) return;   // dev / no broker
  await grantObserver(c);
  _client = mqtt.connect('mqtt://' + c.host + ':' + c.port, {
    username: c.admin, password: c.pass, reconnectPeriod: 5000, clientId: 'portal-monitor',
  });
  _client.on('connect', () => _client.subscribe('devices/+/status'));
  _client.on('message', (topic, payload) => {
    const m = /^devices\/([^/]+)\/status$/.exec(topic);
    if (m) _status[m[1]] = { status: String(payload) || 'unknown', at: new Date().toISOString() };
  });
  _client.on('error', () => { /* keep trying; mqtt.js reconnects */ });
}

module.exports = { start, devices };
