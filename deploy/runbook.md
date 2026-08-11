# MQTT Class Portal — Deployment Runbook (same Vultr box as sni-eng.com)

Mirrors the sni-eng.com runbook. You copy-paste commands **into the server's
terminal** (over SSH). `CAPS` = a placeholder to replace. The portal lives at
**https://mqtt.mariffb.my**, sharing the box's existing **Caddy** (so no certbot/nginx).

> **Which machine am I on?** On the **server** your prompt is `root@vultr:~#` and
> `apt-get` works. On your **Mac** it's `…DrAriff-2 … %` and `apt-get` is "not found".
> If you see `%`, `ssh` back in.

---

## 1. Point DNS  ✅ (done)
`mqtt.mariffb.my` A record → your server IP.

## 2. Connect to the server (from your Mac)
```bash
ssh root@SERVER_IP        # same login you use for sni-eng.com
```

## 3. Get the code onto the server (deploy key — same as S&I)
The default key `/root/.ssh/id_ed25519` is already a deploy key for **sni-website**, and
GitHub won't reuse one key on two repos — so make a **second** key for this repo:
```bash
ssh-keygen -t ed25519 -f /root/.ssh/mqtt_portal -N "" && cat /root/.ssh/mqtt_portal.pub
```
Copy the printed line. In GitHub: **mqtt-portal repo → Settings → Deploy keys → Add deploy
key** → paste → leave "Allow write access" **unchecked** → Add. Then teach git to use it:
```bash
printf 'Host github-mqtt\n  HostName github.com\n  User git\n  IdentityFile /root/.ssh/mqtt_portal\n  IdentitiesOnly yes\n' >> /root/.ssh/config
git clone git@github-mqtt:xXMarifFXx/mqtt-portal.git /opt/mqtt-portal && cd /opt/mqtt-portal
```
(Type `yes` if asked to trust github.com.)

> Prefer zero GitHub steps? The repo has **no secrets** — you can instead make it Public
> (repo → Settings → Change visibility) and `git clone https://github.com/xXMarifFXx/mqtt-portal.git /opt/mqtt-portal`.

## 4. Tell Caddy about the subdomain
```bash
sudo tee -a /etc/caddy/Caddyfile < /opt/mqtt-portal/deploy/samebox/Caddyfile-snippet && sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```
Wait ~30 s (Caddy fetches the cert; visiting the URL 502s until the app is up — fine).

## 5. Mosquitto + Dynamic Security  ⏸️ CHECKPOINT
```bash
sudo bash /opt/mqtt-portal/deploy/samebox/sync-caddy-cert.sh
sudo bash /opt/mqtt-portal/deploy/samebox/setup-mosquitto.sh
```
Sets a `dynsec-admin` password (**write it down**). **Paste me both outputs** before step 6.

## 6. Keep the cert fresh, install + run the portal
```bash
sudo cp /opt/mqtt-portal/deploy/samebox/mqtt-cert-sync.{service,timer} /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now mqtt-cert-sync.timer
node -v || (curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs)
sudo useradd -r -s /usr/sbin/nologin mqttportal 2>/dev/null; cd /opt/mqtt-portal && sudo npm ci --omit=dev
node scripts/hashpw.js 'PICK_AN_ADMIN_PASSWORD'; openssl rand -hex 32
sudo cp .env.example .env && sudo nano .env
```
In `.env`: `NODE_ENV=production` · `CLASS_CODE=…` · `SESSION_SECRET=<openssl>` ·
`ADMIN_PASSWORD_HASH=<hashpw>` · `DYNSEC_ADMIN_PASS=<from step 5>`. (Host + wss URL are
already set to `mqtt.mariffb.my`.) Then:
```bash
sudo mkdir -p data && sudo chown mqttportal:mqttportal data && sudo chmod 600 .env && sudo chown mqttportal:mqttportal .env
sudo cp deploy/mqtt-portal.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now mqtt-portal && sleep 1 && curl -s localhost:3000/healthz
```
Expect `{"ok":true}`. Open **https://mqtt.mariffb.my**, register, and use **/console** to test.

## Updating later
```bash
cd /opt/mqtt-portal && git pull && sudo npm ci --omit=dev && sudo systemctl restart mqtt-portal
```

## Handy
| Task | Command |
|------|---------|
| Portal status | `systemctl status mqtt-portal --no-pager` |
| Portal logs | `journalctl -u mqtt-portal -f` |
| Broker status | `systemctl status mosquitto --no-pager` |
| Broker logs | `journalctl -u mosquitto -f` |
