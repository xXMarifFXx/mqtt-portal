'use strict';
const assert = require('assert');
const C = require('../lib/config');

const valid = {
  NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(32),
  ADMIN_PASSWORD_HASH: 'ab'.repeat(16) + ':' + 'cd'.repeat(32),
  DYNSEC_MODE: 'real', DYNSEC_ADMIN_PASS: 'password123',
  PUBLIC_BROKER_HOST: 'mqtt.mariffb.my', PUBLIC_BROKER_PORT: '8883',
  PUBLIC_BROKER_WSS_URL: 'wss://mqtt.mariffb.my/mqtt', COOKIE_SECURE: 'true',
};
assert.deepStrictEqual(C.validateProductionEnv(valid), []);
assert(C.validateProductionEnv({ NODE_ENV: 'development' }).length === 0);
const bad = C.validateProductionEnv({ ...valid, DYNSEC_ADMIN_PASS: '', PUBLIC_BROKER_HOST: 'your-broker.example.com' });
assert(bad.some((x) => x.includes('DYNSEC_ADMIN_PASS')));
assert(bad.some((x) => x.includes('PUBLIC_BROKER_HOST')));
assert.throws(() => C.assertProductionEnv({ ...valid, COOKIE_SECURE: 'false' }), /COOKIE_SECURE/);
console.log('production configuration tests passed');
