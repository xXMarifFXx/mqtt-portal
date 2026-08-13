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
  a ready **Arduino (N-R_ESP32) snippet** and a **`mosquitto_sub` test command**, with copy buttons.
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
