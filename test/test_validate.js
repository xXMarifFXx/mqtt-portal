'use strict';
// Host-side unit tests for the pure logic (no broker, no network).
const assert = require('assert');
const V = require('../lib/validate');
const dynsec = require('../lib/dynsec');

let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); console.log('  ok  ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + e.message); } }

// --- usernames ---
t('valid usernames', () => { ['ada', 'bob_1', 'a-b-c', 'z99'].forEach((u) => assert(V.validUsername(u), u)); });
t('reject bad usernames', () => {
  ['ab', '1abc', 'AdA', 'has space', 'toolongusername_abcdefgh', 'admin', 'dynsec', 'node-red'].forEach(
    (u) => assert(!V.validUsername(u), 'should reject ' + u));
});

// --- passwords ---
t('password length', () => { assert(!V.validPassword('short')); assert(V.validPassword('12345678')); assert(!V.validPassword('x'.repeat(129))); });
t('password rejects leading dash + control chars', () => {
  assert(!V.validPassword('-startswithdash'), 'leading dash');
  assert(!V.validPassword('has\tcontrol'), 'control char');
  assert(V.validPassword('with-dash-inside'), 'dash not at start is ok');
});

// --- class code compare is length-safe + correct ---
t('secretEquals', () => { assert(V.secretEquals('abc', 'abc')); assert(!V.secretEquals('abc', 'abd')); assert(!V.secretEquals('abc', 'abcd')); });

// --- namespace scoping ---
t('namespace', () => assert.strictEqual(V.namespaceFor('ada'), 'devices/ada/#'));

// --- display name sanitising ---
t('cleanDisplayName strips junk', () => assert.strictEqual(V.cleanDisplayName('Ada <b>L</b>'), 'Ada bLb'));

// --- dynsec arg builders (pure) ---
t('dynsec createClient args', () => {
  const c = { host: 'h', port: '1883', admin: 'a', pass: 'p', role: 'student', mode: 'real' };
  assert.deepStrictEqual(dynsec.args.createClient(c, 'ada', 'pw'),
    ['-h', 'h', '-p', '1883', '-u', 'a', '-P', 'p', 'dynsec', 'createClient', 'ada', '-p', 'pw']);
});
t('dynsec addClientRole args', () => {
  const c = { host: 'h', port: '1883', admin: 'a', pass: 'p', role: 'student', mode: 'real' };
  assert.deepStrictEqual(dynsec.args.addClientRole(c, 'ada'),
    ['-h', 'h', '-p', '1883', '-u', 'a', '-P', 'p', 'dynsec', 'addClientRole', 'ada', 'student']);
});
t('parseClients handles JSON', () => {
  assert.deepStrictEqual(dynsec.parseClients('{"clients":[{"username":"ada"},{"username":"bob"}]}'), ['ada', 'bob']);
});

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
