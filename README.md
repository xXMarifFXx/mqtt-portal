# MQTT Class Portal

Self-service **broker accounts for students** (gated by a class code), a **copy-paste
connection card**, a **browser publish/subscribe test console**, and an **instructor admin
panel** — on top of a Mosquitto broker using the **Dynamic Security** plugin.

Each student who registers gets a broker username/password **scoped to their own topic
namespace** `devices/<username>/#` — they can't read or clobber anyone else's data.

```
Student browser ──HTTPS 443──> nginx ──> mqtt-portal (Node, localhost:3000)
       │                                      │  mosquitto_ctrl dynsec (localhost:1883)
       │  wss 8084 (test console)             ▼
       └──────────────────────────────>  Mosquitto (Dynamic Security)
                                          TLS 8883 (devices)  ·  wss 8084 (browser)
```

## Features
- **Register** (`/`): class-code gated → creates a broker account scoped to `devices/<you>/#`.
- **Connection card** (shown after registering): broker host/port, username, topic namespace,
  a ready **Arduino (N-R_ESP32 1.1.3+) sketch** with certificate validation and a
  **`mosquitto_sub` test command**, with copy buttons. The sketch deliberately uses the same
  username for `login()` and `begin()` because broker ACLs authorize `devices/<username>/#`.
- **Test console** (`/console`): connect with your own credentials over **wss** and
  **publish + subscribe live** — the fastest "is my MQTT up?" check. Uses MQTT.js in the browser;
  credentials never touch the portal server.
- **Admin** (`/admin`): list / reset / delete student accounts.

## What's verified vs. what to test on the VPS
- ✅ **Verified locally:** the web app (registration, admin, connection card, test-console page,
  CSP, session auth, rate limiting) + pure logic (`npm test`). Run with **no broker** via `npm run dev`.
- ⚠️ **Test on the VPS:** the broker integration — `deploy/enable-dynsec.sh` and the
  `mosquitto_ctrl` calls in `lib/dynsec.js` (flags/paths vary by Mosquitto version — that's the
  one file to tweak), and the **wss test console** end-to-end (needs the 8084 listener live).

The console keeps the student's broker, TLS, username, namespace, and presence
topics visible beneath the controls. ESP32 presence uses
`devices/<username>/status`; Node-RED presence uses the retained
`devices/<username>/nodered/status` topic with `online` as its birth message and
`offline` as its close/will message.

## Deploy

> **Already running Caddy on this box** (e.g. alongside sni-eng.com)? Use
> **[deploy/SAMEBOX.md](deploy/SAMEBOX.md)** instead of the steps below — it rides on your
> existing Caddy (no certbot/nginx, no port-80 conflict) and proxies the wss console.

### Standalone server — single domain (Ubuntu/Debian VPS)

Everything shares **one domain** and **one Let's Encrypt cert**: portal on `https://mqtt.mariffb.my`,
devices on `mqtt.mariffb.my:8883`, browser console on `mqtt.mariffb.my:8084`.

**0. DNS:** point an `A` record for `mqtt.mariffb.my` at the VPS public IP.

**1. Base broker + TLS cert** (edit `DOMAIN`/`EMAIL`/`MQTT_USER` at the top first):
```bash
sudo bash deploy/mosquitto-setup.sh
```

**2. Dynamic Security + student role + wss listener** (reconfigures broker auth — read the
warning in the script; adds the 8084 WebSocket-TLS listener and opens the firewall):
```bash
sudo bash deploy/enable-dynsec.sh
```
Note the `dynsec-admin` password you set — the portal needs it. (Optional: make a Node-RED
account — `mosquitto_ctrl -h 127.0.0.1 -p 1883 -u dynsec-admin dynsec createClient nodered`
then `addClientRole nodered observer`.)

**3. Install the app:**
```bash
sudo useradd -r -s /usr/sbin/nologin mqttportal
sudo cp -r . /opt/mqtt-portal && cd /opt/mqtt-portal && sudo npm ci --omit=dev
```

**4. Configure** (`sudo cp .env.example .env`, then edit): set `CLASS_CODE`,
`PUBLIC_BROKER_HOST=mqtt.mariffb.my`, `DYNSEC_ADMIN_PASS`, `SESSION_SECRET`
(`openssl rand -hex 32`), `NODE_ENV=production`, and the admin hash:
```bash
node scripts/hashpw.js 'your admin password'   # paste output as ADMIN_PASSWORD_HASH
```

**5. Run as a service:**
```bash
sudo cp deploy/mqtt-portal.service /etc/systemd/system/ && sudo systemctl enable --now mqtt-portal
```

