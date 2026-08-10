#!/usr/bin/env bash
#
# enable-dynsec.sh — switch the Mosquitto broker to the Dynamic Security plugin
# and create a %u-scoped "student" role, so the web portal can manage users.
#
# !!! TEST ON A SCRATCH BROKER FIRST !!!
# This reconfigures auth. mosquitto_ctrl flags and the plugin path can vary by
# version/distro — this script tries to detect them, but verify before using on
# a broker you care about. Run AFTER mosquitto-setup.sh (TLS on 8883).
#
# Usage (VPS, root):  sudo bash enable-dynsec.sh
set -euo pipefail

ADMIN_USER="dynsec-admin"
DYNSEC_JSON="/etc/mosquitto/dynamic-security.json"
CONF="/etc/mosquitto/conf.d/nrbridge.conf"     # from mosquitto-setup.sh
CTRL="mosquitto_ctrl -h 127.0.0.1 -p 1883 -u ${ADMIN_USER}"

die(){ echo "ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root"
command -v mosquitto_ctrl >/dev/null || die "mosquitto_ctrl not found (apt install mosquitto-clients)"

echo ">> Locating the dynamic-security plugin..."
PLUGIN="$(find /usr/lib -name 'mosquitto_dynamic_security.so' 2>/dev/null | head -n1 || true)"
[[ -n "$PLUGIN" ]] || die "mosquitto_dynamic_security.so not found — is Mosquitto 2.x installed?"
echo "   found: $PLUGIN"

if [[ ! -f "$DYNSEC_JSON" ]]; then
  echo ">> Initialising dynamic security (set a password for '${ADMIN_USER}' when prompted)..."
  mosquitto_ctrl dynsec init "$DYNSEC_JSON" "$ADMIN_USER"
  chown mosquitto:mosquitto "$DYNSEC_JSON"; chmod 640 "$DYNSEC_JSON"
else
  echo ">> $DYNSEC_JSON already exists — keeping it."
fi

echo ">> Writing broker config (TLS 8883 public + localhost 1883 control listener)..."
# Read the cert paths already set up by mosquitto-setup.sh, if present.
CERTDIR="/etc/mosquitto/certs"
cat > "$CONF" <<CONF_EOF
# Dynamic Security is the auth backend for ALL listeners.
plugin ${PLUGIN}
plugin_opt_config_file ${DYNSEC_JSON}

# Public, TLS, for devices:
listener 8883
certfile ${CERTDIR}/fullchain.pem
keyfile  ${CERTDIR}/privkey.pem

# Public, TLS over WebSockets, for the browser test console (portal /console page):
listener 8084
protocol websockets
certfile ${CERTDIR}/fullchain.pem
keyfile  ${CERTDIR}/privkey.pem

# Localhost-only, plaintext, for the portal + Node-RED + mosquitto_ctrl:
listener 1883 127.0.0.1
CONF_EOF

echo ">> Opening the WebSocket TLS port (8084) in the firewall..."
command -v ufw >/dev/null && ufw allow 8084/tcp >/dev/null 2>&1 || true

echo ">> Restarting mosquitto..."
systemctl restart mosquitto
sleep 1

echo ">> Creating the %u-scoped 'student' role (idempotent-ish)..."
$CTRL dynsec createRole student 2>/dev/null || echo "   (role may already exist)"
$CTRL dynsec addRoleACL student publishClientSend    'devices/%u/#' allow || true
$CTRL dynsec addRoleACL student publishClientReceive 'devices/%u/#' allow || true
$CTRL dynsec addRoleACL student subscribePattern     'devices/%u/#' allow || true

echo ">> Creating an 'observer' role (full devices/# read) for Node-RED..."
$CTRL dynsec createRole observer 2>/dev/null || echo "   (role may already exist)"
$CTRL dynsec addRoleACL observer subscribePattern     'devices/#' allow || true
$CTRL dynsec addRoleACL observer publishClientReceive 'devices/#' allow || true
$CTRL dynsec addRoleACL observer publishClientSend    'devices/#' allow || true

cat <<DONE

==================================================================
  Dynamic Security is ON.
  * Admin client for the portal:  ${ADMIN_USER}  (password you just set)
    -> put it in the portal .env as DYNSEC_ADMIN_PASS
  * Students get the 'student' role  -> scoped to devices/<their-username>/#
  * For Node-RED, create an account with the 'observer' role, e.g.:
      ${CTRL} dynsec createClient nodered
      ${CTRL} dynsec addClientRole nodered observer
  Verify a student can ONLY reach its own namespace before class!
==================================================================
DONE
