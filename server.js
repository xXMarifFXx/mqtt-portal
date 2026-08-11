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
const codes = require('./lib/codes');
const monitor = require('./lib/monitor');

const BROKER_HOST = process.env.PUBLIC_BROKER_HOST || 'your-broker.example.com';
const BROKER_PORT = process.env.PUBLIC_BROKER_PORT || '8883';        // MQTT over TLS (devices)
const BROKER_WS_PORT = process.env.PUBLIC_BROKER_WS_PORT || '8084';  // fallback wss port (separate-server setups)
// Full wss URL the browser console connects to. Same-box-with-Caddy setups set this
// to e.g. wss://mqtt.mariffb.my/mqtt ; otherwise it defaults to host:port.
const WSS_URL = process.env.PUBLIC_BROKER_WSS_URL || `wss://${BROKER_HOST}:${BROKER_WS_PORT}`;
// CSP connect-src needs the ORIGIN only (scheme://host[:port], no path).
const WSS_ORIGIN = (() => { try { const u = new URL(WSS_URL); return u.protocol + '//' + u.host; } catch (_) { return WSS_URL; } })();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// CSP: self-hosted scripts only, but allow the browser test console to open a
// WebSocket to the broker (wss). Everything else stays locked down.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: { 'script-src': ["'self'"], 'connect-src': ["'self'", WSS_ORIGIN] },
  },
}));
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
const broker = { host: BROKER_HOST, port: BROKER_PORT, wss: WSS_URL };

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
  res.render('register', { error: null, done: null, broker });
});

app.post('/register', regLimiter, async (req, res) => {
  const username = String(req.body.username || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  const display = V.cleanDisplayName(req.body.display);
  const code = String(req.body.classcode || '');
  const err = (m) => res.status(400).render('register', { error: m, done: null, broker });

  if (!codes.isValid(code)) return err('Wrong or missing class code.');
  if (!V.validUsername(username)) return err('Username: start with a letter, 3–20 chars of a–z, 0–9, _ or -, and not a reserved word.');
  if (!V.validPassword(password)) return err('Password must be at least 8 characters.');

  try {
    await dynsec.createStudent(username, password);
    store.record(username, display, new Date().toISOString());
    return res.render('register', {
      error: null, broker,
      done: { username, namespace: V.namespaceFor(username) },
    });
  } catch (e) {
    const msg = /exist/i.test(e.message) ? 'That username is already taken.' : 'Could not create the account. Ask your instructor.';
    return err(msg);
  }
});

// ---- browser MQTT test console (public; connects with the student's own creds) ----
app.get('/console', (req, res) => {
  res.render('console', { broker, prefill: String(req.query.u || '') });
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
  const codeList = codes.list();
  try {
    const users = await dynsec.listStudents();
    const rows = users.map((u) => ({ username: u, ...store.meta(u) }));
    res.render('admin', { rows, codes: codeList, broker, error: req.query.error || null, ok: req.query.ok || null });
  } catch (e) {
    res.render('admin', { rows: [], codes: codeList, broker, error: 'Cannot reach the broker: ' + e.message, ok: null });
  }
});

// Admin: manually create a student account
app.post('/admin/student/add', requireAdmin, async (req, res) => {
  const u = String(req.body.username || '').toLowerCase().trim();
  const p = String(req.body.password || '');
  const display = V.cleanDisplayName(req.body.display);
  if (!V.validUsername(u)) return res.redirect('/admin?error=' + encodeURIComponent('Invalid username (start with a letter, 3–20 of a–z 0–9 _ -, not reserved).'));
  if (!V.validPassword(p)) return res.redirect('/admin?error=' + encodeURIComponent('Password must be at least 8 characters (no leading "-").'));
  try {
    await dynsec.createStudent(u, p);
    store.record(u, display, new Date().toISOString());
    res.redirect('/admin?ok=' + encodeURIComponent('Created ' + u));
  } catch (e) {
    const msg = /exist/i.test(e.message) ? 'That username is already taken.' : 'Could not create the account — check the broker.';
    if (!/exist/i.test(e.message)) console.error('[add] broker error:', e.message);
    res.redirect('/admin?error=' + encodeURIComponent(msg));
  }
});

// Admin: manage class codes
app.post('/admin/code/add', requireAdmin, (req, res) => {
  const c = String(req.body.code || '').trim();
  const ok = codes.add(c);
  res.redirect('/admin?' + (ok ? 'ok=' + encodeURIComponent('Added class code') : 'error=' + encodeURIComponent('Invalid or duplicate code (3–64 chars).')));
});
app.post('/admin/code/delete', requireAdmin, (req, res) => {
  codes.remove(String(req.body.code || ''));
  res.redirect('/admin?ok=' + encodeURIComponent('Removed class code'));
});

// Turn a student's board off (force-disconnect + block reconnect) or back on.
app.post('/admin/disable', requireAdmin, async (req, res) => {
  const u = String(req.body.username || '');
  if (!V.validUsername(u)) return res.redirect('/admin?error=' + encodeURIComponent('Invalid username.'));
  try { await dynsec.disableStudent(u); store.setDisabled(u, true); res.redirect('/admin?ok=' + encodeURIComponent('Turned off ' + u + ' (board forced offline)')); }
  catch (e) { console.error('[disable] broker error:', e.message); res.redirect('/admin?error=' + encodeURIComponent('Could not turn off — check the broker.')); }
});
app.post('/admin/enable', requireAdmin, async (req, res) => {
  const u = String(req.body.username || '');
  if (!V.validUsername(u)) return res.redirect('/admin?error=' + encodeURIComponent('Invalid username.'));
  try { await dynsec.enableStudent(u); store.setDisabled(u, false); res.redirect('/admin?ok=' + encodeURIComponent('Turned on ' + u)); }
  catch (e) { console.error('[enable] broker error:', e.message); res.redirect('/admin?error=' + encodeURIComponent('Could not turn on — check the broker.')); }
});

// Live device presence (polled by the admin page); merges the on/off state.
app.get('/admin/devices.json', requireAdmin, (req, res) =>
  res.json({ devices: monitor.devices().map((d) => ({ ...d, disabled: !!store.meta(d.username).disabled })) }));

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
  monitor.start().catch((e) => console.error('[monitor] start failed:', e.message));
}
module.exports = app;
