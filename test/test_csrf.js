'use strict';
const assert = require('assert');
const C = require('../lib/csrf');

const req = { session: {}, body: {} };
const token = C.ensureToken(req);
assert.strictEqual(token.length, 64);
assert.strictEqual(C.ensureToken(req), token, 'token must remain stable for the session');
req.body._csrf = token;
assert(C.validToken(req));
req.body._csrf = token.slice(1) + '0';
assert(!C.validToken(req));
assert(!C.validToken({ session: {}, body: {} }));
console.log('CSRF synchronizer-token tests passed');
