'use strict';
// Host-side unit tests for the pure logic (no broker, no network).
const assert = require('assert');
const V = require('../lib/validate');
const dynsec = require('../lib/dynsec');
const snippets = require('../lib/snippets');
const privacy = require('../lib/privacy');

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
t('portal sketch keeps login and topic namespace identical', () => {
  const sketch = snippets.portalSketch({ host: 'mqtt.mariffb.my', port: '8883' }, 'ada');
  assert(sketch.includes('const char* MQTT_USERNAME = "ada";'));
  assert(sketch.includes('.login(MQTT_USERNAME, MQTT_PASSWORD)'));
  assert(sketch.includes('bridge.begin(MQTT_USERNAME)'));
  assert(sketch.includes('.secure(NODEBRIDGE_ISRG_ROOT_X1)'));
  assert(sketch.includes('.broker("mqtt.mariffb.my", 8883)'));
  assert(!sketch.includes('.secure()'), 'must not use unvalidated TLS');
});
t('privacy retention boundary', () => {
  const now = new Date('2026-08-13T00:00:00Z');
  assert(privacy.isExpired({ createdAt: '2026-01-01T00:00:00Z' }, 180, now));
  assert(!privacy.isExpired({ createdAt: '2026-08-01T00:00:00Z' }, 180, now));
  assert(!privacy.isExpired({ createdAt: '' }, 180, now));
});

// --- display name sanitising ---
t('cleanDisplayName strips junk', () => assert.strictEqual(V.cleanDisplayName('Ada <b>L</b>'), 'Ada bLb'));

// --- dynsec arg builders (pure) ---
t('dynsec createClient args', () => {
  const c = { host: 'h', port: '1883', admin: 'a', pass: 'p', role: 'student', mode: 'real' };
  assert.deepStrictEqual(dynsec.args.createClient(c, 'ada', 'pw'),
    ['-h', 'h', '-p', '1883', '-u', 'a', '-P', 'p', 'dynsec', 'createClient', 'ada', '-p', 'pw']);
});
t('dynsec per-user role name', () => { assert.strictEqual(dynsec.roleFor('ada'), 'ns-ada'); assert.strictEqual(dynsec.nsFor('ada'), 'devices/ada/#'); });
t('dynsec addClientRole args (explicit role)', () => {
  const c = { host: 'h', port: '1883', admin: 'a', pass: 'p', mode: 'real' };
  assert.deepStrictEqual(dynsec.args.addClientRole(c, 'ada', 'ns-ada'),
    ['-h', 'h', '-p', '1883', '-u', 'a', '-P', 'p', 'dynsec', 'addClientRole', 'ada', 'ns-ada']);
});
t('dynsec addRoleACL args', () => {
  const c = { host: 'h', port: '1883', admin: 'a', pass: 'p', mode: 'real' };
  assert.deepStrictEqual(dynsec.args.addRoleACL(c, 'ns-ada', 'subscribePattern', 'devices/ada/#'),
    ['-h', 'h', '-p', '1883', '-u', 'a', '-P', 'p', 'dynsec', 'addRoleACL', 'ns-ada', 'subscribePattern', 'devices/ada/#', 'allow']);
});
t('parseClients handles JSON', () => {
  assert.deepStrictEqual(dynsec.parseClients('{"clients":[{"username":"ada"},{"username":"bob"}]}'), ['ada', 'bob']);
});

// --- class codes store ---
t('class codes add / remove / isValid', () => {
  const fs = require('fs');
  process.env.CODES_FILE = '/tmp/nb_codes_' + process.pid + '.json';
  process.env.CLASS_CODE = '';
  fs.rmSync(process.env.CODES_FILE, { force: true });
  delete require.cache[require.resolve('../lib/codes')];
  const codes = require('../lib/codes');
  assert.deepStrictEqual(codes.list(), []);
  assert(codes.add('spring2026'));
  assert(!codes.add('spring2026'));                // duplicate rejected
  assert(!codes.add('xx'));                         // too short
  assert(codes.isValid('spring2026'));
  assert(!codes.isValid('nope'));
  codes.remove('spring2026');
  assert(!codes.isValid('spring2026'));
  fs.rmSync(process.env.CODES_FILE, { force: true });
});

console.log(`\n${n - fail}/${n} passed`);
process.exit(fail ? 1 : 0);
