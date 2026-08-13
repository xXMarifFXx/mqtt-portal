'use strict';
const crypto = require('crypto');

function ensureToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function validToken(req) {
  const expected = Buffer.from(String(req.session && req.session.csrfToken || ''));
  const supplied = Buffer.from(String(req.body && req.body._csrf || ''));
  return expected.length === 64 && supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
}

function expose(req, res, next) {
  if (req.session) res.locals.csrfToken = ensureToken(req);
  next();
}

function protect(req, res, next) {
  if (validToken(req)) return next();
  return res.status(403).send('Invalid or expired form token. Reload the page and try again.');
}

module.exports = { ensureToken, validToken, expose, protect };
