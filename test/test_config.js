'use strict';
const assert = require('assert');
const C = require('../lib/config');

const valid = {
  NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(32),
  ADMIN_PASSWORD_HASH: 'ab'.repeat(16) + ':' + 'cd'.repeat(32),
  DYNSEC_MODE: 'real', DYNSEC_ADMIN_PASS: 'password123',
  DYNSEC_ADMIN_USER: 'dynsec-admin', MONITOR_USER: 'portal-monitor', MONITOR_PASS: 'monitor-password-123',
  PUBLIC_BROKER_HOST: 'mqtt.mariffb.my', PUBLIC_BROKER_PORT: '8883',
  PUBLIC_BROKER_WSS_URL: 'wss://mqtt.mariffb.my/mqtt', COOKIE_SECURE: 'true',
  REGISTRATION_HOURLY_CAP: '200',
  DATA_RETENTION_DAYS: '180', PRIVACY_CONTROLLER: 'Example University',
  PRIVACY_CONTACT: 'instructor@example.edu',
};
assert.deepStrictEqual(C.validateProductionEnv(valid), []);
assert(C.validateProductionEnv({ NODE_ENV: 'development' }).length === 0);
const bad = C.validateProductionEnv({ ...valid, DYNSEC_ADMIN_PASS: '', PUBLIC_BROKER_HOST: 'your-broker.example.com' });
assert(bad.some((x) => x.includes('DYNSEC_ADMIN_PASS')));
assert(bad.some((x) => x.includes('PUBLIC_BROKER_HOST')));
assert.throws(() => C.assertProductionEnv({ ...valid, COOKIE_SECURE: 'false' }), /COOKIE_SECURE/);
assert(C.validateProductionEnv({ ...valid, REGISTRATION_HOURLY_CAP: '10' }).some((x) => x.includes('REGISTRATION_HOURLY_CAP')));
assert(C.validateProductionEnv({ ...valid, PRIVACY_CONTACT: '' }).some((x) => x.includes('PRIVACY_CONTACT')));
assert(C.validateProductionEnv({ ...valid, MONITOR_USER: 'dynsec-admin' }).some((x) => x.includes('must not')));
console.log('production configuration tests passed');
