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
  mode: process.env.DYNSEC_MODE || 'real',
});

// Connection flags shared by every ctrl call.
function connFlags(c) {
  return ['-h', c.host, '-p', String(c.port), '-u', c.admin, '-P', c.pass];
}

// Per-user role name (Mosquitto 2.0.x does NOT substitute %u in ACLs, so we bake
// the real username into a dedicated role instead of sharing one %u role).
const roleFor = (user) => 'ns-' + user;
const nsFor = (user) => 'devices/' + user + '/#';

// ---- pure arg builders (return the mosquitto_ctrl argv) -------------------
const args = {
  createClient: (c, user, pass) => [...connFlags(c), 'dynsec', 'createClient', user, '-p', pass],
  createRole: (c, role) => [...connFlags(c), 'dynsec', 'createRole', role],
  deleteRole: (c, role) => [...connFlags(c), 'dynsec', 'deleteRole', role],
  addRoleACL: (c, role, type, topic) => [...connFlags(c), 'dynsec', 'addRoleACL', role, type, topic, 'allow'],
  addClientRole: (c, user, role) => [...connFlags(c), 'dynsec', 'addClientRole', user, role],
  setClientPassword: (c, user, pass) => [...connFlags(c), 'dynsec', 'setClientPassword', user, pass],
  deleteClient: (c, user) => [...connFlags(c), 'dynsec', 'deleteClient', user],
  disableClient: (c, user) => [...connFlags(c), 'dynsec', 'disableClient', user],
  enableClient: (c, user) => [...connFlags(c), 'dynsec', 'enableClient', user],
  listClients: (c) => [...connFlags(c), 'dynsec', 'listClients'],
  getClient: (c, user) => [...connFlags(c), 'dynsec', 'getClient', user],
  getRole: (c, role) => [...connFlags(c), 'dynsec', 'getRole', role],
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

function isAlreadyExists(err) {
  return /already (exists|has)|with this topic already exists/i.test(String(err && err.message || err));
}

function verifyProvisioning(user, role, ns, clientOutput, roleOutput) {
  const required = ['subscribePattern', 'publishClientSend', 'publishClientReceive'];
  if (!String(clientOutput).includes(role)) throw new Error(`verification failed: ${user} is missing role ${role}`);
  for (const acl of required) {
    const line = String(roleOutput).split('\n').find((x) => x.includes(acl) && x.includes(ns) && x.includes('allow'));
    if (!line) throw new Error(`verification failed: ${role} is missing allow ${acl} ${ns}`);
  }
}

// Provision as a transaction from the portal's point of view. Mosquitto dynsec has no
// multi-command transaction, so every step is checked, final state is read back, and a
// newly created client/role is removed if any step fails.
async function provisionStudent(c, user, pass, runner = run) {
  const role = roleFor(user);
  const ns = nsFor(user);
  let clientCreated = false;
  let roleCreated = false;
  try {
    await runner(args.createClient(c, user, pass));
    clientCreated = true;
    try { await runner(args.createRole(c, role)); roleCreated = true; }
    catch (e) { if (!isAlreadyExists(e)) throw e; }

    for (const type of ['subscribePattern', 'publishClientSend', 'publishClientReceive']) {
      try { await runner(args.addRoleACL(c, role, type, ns)); }
      catch (e) { if (!isAlreadyExists(e)) throw e; }
    }
    try { await runner(args.addClientRole(c, user, role)); }
    catch (e) { if (!isAlreadyExists(e)) throw e; }

    const [clientOutput, roleOutput] = await Promise.all([
      runner(args.getClient(c, user)), runner(args.getRole(c, role)),
    ]);
    verifyProvisioning(user, role, ns, clientOutput, roleOutput);
  } catch (cause) {
    const rollbackErrors = [];
    if (clientCreated) {
      try { await runner(args.deleteClient(c, user)); } catch (e) { rollbackErrors.push('client: ' + e.message); }
    }
    if (roleCreated) {
      try { await runner(args.deleteRole(c, role)); } catch (e) { rollbackErrors.push('role: ' + e.message); }
    }
    const suffix = rollbackErrors.length ? `; rollback incomplete (${rollbackErrors.join(', ')})` : '; partial account rolled back';
    throw new Error(`student provisioning failed: ${cause.message}${suffix}`);
  }
}

async function createStudent(user, pass) {
  const c = cfg();
  if (c.mode === 'mock') {
    if (_mock.has(user)) throw new Error('client already exists');
    _mock.add(user); return;
  }
  await provisionStudent(c, user, pass);
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
  await run(args.deleteRole(c, roleFor(user))).catch(() => {}); // best-effort cleanup
}

// Turn a student's account off (force-disconnect + block reconnect) or back on.
async function disableStudent(user) {
  const c = cfg();
  if (c.mode === 'mock') return;
  await run(args.disableClient(c, user));
}
async function enableStudent(user) {
  const c = cfg();
  if (c.mode === 'mock') return;
  await run(args.enableClient(c, user));
}

async function listStudents() {
  const c = cfg();
  if (c.mode === 'mock') return [..._mock].sort();
  return parseClients(await run(args.listClients(c)))
    .filter((u) => u !== c.admin)
    .sort();
}

async function healthCheck() {
  const c = cfg();
  if (c.mode === 'mock') return { ok: true, mode: 'mock' };
  await run(args.listClients(c));
  return { ok: true, mode: 'real' };
}

module.exports = {
  cfg, connFlags, args, parseClients, roleFor, nsFor, isAlreadyExists,
  verifyProvisioning, provisionStudent, createStudent, resetPassword, deleteStudent,
  disableStudent, enableStudent, listStudents, healthCheck,
};
