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
const _health = { ready: false, connected: false, subscribed: false, lastError: null };

function devices() {
  return Object.keys(_status).sort().map((u) => ({ username: u, ...(_status[u]) }));
}

function status() { return { ..._health }; }

// Give the admin account the 'observer' role so it may subscribe to devices/#.
function grantObserver(c) {
  return new Promise((resolve, reject) => {
    execFile('mosquitto_ctrl',
      ['-h', c.host, '-p', String(c.port), '-u', c.admin, '-P', c.pass, 'dynsec', 'addClientRole', c.admin, 'observer'],
      { timeout: 8000 }, (err, stdout, stderr) => {
        if (err && !/already (has|exists)/i.test(String(stderr || err.message))) return reject(new Error(String(stderr || err.message).trim()));
        resolve();
      });
  });
}

async function start() {
  const c = cfg();
  if (c.mode === 'mock') {
    Object.assign(_health, { ready: true, connected: true, subscribed: true, lastError: null });
    return;
  }
  if (!c.pass) throw new Error('DYNSEC_ADMIN_PASS is missing');
  await grantObserver(c);
  _client = mqtt.connect('mqtt://' + c.host + ':' + c.port, {
    username: c.admin, password: c.pass, reconnectPeriod: 5000, clientId: 'portal-monitor',
  });
  _client.on('connect', () => {
    _health.connected = true;
    _health.lastError = null;
    _client.subscribe('devices/+/status', (err) => {
      _health.subscribed = !err;
      _health.ready = !err;
      if (err) _health.lastError = err.message;
    });
  });
  _client.on('message', (topic, payload) => {
    const m = /^devices\/([^/]+)\/status$/.exec(topic);
    if (m) _status[m[1]] = { status: String(payload) || 'unknown', at: new Date().toISOString() };
  });
  _client.on('close', () => { Object.assign(_health, { ready: false, connected: false, subscribed: false }); });
  _client.on('error', (err) => { _health.ready = false; _health.lastError = err.message; });
}

module.exports = { start, devices, status };