**6. HTTPS front (reuses the cert from step 1 — no second certbot):** edit `mqtt.mariffb.my` in
`deploy/nginx-mqtt-portal.conf`, then:
```bash
sudo cp deploy/nginx-mqtt-portal.conf /etc/nginx/sites-available/mqtt-portal && sudo ln -sf /etc/nginx/sites-available/mqtt-portal /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

Students go to `https://mqtt.mariffb.my`, enter the class code, get credentials + a copy-paste
card, and can verify with the built-in test console. You manage them at `/admin`.

## Security notes
- Registration is `CLASS_CODE`-gated (rotate each term) and rate-limited; admin password is
  scrypt-hashed; session cookie is httpOnly/secure/SameSite; CSP allows scripts only from self
  and a WebSocket only to your broker.
- Students are confined to `devices/%u/#` by the `student` role's pattern ACLs.
- The portal reaches the broker only over the **localhost** control listener (1883 on 127.0.0.1);
  the internet sees only TLS 8883 and wss 8084.
- `mosquitto_ctrl` passes passwords as CLI args (visible in `ps`). Fine for a single-admin class
  box; switch `lib/dynsec.js` to stdin/REPL mode to harden. Documented trade-off.
- See [`AUDIT.md`](AUDIT.md) for the current full-system audit and prioritized findings.
- Encrypted backups, restore verification and automatic deployment rollback are documented
  in [`deploy/recovery/README.md`](deploy/recovery/README.md).

## Local development
```bash
npm install
npm run dev        # DYNSEC_MODE=mock, http, no broker -> http://127.0.0.1:3000
npm test           # pure-logic unit tests
```
The test console needs a real wss broker; in mock dev the page renders but won't connect.

## Service checks

- `GET /healthz` is process liveness only.
- `GET /readyz` returns 200 only when the portal can administer Mosquitto Dynamic Security
  and its status-monitor MQTT client is connected and subscribed. Deploy/restore automation
  uses readiness, so a running but unusable broker integration cannot be reported as success.
- Production startup rejects missing/placeholder broker settings, weak/missing session and
  admin configuration, a missing dynsec password, insecure cookies, or a non-WSS console URL.
- The status monitor uses `MONITOR_USER`/`MONITOR_PASS`, a separate read-only Mosquitto
  account. Never reuse `dynsec-admin`; production startup rejects that configuration.

## Admin-session security

- Admin sessions use an encrypted file-backed store under `data/sessions`, survive an
  application restart, expire after one hour, and are excluded from backup/restore.
- Every authenticated POST uses a session-bound synchronizer CSRF token. A missing or stale
  token returns 403 and requires the administrator to reload the page.

## Classroom capacity and broker limits

- Correct class-code registrations are not limited by public IP, so 25+ students sharing one
  campus NAT can register normally. Wrong class-code attempts are limited to 10 per IP per
  15 minutes.
- `REGISTRATION_HOURLY_CAP` defaults to 200 successful/authorized attempts across the class.
  Raise it deliberately for a larger event; it is a provisioning-abuse ceiling, not a class
  license limit.
- The same-box Mosquitto setup allows 200 device TLS connections, 100 browser WebSockets and
  30 localhost control/Node-RED connections. It limits publishes to 16 KiB, queued data to
  1 MiB/100 messages per client, and applies systemd memory/task/file-descriptor ceilings.
  These defaults are intentionally much larger than N-R_ESP32's normal 512-byte messages.
- Mosquitto Community Edition does not provide a simple per-username connection quota here;
  the listener and cgroup ceilings bound total damage while dynsec confines each username's
  topics.

## Privacy and retention

- Registration requires acknowledgment of the public `/privacy` notice. A real name is not
  required; students are told to use a nickname or leave the display-name field blank.
- The portal metadata store keeps username, optional display name, creation time, disabled
  state and notice version. It does not store the student's plaintext broker password. The
  browser console connects directly to Mosquitto.
- Set `PRIVACY_CONTROLLER`, `PRIVACY_CONTACT` and `DATA_RETENTION_DAYS` in production. Startup
  rejects missing controller/contact values.
- `npm run privacy:expired` is a non-mutating retention report. Follow
  [`deploy/privacy/README.md`](deploy/privacy/README.md) for backup, reviewed deletion,
  Node-RED cleanup and incident steps.

## Continuous integration

GitHub Actions runs portal tests, the encrypted recovery drill, syntax checks and `npm audit`
on every push and pull request. The N-R_ESP32 repository separately compiles BasicTelemetry
and MariffbPortal for generic ESP32, XIAO ESP32-C3 and XIAO ESP32-S3, plus host parser tests.
