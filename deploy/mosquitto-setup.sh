#!/usr/bin/env bash
#
# mosquitto-setup.sh — hardened Mosquitto MQTT broker for the N-R_ESP32 stack.
# Installs Mosquitto with TLS (Let's Encrypt) + username/password + firewall.
#
# Usage (on the VPS, as root):
#   1. Point a DNS A record (e.g. mqtt.example.com) at this server's public IP.
#   2. Edit the three CONFIG values below.
#   3. sudo bash mosquitto-setup.sh
#
# Re-running is safe: it updates config and re-issues/reloads as needed.
# Tested on Ubuntu 22.04/24.04 and Debian 12.

set -euo pipefail

# ----------------------------- CONFIG (edit me) -----------------------------
DOMAIN="mqtt.mariffb.my"       # the DNS name that points at THIS server
EMAIL="you@example.com"        # <-- EDIT: your email for Let's Encrypt expiry notices
MQTT_USER="esp32user"          # base user (superseded by Dynamic Security after enable-dynsec.sh)
# ---------------------------------------------------------------------------

CERTDIR="/etc/mosquitto/certs"
CONF="/etc/mosquitto/conf.d/nrbridge.conf"
PASSWD="/etc/mosquitto/passwd"
HOOK="/etc/letsencrypt/renewal-hooks/deploy/mosquitto.sh"

die() { echo "ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root (sudo bash $0)"
[[ "$DOMAIN" != "mqtt.example.com" ]] || die "edit DOMAIN at the top of this script first"
[[ "$EMAIL"  != "you@example.com"  ]] || die "edit EMAIL at the top of this script first"

echo ">> [1/7] Installing packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq mosquitto mosquitto-clients certbot ufw

echo ">> [2/7] Firewall (allow SSH, HTTP-for-certs, MQTTS 8883 only)..."
ufw allow OpenSSH        >/dev/null 2>&1 || ufw allow 22/tcp
ufw allow 80/tcp         >/dev/null   # certbot HTTP-01 (issue + renew)
ufw allow 8883/tcp       >/dev/null   # MQTT over TLS  (plaintext 1883 stays CLOSED)
yes | ufw enable         >/dev/null

echo ">> [3/7] Obtaining Let's Encrypt certificate for ${DOMAIN}..."
systemctl stop mosquitto 2>/dev/null || true      # free nothing on :80, just in case
certbot certonly --standalone --non-interactive --agree-tos \
  -m "$EMAIL" -d "$DOMAIN" --keep-until-expiring

echo ">> [4/7] Installing renewal deploy-hook (keeps broker certs fresh)..."
mkdir -p "$CERTDIR" "$(dirname "$HOOK")"
cat > "$HOOK" <<HOOK_EOF
#!/bin/sh
# Copy renewed certs where mosquitto (user 'mosquitto') can read them, then reload.
cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" "${CERTDIR}/fullchain.pem"
cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem"   "${CERTDIR}/privkey.pem"
chown mosquitto:mosquitto ${CERTDIR}/*.pem
chmod 640 ${CERTDIR}/*.pem
systemctl restart mosquitto
HOOK_EOF
chmod +x "$HOOK"
sh "$HOOK"    # run once now for the initial copy

echo ">> [5/7] Broker credentials..."
if [[ -f "$PASSWD" ]] && grep -q "^${MQTT_USER}:" "$PASSWD"; then
  echo "   user '${MQTT_USER}' already exists — leaving password unchanged."
else
  echo "   set a password for MQTT user '${MQTT_USER}':"
  if [[ -f "$PASSWD" ]]; then mosquitto_passwd "$PASSWD" "$MQTT_USER"
  else                        mosquitto_passwd -c "$PASSWD" "$MQTT_USER"; fi
fi
chown mosquitto:mosquitto "$PASSWD"; chmod 640 "$PASSWD"

echo ">> [6/7] Writing hardened config -> ${CONF}"
cat > "$CONF" <<CONF_EOF
# N-R_ESP32 broker — TLS + auth only, no anonymous, plaintext 1883 disabled.
per_listener_settings true

listener 8883
allow_anonymous false
password_file ${PASSWD}
certfile ${CERTDIR}/fullchain.pem
keyfile  ${CERTDIR}/privkey.pem
CONF_EOF

echo ">> [7/7] Enabling + starting mosquitto..."
systemctl enable mosquitto >/dev/null 2>&1 || true
systemctl restart mosquitto
sleep 1
systemctl --no-pager --full status mosquitto | head -n 6 || true

cat <<DONE

==================================================================
  Mosquitto is up:  ${DOMAIN}:8883  (TLS, auth required)
  User: ${MQTT_USER}

  Test from any machine with mosquitto-clients installed:
    mosquitto_sub -h ${DOMAIN} -p 8883 --capath /etc/ssl/certs \\
                  -u ${MQTT_USER} -P 'YOUR_PASSWORD' -t 'devices/#' -v

  ESP32 (N-R_ESP32):   .broker("${DOMAIN}").secure().login("${MQTT_USER}","...")
  Node-RED broker:     ${DOMAIN}, port 8883, TLS on, same user/password.

  Certs auto-renew (certbot timer) and reload via the deploy hook.
==================================================================
DONE
