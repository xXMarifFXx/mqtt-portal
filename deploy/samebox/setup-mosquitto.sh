#!/usr/bin/env bash
# Same-box (shared with Caddy) Mosquitto setup:
#   - MQTT over TLS on 8883 (devices) using the Caddy-synced cert
#   - plaintext WebSocket on 127.0.0.1:8083 (Caddy proxies wss://.../mqtt here)
#   - plaintext control on 127.0.0.1:1883 (portal dynsec + Node-RED)
#   - Dynamic Security plugin + %u-scoped 'student' role + 'observer' role
#
# PREREQ: run deploy/samebox/sync-caddy-cert.sh FIRST (needs the Caddy cert present).
# Usage:  sudo bash deploy/samebox/setup-mosquitto.sh
set -euo pipefail

DOMAIN="mqtt.mariffb.my"
ADMIN_USER="dynsec-admin"
DYNSEC_JSON="/etc/mosquitto/dynamic-security.json"
CONF="/etc/mosquitto/conf.d/nrbridge.conf"
CERTDIR="/etc/mosquitto/certs"
CTRL="mosquitto_ctrl -h 127.0.0.1 -p 1883 -u ${ADMIN_USER}"

[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }

echo ">> Installing mosquitto..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq mosquitto mosquitto-clients ufw

[[ -f "$CERTDIR/fullchain.pem" ]] || {
  echo "ERROR: $CERTDIR/fullchain.pem missing."
  echo "       Run deploy/samebox/sync-caddy-cert.sh first (after Caddy has the cert)."
  exit 1; }

PLUGIN="$(find /usr/lib -name 'mosquitto_dynamic_security.so' 2>/dev/null | head -n1 || true)"
[[ -n "$PLUGIN" ]] || { echo "ERROR: mosquitto_dynamic_security.so not found (need Mosquitto 2.x)"; exit 1; }
echo "   plugin: $PLUGIN"

if [[ ! -f "$DYNSEC_JSON" ]]; then
  echo ">> Initialising Dynamic Security — set a password for '${ADMIN_USER}' (write it down!):"
  mosquitto_ctrl dynsec init "$DYNSEC_JSON" "$ADMIN_USER"
  chown mosquitto:mosquitto "$DYNSEC_JSON"; chmod 640 "$DYNSEC_JSON"
fi

echo ">> Writing $CONF"
cat > "$CONF" <<CONF_EOF
plugin ${PLUGIN}
plugin_opt_config_file ${DYNSEC_JSON}

# Devices — MQTT over TLS (public):
listener 8883
certfile ${CERTDIR}/fullchain.pem
keyfile  ${CERTDIR}/privkey.pem

# Browser console — plaintext WebSocket on localhost; Caddy terminates TLS and
# proxies wss://${DOMAIN}/mqtt to here:
listener 8083 127.0.0.1
protocol websockets

# Portal control + Node-RED — localhost plaintext:
listener 1883 127.0.0.1
CONF_EOF

command -v ufw >/dev/null && ufw allow 8883/tcp >/dev/null 2>&1 || true
systemctl restart mosquitto; sleep 1

echo ">> Creating roles..."
$CTRL dynsec createRole student  2>/dev/null || echo "   (student role exists)"
$CTRL dynsec addRoleACL student  publishClientSend    'devices/%u/#' allow || true
$CTRL dynsec addRoleACL student  publishClientReceive 'devices/%u/#' allow || true
$CTRL dynsec addRoleACL student  subscribePattern     'devices/%u/#' allow || true
$CTRL dynsec createRole observer 2>/dev/null || echo "   (observer role exists)"
$CTRL dynsec addRoleACL observer subscribePattern     'devices/#' allow || true
$CTRL dynsec addRoleACL observer publishClientReceive 'devices/#' allow || true
$CTRL dynsec addRoleACL observer publishClientSend    'devices/#' allow || true

echo ""
echo "=================================================================="
echo "  Mosquitto ready:  ${DOMAIN}:8883 (devices, TLS)"
echo "                    wss://${DOMAIN}/mqtt (browser, via Caddy)"
echo "  Put the '${ADMIN_USER}' password into the portal .env as DYNSEC_ADMIN_PASS."
echo "=================================================================="
