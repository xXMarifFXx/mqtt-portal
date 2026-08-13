#!/usr/bin/env bash
# Read-only diagnostic for the mqtt-portal broker setup. Safe to run anytime.
#   sudo bash deploy/samebox/diagnose.sh
ENV="${1:-/opt/mqtt-portal/.env}"

# Read DYNSEC_ADMIN_PASS from .env, stripping any inline "# comment" and spaces.
DP=$(grep -E '^DYNSEC_ADMIN_PASS=' "$ENV" 2>/dev/null | sed -E 's/^DYNSEC_ADMIN_PASS=//; s/[[:space:]]+#.*$//; s/[[:space:]]+$//')
ctrl(){ mosquitto_ctrl -h 127.0.0.1 -p 1883 -u dynsec-admin -P "$DP" dynsec "$@" 2>&1; }

echo "================ 1. dynsec-admin auth (password from .env) ================"
echo "password length read from .env: ${#DP}"
if ctrl listClients >/dev/null 2>&1; then echo "RESULT: OK — dynsec-admin auth works"; else
  echo "RESULT: FAIL — dynsec-admin auth REJECTED. The rest will fail too."; fi

echo; echo "================ 2. dedicated monitor account / read-only role ================"
ctrl getClient portal-monitor
ctrl getRole observer

echo; echo "================ 3. broker clients (students use per-user ns-<username> roles) ================"
ctrl listClients

echo; echo "================ 4. default ACL access policy ================"
ctrl getDefaultACLAccess

echo; echo "================ 5. listeners (1883 control / 8083 ws / 8883 tls) ================"
ss -ltnp 2>/dev/null | grep -E ':1883|:8083|:8883' || echo "(no matching listeners!)"

echo; echo "================ 6. mosquitto config ================"
cat /etc/mosquitto/conf.d/nrbridge.conf 2>/dev/null

echo; echo "================ 7. recent mosquitto log (reason for denials/disconnects) ================"
journalctl -u mosquitto -n 40 --no-pager 2>/dev/null | tail -40

echo; echo "================ 8. portal readiness ================"
curl -fsS http://127.0.0.1:3001/readyz 2>/dev/null || echo "portal readiness FAILED"
