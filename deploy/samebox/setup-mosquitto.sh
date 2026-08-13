#!/usr/bin/env bash
# Same-box (shared with Caddy) Mosquitto setup:
#   - MQTT over TLS on 8883 (devices) using the Caddy-synced cert
#   - plaintext WebSocket on 127.0.0.1:8083 (Caddy proxies wss://.../mqtt here)
#   - plaintext control on 127.0.0.1:1883 (portal dynsec + Node-RED)
#   - Dynamic Security plugin + per-student roles created by the portal + read-only monitor
#
# PREREQ: run deploy/samebox/sync-caddy-cert.sh FIRST (needs the Caddy cert present).
# Usage:  sudo bash deploy/samebox/setup-mosquitto.sh
set -euo pipefail

DOMAIN="mqtt.mariffb.my"
ADMIN_USER="dynsec-admin"
DYNSEC_JSON="/etc/mosquitto/dynamic-security.json"
CONF="/etc/mosquitto/conf.d/nrbridge.conf"
CERTDIR="/etc/mosquitto/certs"

[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }

echo ">> Installing mosquitto..."
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
apt-get update -qq && apt-get install -y -qq mosquitto mosquitto-clients ufw

# mosquitto is now installed (so the 'mosquitto' user exists) — pull in Caddy's cert.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo ">> Syncing Caddy's TLS cert into mosquitto..."
bash "$SCRIPT_DIR/sync-caddy-cert.sh" || true
[[ -f "$CERTDIR/fullchain.pem" ]] || {
  echo "ERROR: cert still missing after sync — has Caddy issued mqtt.mariffb.my yet?"
  echo "       Check:  sudo find /var/lib/caddy -name 'mqtt.mariffb.my.crt'"
  exit 1; }

PLUGIN="$(find /usr/lib -name 'mosquitto_dynamic_security.so' 2>/dev/null | head -n1 || true)"
[[ -n "$PLUGIN" ]] || { echo "ERROR: mosquitto_dynamic_security.so not found (need Mosquitto 2.x)"; exit 1; }
echo "   plugin: $PLUGIN"

if [[ ! -f "$DYNSEC_JSON" ]]; then
  echo ">> Initialising Dynamic Security — set a password for '${ADMIN_USER}' (write it down!):"
  mosquitto_ctrl dynsec init "$DYNSEC_JSON" "$ADMIN_USER"
  chown mosquitto:mosquitto "$DYNSEC_JSON"; chmod 640 "$DYNSEC_JSON"
fi

# Capture the admin password ONCE so the role commands below don't prompt for each one.
# Fresh run: enter the password you just set. Re-run: enter that same password.
read -rsp ">> Enter the '${ADMIN_USER}' password (for role setup): " ADMIN_PW; echo
[[ -n "$ADMIN_PW" ]] || { echo "empty password — aborting"; exit 1; }
ctrl() { mosquitto_ctrl -h 127.0.0.1 -p 1883 -u "$ADMIN_USER" -P "$ADMIN_PW" "$@"; }
read -rsp ">> Set a SEPARATE portal-monitor password (min 12 chars): " MONITOR_PW; echo
[[ ${#MONITOR_PW} -ge 12 ]] || { echo "monitor password too short — aborting"; exit 1; }

echo ">> Writing $CONF"
cat > "$CONF" <<CONF_EOF
plugin ${PLUGIN}
plugin_opt_config_file ${DYNSEC_JSON}

# Classroom-safe global resource bounds. N-R_ESP32 payloads are <=512 bytes by default;
# 16 KiB leaves ample room for Node-RED while rejecting accidental/hostile huge publishes.
message_size_limit 16384
max_inflight_messages 20
max_inflight_bytes 262144
max_queued_messages 100
max_queued_bytes 1048576
queue_qos0_messages false
allow_anonymous false

# Devices — MQTT over TLS (public):
listener 8883
max_connections 200
certfile ${CERTDIR}/fullchain.pem
keyfile  ${CERTDIR}/privkey.pem

# Browser console — plaintext WebSocket on localhost; Caddy terminates TLS and
# proxies wss://${DOMAIN}/mqtt to here:
listener 8083 127.0.0.1
max_connections 100
protocol websockets

# Portal control + Node-RED — localhost plaintext:
listener 1883 127.0.0.1
max_connections 30
CONF_EOF

# Bound broker resources at systemd/cgroup level as a final safety net for the shared VPS.
mkdir -p /etc/systemd/system/mosquitto.service.d
cat > /etc/systemd/system/mosquitto.service.d/classroom-limits.conf <<'LIMITS_EOF'
[Service]
LimitNOFILE=8192
TasksMax=256
MemoryMax=512M
Restart=on-failure
RestartSec=3
LIMITS_EOF
systemctl daemon-reload

# Refuse to restart into an invalid configuration.
mosquitto -c /etc/mosquitto/mosquitto.conf -t

command -v ufw >/dev/null && ufw allow 8883/tcp >/dev/null 2>&1 || true
systemctl restart mosquitto; sleep 1

# Verify the admin password NOW — otherwise the role commands below fail auth
# silently (|| true) and the ACLs never get applied.
if ! ctrl dynsec listClients >/dev/null 2>&1; then
  echo "ERROR: the '${ADMIN_USER}' password was rejected — roles NOT created."
  echo "       Re-run this script and enter the correct password."
  exit 1
fi

echo ">> Creating read-only monitor role..."
ctrl dynsec createRole observer 2>/dev/null || echo "   (observer role exists)"
ctrl dynsec addRoleACL observer subscribePattern     'devices/#' allow || true
ctrl dynsec addRoleACL observer publishClientReceive 'devices/#' allow || true
# Remove the historical broad publish grant. The portal monitor is read-only.
ctrl dynsec removeRoleACL observer publishClientSend 'devices/#' 2>/dev/null || true
ctrl dynsec removeClientRole "$ADMIN_USER" observer 2>/dev/null || true

echo ">> Creating dedicated read-only portal monitor..."
if ctrl dynsec getClient portal-monitor >/dev/null 2>&1; then
  ctrl dynsec setClientPassword portal-monitor "$MONITOR_PW"
else
  ctrl dynsec createClient portal-monitor -p "$MONITOR_PW"
fi
ctrl dynsec addClientRole portal-monitor observer 2>/dev/null || true

echo ""
echo "=================================================================="
echo "  Mosquitto ready:  ${DOMAIN}:8883 (devices, TLS)"
echo "                    wss://${DOMAIN}/mqtt (browser, via Caddy)"
echo "  Put the '${ADMIN_USER}' password into .env as DYNSEC_ADMIN_PASS."
echo "  Put the separate monitor password into .env as MONITOR_PASS."
echo "=================================================================="
