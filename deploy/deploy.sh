#!/usr/bin/env bash
# Safe in-place update: backup, deploy, verify, and automatically roll back code on failure.
set -Eeuo pipefail

ROOT=/opt/mqtt-portal
cd "$ROOT"

[[ -z "$(git status --porcelain)" ]] || { echo "ERROR: deployment tree has local changes; aborting." >&2; exit 1; }
previous_commit=$(git rev-parse HEAD)
rollback_started=0

# A freshly restarted Node process can take a moment to bind its port. Keep
# expected connection-refused retries quiet; report one clear failure only
# after the complete startup window has elapsed.
wait_for_portal() {
  local endpoint=$1
  local attempts=${2:-20}
  local i
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS --max-time 3 "http://127.0.0.1:3001${endpoint}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: portal did not pass ${endpoint} after ${attempts} seconds." >&2
  echo "Inspect: systemctl status mqtt-portal --no-pager --full" >&2
  echo "         journalctl -u mqtt-portal -n 80 --no-pager" >&2
  return 1
}

rollback() {
  rc=$?
  [[ $rollback_started -eq 0 ]] || exit "$rc"
  rollback_started=1
  trap - ERR
  set +e
  echo "DEPLOY FAILED (exit $rc) — rolling application back to $previous_commit" >&2
  git reset --hard "$previous_commit"
  npm ci --omit=dev
  systemctl restart mqtt-portal
  # The previous release may predate /readyz, so rollback checks process liveness.
  if wait_for_portal /healthz; then
    echo "Rollback succeeded; previous application is serving." >&2
  else
    echo "ROLLBACK FAILED — inspect: journalctl -u mqtt-portal -n 80 --no-pager" >&2
  fi
  exit "$rc"
}
trap rollback ERR

echo "==> 1/5 Creating and verifying pre-deploy backup"
"$ROOT/deploy/recovery/backup.sh"

echo "==> 2/5 Pulling latest code"
git pull --ff-only

echo "==> 3/5 Installing locked production dependencies"
npm ci --omit=dev

echo "==> 4/5 Restarting the portal"
systemctl restart mqtt-portal

echo "==> 5/5 Health check"
wait_for_portal /readyz
trap - ERR
echo "Deploy succeeded: $(git rev-parse --short HEAD) — https://mqtt.mariffb.my"
