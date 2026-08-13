#!/usr/bin/env bash
# Isolated backup -> verify -> damage -> restore drill. Never touches real VPS paths.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
testroot=$(mktemp -d "${TMPDIR:-/tmp}/mqtt-recovery-test.XXXXXX")
trap 'rm -rf "$testroot"' EXIT
mkdir -p "$testroot/portal/data" "$testroot/etc/mosquitto/conf.d" \
  "$testroot/etc/mosquitto/certs" "$testroot/etc/caddy" "$testroot/systemd" "$testroot/backups"
printf '%s\n' 'SESSION_SECRET=test-secret' > "$testroot/portal/.env"
printf '%s\n' '[{"code":"CLASS1"}]' > "$testroot/portal/data/classcodes.json"
printf '%s\n' '{"clients":[{"username":"student1"}]}' > "$testroot/etc/mosquitto/dynamic-security.json"
printf '%s\n' 'listener 8883' > "$testroot/etc/mosquitto/conf.d/nrbridge.conf"
printf '%s\n' 'fake-cert' > "$testroot/etc/mosquitto/certs/fullchain.pem"
printf '%s\n' 'mqtt.mariffb.my {}' > "$testroot/etc/caddy/Caddyfile"
printf '%s\n' '[Service]' > "$testroot/systemd/mqtt-portal.service"
openssl rand -base64 48 > "$testroot/key"
printf 'BACKUP_DIR=%s\nBACKUP_KEY_FILE=%s\nBACKUP_KEEP_DAYS=30\nMQTT_BACKUP_REMOTE=\n' \
  "$testroot/backups" "$testroot/key" > "$testroot/backup.conf"

recovery_env=(
  RECOVERY_TEST_MODE=1
  MQTT_BACKUP_CONFIG="$testroot/backup.conf"
  PORTAL_ROOT="$testroot/portal"
  DYNSEC_FILE="$testroot/etc/mosquitto/dynamic-security.json"
  MOSQUITTO_CONF="$testroot/etc/mosquitto/conf.d/nrbridge.conf"
  MOSQUITTO_CERT_DIR="$testroot/etc/mosquitto/certs"
  CADDY_FILE="$testroot/etc/caddy/Caddyfile"
  SERVICE_FILE="$testroot/systemd/mqtt-portal.service"
)

env "${recovery_env[@]}" "$ROOT/deploy/recovery/backup.sh"
archive=$(find "$testroot/backups" -name '*.tar.gz.enc' | head -n1)
env MQTT_BACKUP_CONFIG="$testroot/backup.conf" "$ROOT/deploy/recovery/verify-backup.sh" "$archive"

printf '%s\n' 'CORRUPTED' > "$testroot/portal/data/classcodes.json"
printf '%s\n' 'CORRUPTED' > "$testroot/etc/mosquitto/dynamic-security.json"
env "${recovery_env[@]}" "$ROOT/deploy/recovery/restore.sh" "$archive" --apply --yes
grep -q CLASS1 "$testroot/portal/data/classcodes.json"
grep -q student1 "$testroot/etc/mosquitto/dynamic-security.json"
echo "Recovery integration test passed"
