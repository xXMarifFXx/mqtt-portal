'use strict';
// Pure, dependency-free validation — unit-tested in test/test_validate.js.

const crypto = require('crypto');

const RESERVED = new Set([
  'admin', 'administrator', 'dynsec', 'root', 'mosquitto',
  'teacher', 'node-red', 'nodered', 'broker', 'system',
]);

// Broker usernames: start with a letter, 3–20 chars of [a-z0-9_-], not reserved.
function validUsername(u) {
  if (typeof u !== 'string') return false;
  if (!/^[a-z][a-z0-9_-]{2,19}$/.test(u)) return false;
  if (RESERVED.has(u)) return false;
  return true;
}

function validPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 128) return false;
  if (p[0] === '-') return false;          // avoid being parsed as a CLI flag by mosquitto_ctrl
  if (/[\x00-\x1f]/.test(p)) return false; // no control chars
  return true;
}

// Display name is optional metadata; keep it printable and short.
function cleanDisplayName(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[^\p{L}\p{N} .,'-]/gu, '').trim().slice(0, 60);
}

// Constant-time compare so the class code can't be timed out character by character.
function secretEquals(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// The MQTT topic namespace a given student is scoped to.
function namespaceFor(username) {
  return `devices/${username}/#`;
}

module.exports = {
  RESERVED, validUsername, validPassword, cleanDisplayName, secretEquals, namespaceFor,
};
