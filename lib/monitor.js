'use strict';
// Live device presence: the portal keeps one MQTT connection to the local broker,
// subscribes to devices/+/status, and tracks who's online. The admin "Live devices"
// view reads this. Read-only; credentials stay server-side.

const mqtt = require('mqtt');

const cfg = () => ({
  host: process.env.BROKER_CTRL_HOST || '127.0.0.1',
  port: process.env.BROKER_CTRL_PORT || '1883',
  user: process.env.MONITOR_USER || 'portal-monitor',
  pass: process.env.MONITOR_PASS || '',
  mode: process.env.DYNSEC_MODE || 'real',
});

const _status = {};   // { username: { status: 'online'|'offline', at: ISO } }
let _client = null;
const _health = { ready: false, connected: false, subscribed: false, lastError: null };

function devices() {
  return Object.keys(_status).sort().map((u) => ({ username: u, ...(_status[u]) }));
}
function prune(validUsers) {
  const keep = new Set(validUsers || []);
  for (const username of Object.keys(_status)) if (!keep.has(username)) delete _status[username];
}

function status() { return { ..._health }; }

async function start() {
  const c = cfg();
  if (c.mode === 'mock') {
    Object.assign(_health, { ready: true, connected: true, subscribed: true, lastError: null });
    return;
  }
  if (!c.pass) throw new Error('MONITOR_PASS is missing');
  _client = mqtt.connect('mqtt://' + c.host + ':' + c.port, {
    username: c.user, password: c.pass, reconnectPeriod: 5000, clientId: 'portal-monitor-runtime',
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

module.exports = { start, devices, prune, status };
