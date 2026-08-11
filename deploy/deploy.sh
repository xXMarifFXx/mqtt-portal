#!/usr/bin/env bash
# One-command update for the MQTT portal (like the sni-eng.com deploy.sh).
# Pulls the latest code, installs deps, restarts the service, health-checks.
#   sudo bash /opt/mqtt-portal/deploy/deploy.sh
set -euo pipefail

cd /opt/mqtt-portal

echo "==> 1/4 Pulling latest code"
git pull --ff-only

echo "==> 2/4 Installing dependencies"
npm ci --omit=dev

echo "==> 3/4 Restarting the portal"
systemctl restart mqtt-portal
sleep 1

echo -n "==> 4/4 Health check: "
if curl -fs localhost:3001/healthz >/dev/null; then echo "OK ✓ portal is up"; else
  echo "FAILED — check: journalctl -u mqtt-portal -n 40 --no-pager"; exit 1; fi

echo "Done. https://mqtt.mariffb.my"
