# MQTT Class Portal

Self-service **broker accounts for students** (gated by a class code) + an **instructor
admin panel**, on top of a Mosquitto broker using the **Dynamic Security** plugin.

Each student who registers gets a broker username/password **scoped to their own topic
namespace** `devices/<username>/#` — so they can't read or clobber anyone else's data.

```
Student browser ──HTTPS──> nginx ──> mqtt-portal (Node, localhost:3000)
                                          │  mosquitto_ctrl dynsec ...
                                          ▼
                                     Mosquitto (Dynamic Security)
```

## What's verified vs. what to test on the VPS
- ✅ **Verified locally:** the web app (registration + admin flows, validation, session
  auth, rate limiting) and all pure logic (`npm test`). Run it with **no broker** via
  `npm run dev` (DYNSEC_MODE=mock).
- ⚠️ **Test on the VPS:** the broker integration — `deploy/enable-dynsec.sh` and the
  `mosquitto_ctrl` calls in `lib/dynsec.js`. Flags/paths vary by Mosquitto version;
  `lib/dynsec.js` is the one file to tweak if a command differs. **Test on a scratch
  broker first.**

## Deploy (Ubuntu/Debian VPS)

Assumes you've already run `mosquitto-setup.sh` (Mosquitto + TLS on 8883).

**1. Turn on Dynamic Security + the student role** (reconfigures broker auth — read the
warning in the script first):
```bash
sudo bash deploy/enable-dynsec.sh
```
Note the `dynsec-admin` password you set — the portal needs it.

**2. Install the app:**
```bash
sudo useradd -r -s /usr/sbin/nologin mqttportal
sudo cp -r . /opt/mqtt-portal && cd /opt/mqtt-portal
sudo npm ci --omit=dev
```

**3. Configure:**
```bash
sudo cp .env.example .env
```
Edit `.env`: set `CLASS_CODE`, `PUBLIC_BROKER_HOST`, `DYNSEC_ADMIN_PASS`,
`SESSION_SECRET` (`openssl rand -hex 32`), and the admin hash:
```bash
node scripts/hashpw.js 'your admin password'   # paste output as ADMIN_PASSWORD_HASH
```

**4. Run as a service:**
```bash
sudo cp deploy/mqtt-portal.service /etc/systemd/system/ && sudo systemctl enable --now mqtt-portal
```

**5. Put HTTPS in front** (own subdomain, e.g. `portal.example.com`):
```bash
sudo cp deploy/nginx-mqtt-portal.conf /etc/nginx/sites-available/mqtt-portal && sudo ln -s /etc/nginx/sites-available/mqtt-portal /etc/nginx/sites-enabled/ && sudo certbot --nginx -d portal.example.com && sudo systemctl reload nginx
```

Students go to `https://portal.example.com`, enter the class code, and get credentials.
You manage them at `https://portal.example.com/admin`.

## Security notes
- Registration is gated by `CLASS_CODE` (rotate it each term) and rate-limited.
- Admin password is stored **hashed** (scrypt); the session cookie is httpOnly/secure.
- Students are confined to `devices/%u/#` by the `student` role's pattern ACLs.
- The portal talks to the broker only over the **localhost** control listener (1883
  bound to 127.0.0.1); the public internet only ever sees TLS 8883.
- `mosquitto_ctrl` passes passwords as CLI args (visible in `ps` on that host). Fine for
  a single-admin class box; for multi-tenant use, switch `lib/dynsec.js` to the stdin/REPL
  mode. Left as a documented trade-off.

## Local development
```bash
npm install
npm run dev        # DYNSEC_MODE=mock, http, no broker needed -> http://127.0.0.1:3000
npm test           # pure-logic unit tests
```
Admin password in mock/dev: set `ADMIN_PASSWORD_HASH` via `npm run hashpw` first.
