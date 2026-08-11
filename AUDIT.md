# mqtt-portal — security & quality audit

Date: 2026-08-09 · scope: full · verdict: **GO** — P2 fixed + top P3s cleared in this pass.

## v0.2.0 addendum — connection card + browser test console
New surface reviewed:
- **`/console`** is public and does **no** server-side work beyond rendering; the student's
  broker credentials are used **client-side only** (MQTT.js → wss) and never sent to the portal.
- **CSP** was tightened, not loosened: `script-src 'self'` (all JS self-hosted, incl. the
  vendored MQTT.js) and `connect-src` allows a WebSocket **only** to the configured broker.
- **Supply chain:** MQTT.js is **vendored + pinned** (`public/vendor/mqtt.min.js`, v5.10.1 from
  unpkg), not loaded from a CDN — no third-party origin at runtime.
- The broker's wss listener (8084) uses the same TLS cert + Dynamic Security ACLs, so the console
  is bound by the same per-student `devices/%u/#` scoping. No new server secrets.
No new P0/P1/P2.

## v0.4.0 addendum — admin "Live devices" + console auto-reconnect
- The portal keeps one **server-side** MQTT connection to the local broker (`lib/monitor.js`)
  as `dynsec-admin` (creds stay server-side), subscribing to `devices/+/status` to track
  presence. It grants `dynsec-admin` the read-only `observer` role at startup (idempotent).
- `/admin/devices.json` is **admin-gated** (`requireAdmin`) and returns only usernames +
  online/offline — no secrets. The admin page polls it every 4 s.
- Console `reconnectPeriod` set to 3 s so a dropped monitoring tab recovers; bad-credential
  connections are still ended in `on('error')`, so no auth-retry loop.
No new P0/P1/P2.

Profile: **public web app** · Node.js/Express + EJS, server-rendered, session auth ·
handles **credentials** (student broker passwords in transit, admin password hashed, class
code) · minimal PII (optional display name) · exposure: **public internet** (self-service
registration) behind nginx TLS on a VPS · solo operator.

Dimensions run: Security, Functional, Data integrity, Reliability, Code quality, a11y (light).
Skipped heavy: Privacy/compliance (only an optional display name; no regulated data).

## P2 — FIXED (2026-08-09)
- [x] **[Security] Raw broker stderr reflected into the admin URL.** Now logged server-side
  (`console.error`) with a generic client message on reset/delete errors. `server.js`.

## P3
- [x] **[Security] Argument robustness.** `validPassword` now rejects a leading `-` and control
  chars. `lib/validate.js` (+ tests).
- [x] **[Functional] Inline `onsubmit` blocked by CSP.** Replaced with `data-confirm` +
  external `public/confirm.js` (CSP-safe). `views/admin.ejs`.
- [x] **[Security] Session regenerated on login** to prevent fixation. `server.js`.
- [x] **[Ops] `SESSION_SECRET` required in production** — process exits if unset. `server.js`.
- [x] **[Data] JSON store writes are now atomic** (temp file + rename). `lib/store.js`.
- [ ] **[CSRF] Admin state-changing POSTs rely on `SameSite=Lax`** (which blocks cross-site
  POST cookies — mitigated). Add tokens as defense-in-depth if this grows beyond a class tool.
- [ ] **[Security-accepted] Passwords passed as `mosquitto_ctrl` argv** (visible in `ps`).
  Documented trade-off in README; switch `lib/dynsec.js` to stdin/REPL mode to harden.

## Verified-good
- **No command injection:** `execFile` (no shell) + every arg reaching `dynsec` is validated
  (`validUsername`/`validPassword`) on the register/reset/delete paths.
- **AuthZ:** all `/admin*` routes gated by `requireAdmin`; fail-closed when `CLASS_CODE` or
  `ADMIN_PASSWORD_HASH` is unset.
- **XSS:** EJS auto-escaping; display name sanitised; reflected query params escaped.
- **Admin auth:** scrypt-hashed password, constant-time compare; cookie httpOnly + secure +
  SameSite; rate-limited login (10/15m) and registration (20/15m).
- **Supply chain:** `npm audit` → 0 vulnerabilities; lockfile committed; `.env`/`data/` gitignored.
- **Reliability:** broker-down degrades gracefully (admin shows error, register generic);
  `execFile` 8s timeout prevents hangs.
- **Tests:** 9/9 unit + 12/12 HTTP-flow (verified this build).

## PRR gate
security → concern (P2) · authz → pass · injection → pass · supply-chain → pass ·
reliability → pass · monitoring → basic (`/healthz`) · a11y → light-pass (labels present) ·
privacy → N/A. **NO open P0 → GO**, conditioned on the P2 fix before students use it.
