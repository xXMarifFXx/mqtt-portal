'use strict';
/*
  Thin wrapper over `mosquitto_ctrl dynsec ...` — the official tool for the
  Mosquitto Dynamic Security plugin. The ARG BUILDERS are pure (unit-tested);
  run() shells out. Set DYNSEC_MODE=mock to develop without a broker.

  NOTE (verify on the VPS): mosquitto_ctrl flags can vary slightly by version.
  This module is the single place to adjust them if a command name differs.
*/

const { execFile } = require('child_process');

const cfg = () => ({
  host: process.env.BROKER_CTRL_HOST || '127.0.0.1',
  port: process.env.BROKER_CTRL_PORT || '1883',
  admin: process.env.DYNSEC_ADMIN_USER || 'dynsec-admin',
  pass: process.env.DYNSEC_ADMIN_PASS || '',
  role: process.env.STUDENT_ROLE || 'student',
  mode: process.env.DYNSEC_MODE || 'real',
});

// Connection flags shared by every ctrl call.
function connFlags(c) {
  return ['-h', c.host, '-p', String(c.port), '-u', c.admin, '-P', c.pass];
}

// ---- pure arg builders (return the mosquitto_ctrl argv) -------------------
const args = {
  createClient: (c, user, pass) => [...connFlags(c), 'dynsec', 'createClient', user, '-p', pass],
  addClientRole: (c, user) => [...connFlags(c), 'dynsec', 'addClientRole', user, c.role],
  setClientPassword: (c, user, pass) => [...connFlags(c), 'dynsec', 'setClientPassword', user, pass],
  deleteClient: (c, user) => [...connFlags(c), 'dynsec', 'deleteClient', user],
  listClients: (c) => [...connFlags(c), 'dynsec', 'listClients'],
};

function run(argv) {
  return new Promise((resolve, reject) => {
    execFile('mosquitto_ctrl', argv, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').trim()));
      resolve((stdout || '').trim());
    });
  });
}

// Parse `listClients` output into an array of usernames (defensive across formats).
function parseClients(stdout) {
  try {
    const j = JSON.parse(stdout);
    const list = j.clients || (j.data && j.data.clients) || [];
    return list.map((x) => (typeof x === 'string' ? x : x.username)).filter(Boolean);
  } catch (_) {
    // fallback: one username per line
    return stdout.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('{'));
  }
}

// ---- in-memory mock so the app runs + is testable without a broker --------
const _mock = new Set();

async function createStudent(user, pass) {
  const c = cfg();
  if (c.mode === 'mock') {
    if (_mock.has(user)) throw new Error('client already exists');
    _mock.add(user); return;
  }
  await run(args.createClient(c, user, pass));
  await run(args.addClientRole(c, user)); // scope to the shared %u-pattern role
}

async function resetPassword(user, pass) {
  const c = cfg();
  if (c.mode === 'mock') { if (!_mock.has(user)) throw new Error('no such client'); return; }
  await run(args.setClientPassword(c, user, pass));
}

async function deleteStudent(user) {
  const c = cfg();
  if (c.mode === 'mock') { _mock.delete(user); return; }
  await run(args.deleteClient(c, user));
}

async function listStudents() {
  const c = cfg();
  if (c.mode === 'mock') return [..._mock].sort();
  return parseClients(await run(args.listClients(c)))
    .filter((u) => u !== c.admin)
    .sort();
}

module.exports = {
  cfg, connFlags, args, parseClients,
  createStudent, resetPassword, deleteStudent, listStudents,
};
