#!/usr/bin/env bash
# Verify by default. Use --apply to restore critical state on the VPS.
set -euo pipefail
umask 077

apply=0
yes=0
archive=""
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    --yes) yes=1 ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *) archive="$arg" ;;
  esac
done
[[ -n "$archive" ]] || { echo "Usage: $0 BACKUP [--apply] [--yes]" >&2; exit 2; }

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
"$SCRIPT_DIR/verify-backup.sh" "$archive"
if [[ $apply -eq 0 ]]; then
  echo "Verification only; no files changed. Add --apply to restore."
  exit 0
fi
[[ $EUID -eq 0 || "${RECOVERY_TEST_MODE:-0}" == 1 ]] || { echo "ERROR: run restore as root" >&2; exit 1; }
if [[ $yes -ne 1 ]]; then
  read -r -p "Restore portal and Mosquitto state from this backup? Type RESTORE: " answer
  [[ "$answer" == RESTORE ]] || { echo "Cancelled"; exit 1; }
fi

CONFIG_FILE="${MQTT_BACKUP_CONFIG:-/etc/mqtt-portal-backup.conf}"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"
BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-/root/.config/mqtt-portal/backup.key}"
PORTAL_ROOT="${PORTAL_ROOT:-/opt/mqtt-portal}"
DYNSEC_FILE="${DYNSEC_FILE:-/etc/mosquitto/dynamic-security.json}"
MOSQUITTO_CONF="${MOSQUITTO_CONF:-/etc/mosquitto/conf.d/nrbridge.conf}"

# Preserve the current state before replacing it. A failed safety backup aborts restore.
"$SCRIPT_DIR/backup.sh"

work=$(mktemp -d "${TMPDIR:-/tmp}/mqtt-portal-restore.XXXXXX")
trap 'rm -rf "$work"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -pass "file:$BACKUP_KEY_FILE" -in "$archive" -out "$work/payload.tar.gz"
mkdir "$work/payload"
tar -C "$work/payload" -xzf "$work/payload.tar.gz"
(cd "$work/payload" && sha256sum -c SHA256SUMS >/dev/null)

if [[ "${RECOVERY_TEST_MODE:-0}" != 1 ]]; then systemctl stop mqtt-portal mosquitto; fi
install -m 600 "$work/payload/portal/.env" "$PORTAL_ROOT/.env"
mkdir -p "$PORTAL_ROOT/data"
cp -a "$work/payload/portal/data/." "$PORTAL_ROOT/data/"
install -m 640 "$work/payload/mosquitto/dynamic-security.json" "$DYNSEC_FILE"
if [[ -r "$work/payload/mosquitto/nrbridge.conf" ]]; then install -m 644 "$work/payload/mosquitto/nrbridge.conf" "$MOSQUITTO_CONF"; fi

if [[ "${RECOVERY_TEST_MODE:-0}" != 1 ]]; then
  chown mqttportal:mqttportal "$PORTAL_ROOT/.env"
  chown -R mqttportal:mqttportal "$PORTAL_ROOT/data"
  chown mosquitto:mosquitto "$DYNSEC_FILE"
  systemctl start mosquitto mqtt-portal
  sleep 2
  systemctl is-active --quiet mosquitto
  systemctl is-active --quiet mqtt-portal
  curl -fsS http://127.0.0.1:3001/healthz >/dev/null
fi
echo "Restore completed and services verified. Caddy/cert copies are reference-only and were not overwritten."

