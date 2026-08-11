#!/usr/bin/env bash
# Copy the Caddy-managed cert for mqtt.mariffb.my into Mosquitto's cert dir, so the
# broker's TLS listener (8883) uses the same real Let's Encrypt cert Caddy obtained.
# Safe to re-run; a systemd timer runs it daily to follow Caddy's renewals.
set -euo pipefail

DOMAIN="mqtt.mariffb.my"
CADDY_STORE="/var/lib/caddy/.local/share/caddy/certificates"
DEST="/etc/mosquitto/certs"

[[ $EUID -eq 0 ]] || { echo "run as root"; exit 1; }

CRT="$(find "$CADDY_STORE" -name "${DOMAIN}.crt" 2>/dev/null | head -n1)"
KEY="$(find "$CADDY_STORE" -name "${DOMAIN}.key" 2>/dev/null | head -n1)"
if [[ -z "$CRT" || -z "$KEY" ]]; then
  echo "ERROR: Caddy cert for ${DOMAIN} not found under ${CADDY_STORE}."
  echo "       Add the Caddy site block + 'systemctl reload caddy', wait ~30s, then re-run."
  exit 1
fi

mkdir -p "$DEST"
if id -u mosquitto >/dev/null 2>&1; then OWN=(-o mosquitto -g mosquitto); else echo "note: 'mosquitto' user not present yet; copying as root"; OWN=(); fi
install "${OWN[@]}" -m 640 "$CRT" "$DEST/fullchain.pem"
install "${OWN[@]}" -m 640 "$KEY" "$DEST/privkey.pem"
systemctl reload mosquitto 2>/dev/null || systemctl restart mosquitto 2>/dev/null || true
echo "Synced Caddy cert for ${DOMAIN} -> ${DEST} and reloaded mosquitto."
