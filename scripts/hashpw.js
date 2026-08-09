'use strict';
// Generate an ADMIN_PASSWORD_HASH value:  node scripts/hashpw.js 'my password'
const crypto = require('crypto');
const pw = process.argv[2];
if (!pw) { console.error("usage: node scripts/hashpw.js 'your admin password'"); process.exit(1); }
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(pw, salt, 32);
console.log('ADMIN_PASSWORD_HASH=' + salt.toString('hex') + ':' + hash.toString('hex'));
