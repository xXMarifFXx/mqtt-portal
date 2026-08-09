'use strict';
/*
  MQTT Portal — self-service broker accounts for students (class-code gated) +
  an admin panel. Backend: Mosquitto Dynamic Security via lib/dynsec.js.

  Run behind an HTTPS reverse proxy (see deploy/README). Listens on localhost.
*/

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');

const V = require('./lib/validate');
const dynsec = require('./lib/dynsec');
const store = require('./lib/store');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet());
app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1); // behind nginx

app.use(session({
  name: 'mqttportal.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE !== 'false', maxAge: 3600e3 },
}));

const CLASS_CODE = process.env.CLASS_CODE || '';
const ADMIN_HASH = process.env.ADMIN_PASSWORD_HASH || ''; // "salthex:hashhex"
const BROKER_HOST = process.env.PUBLIC_BROKER_HOST || 'your-broker.example.com';

// In production a stable SESSION_SECRET is mandatory (a random per-boot one silently
// logs every admin out on each restart). Fail fast rather than "work" then surprise.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('FATAL: set SESSION_SECRET in production (openssl rand -hex 32).');
  process.exit(1);
}

function verifyAdmin(pw) {
  if (!ADMIN_HASH.includes(':')) return false;
  const [salt, hash] = ADMIN_HASH.split(':');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 32).toString('hex');
  return V.secretEquals(got, hash);
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/login');
}

const regLimiter = rateLimit({ windowMs: 15 * 60e3, max: 20 });
const loginLimiter = rateLimit({ windowMs: 15 * 60e3, max: 10 });

// ---- student registration --------------------------------------------------
app.get('/', (req, res) => {
  res.render('register', { error: null, done: null, brokerHost: BROKER_HOST });
});

app.post('/register', regLimiter, async (req, res) => {
  const username = String(req.body.username || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  const display = V.cleanDisplayName(req.body.display);
  const code = String(req.body.classcode || '');
  const err = (m) => res.status(400).render('register', { error: m, done: null, brokerHost: BROKER_HOST });

  if (!CLASS_CODE || !V.secretEquals(code, CLASS_CODE)) return err('Wrong or missing class code.');
  if (!V.validUsername(username)) return err('Username: start with a letter, 3–20 chars of a–z, 0–9, _ or -, and not a reserved word.');
  if (!V.validPassword(password)) return err('Password must be at least 8 characters.');

  try {
    await dynsec.createStudent(username, password);
    store.record(username, display, new Date().toISOString());
    return res.render('register', {
      error: null, brokerHost: BROKER_HOST,
      done: { username, namespace: V.namespaceFor(username) },
    });
  } catch (e) {
    const msg = /exist/i.test(e.message) ? 'That username is already taken.' : 'Could not create the account. Ask your instructor.';
    return err(msg);
  }
});

// ---- admin -----------------------------------------------------------------
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', loginLimiter, (req, res) => {
  if (!verifyAdmin(req.body.password || '')) {
    return res.status(401).render('login', { error: 'Wrong password.' });
  }
  // Regenerate the session on privilege change to prevent session fixation.
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { error: 'Session error, try again.' });
    req.session.admin = true;
    res.redirect('/admin');
  });
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const users = await dynsec.listStudents();
    const rows = users.map((u) => ({ username: u, ...store.meta(u) }));
    res.render('admin', { rows, error: req.query.error || null, ok: req.query.ok || null });
  } catch (e) {
    res.render('admin', { rows: [], error: 'Cannot reach the broker: ' + e.message, ok: null });
  }
});

app.post('/admin/reset', requireAdmin, async (req, res) => {
  const u = String(req.body.username || '');
  const p = String(req.body.password || '');
  if (!V.validUsername(u) || !V.validPassword(p)) return res.redirect('/admin?error=' + encodeURIComponent('Invalid username or password (min 8, no leading "-").'));
  try { await dynsec.resetPassword(u, p); res.redirect('/admin?ok=' + encodeURIComponent('Password reset for ' + u)); }
  catch (e) { console.error('[reset] broker error:', e.message); res.redirect('/admin?error=' + encodeURIComponent('Could not reset that account — check the broker.')); }
});

app.post('/admin/delete', requireAdmin, async (req, res) => {
  const u = String(req.body.username || '');
  if (!V.validUsername(u)) return res.redirect('/admin?error=' + encodeURIComponent('Invalid username.'));
  try { await dynsec.deleteStudent(u); store.remove(u); res.redirect('/admin?ok=' + encodeURIComponent('Deleted ' + u)); }
  catch (e) { console.error('[delete] broker error:', e.message); res.redirect('/admin?error=' + encodeURIComponent('Could not delete that account — check the broker.')); }
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
if (require.main === module) {
  app.listen(PORT, HOST, () => console.log(`mqtt-portal on http://${HOST}:${PORT} (dynsec mode: ${dynsec.cfg().mode})`));
}
module.exports = app;
