# Deploy on the SAME box as sni-eng.com (Caddy already runs here)

Your VPS already serves sni-eng.com via **Caddy on ports 80/443**. So we do **not** run
certbot or nginx (they'd fight Caddy for port 80 — that was the step-1 failure). Instead
Caddy serves the portal and proxies the browser test console; Mosquitto runs alongside for
device MQTT-over-TLS on 8883.

```
                       :443 (Caddy, existing)
Browser ──https──────────────────────────────► portal (Node :3000)
Browser ──wss  /mqtt ─────────────────────────► Mosquitto ws :8083 (localhost)
ESP32   ──mqtts :8883 ─────────────────────────► Mosquitto TLS (Caddy's cert, synced)
```

Run everything as root on the server (`sudo -i` or prefix with `sudo`). You already did DNS
(`mqtt.mariffb.my` → this server) and `git clone`. Assume the repo is at `/opt/mqtt-portal`
(copy it there: `sudo mkdir -p /opt/mqtt-portal && sudo cp -r . /opt/mqtt-portal`).

### 1. Tell Caddy about the subdomain
Append the block from `deploy/samebox/Caddyfile-snippet` to `/etc/caddy/Caddyfile`, then:
```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```
Caddy will obtain the Let's Encrypt cert for `mqtt.mariffb.my` within ~30 s. (The portal
isn't up yet, so it'll 502 for now — that's fine; the cert is what we need.)

### 2. Set up Mosquitto (installs it, syncs Caddy's cert, adds dynsec)
```bash
sudo bash /opt/mqtt-portal/deploy/samebox/setup-mosquitto.sh
```
Prompts you to set the **`dynsec-admin` password — write it down.**
👉 **Paste me the full output** — this is the part I couldn't test.

### 3. Keep the cert fresh automatically (follows renewals)
```bash
sudo cp /opt/mqtt-portal/deploy/samebox/mqtt-cert-sync.{service,timer} /etc/systemd/system/ \
  && sudo systemctl daemon-reload && sudo systemctl enable --now mqtt-cert-sync.timer
```

### 4. Install + configure the portal
```bash
node -v || (curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs)
sudo useradd -r -s /usr/sbin/nologin mqttportal 2>/dev/null; cd /opt/mqtt-portal && sudo npm ci --omit=dev
node /opt/mqtt-portal/scripts/hashpw.js 'PICK_AN_ADMIN_PASSWORD'; openssl rand -hex 32
sudo cp .env.example .env && sudo nano .env
```
In `.env` set: `NODE_ENV=production` · `CLASS_CODE=…` · `SESSION_SECRET=<openssl value>` ·
`ADMIN_PASSWORD_HASH=<hashpw value>` · `DYNSEC_ADMIN_PASS=<from step 2>`. Confirm
`PUBLIC_BROKER_HOST=mqtt.mariffb.my` and `PUBLIC_BROKER_WSS_URL=wss://mqtt.mariffb.my/mqtt`.
Then lock it down:
```bash
sudo chown -R mqttportal:mqttportal /opt/mqtt-portal/.env /opt/mqtt-portal/data 2>/dev/null; sudo mkdir -p /opt/mqtt-portal/data && sudo chown mqttportal:mqttportal /opt/mqtt-portal/data && sudo chmod 600 /opt/mqtt-portal/.env
```

### 5. Start the portal
```bash
sudo cp deploy/mqtt-portal.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now mqtt-portal && sleep 1 && curl -s localhost:3000/healthz
```
Expect `{"ok":true}`. Now open **https://mqtt.mariffb.my** — register a test student, then
open **/console**, Connect, and publish/subscribe to prove the whole chain.

### Firewall
Only **8883** must be public (devices) — `setup-mosquitto.sh` opens it. 80/443 are already
open for Caddy; 8083 and 1883 stay localhost-only.

### If step 2 errors
The dynsec plugin path or a `mosquitto_ctrl` flag can vary by version — that's all isolated
in `setup-mosquitto.sh` / `lib/dynsec.js`. Paste the output and I'll push a one-line fix.
