#!/usr/bin/env bash
# Encrypted, integrity-checked backup of the MQTT portal and broker state.
set -euo pipefail
umask 077

CONFIG_FILE="${MQTT_BACKUP_CONFIG:-/etc/mqtt-portal-backup.conf}"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/mqtt-portal}"
BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-/root/.config/mqtt-portal/backup.key}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
PORTAL_ROOT="${PORTAL_ROOT:-/opt/mqtt-portal}"
DYNSEC_FILE="${DYNSEC_FILE:-/etc/mosquitto/dynamic-security.json}"
MOSQUITTO_CONF="${MOSQUITTO_CONF:-/etc/mosquitto/conf.d/nrbridge.conf}"
MOSQUITTO_CERT_DIR="${MOSQUITTO_CERT_DIR:-/etc/mosquitto/certs}"
CADDY_FILE="${CADDY_FILE:-/etc/caddy/Caddyfile}"
SERVICE_FILE="${SERVICE_FILE:-/etc/systemd/system/mqtt-portal.service}"

[[ $EUID -eq 0 || "${RECOVERY_TEST_MODE:-0}" == 1 ]] || { echo "ERROR: run as root" >&2; exit 1; }
[[ -r "$BACKUP_KEY_FILE" ]] || { echo "ERROR: backup key not readable: $BACKUP_KEY_FILE" >&2; exit 1; }
[[ $(wc -c < "$BACKUP_KEY_FILE") -ge 32 ]] || { echo "ERROR: backup key must contain at least 32 bytes" >&2; exit 1; }
[[ -r "$DYNSEC_FILE" ]] || { echo "ERROR: critical file missing: $DYNSEC_FILE" >&2; exit 1; }
[[ -r "$PORTAL_ROOT/.env" ]] || { echo "ERROR: critical file missing: $PORTAL_ROOT/.env" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
work=$(mktemp -d "${TMPDIR:-/tmp}/mqtt-portal-backup.XXXXXX")
trap 'rm -rf "$work"' EXIT
payload="$work/payload"
mkdir -p "$payload/portal/data" "$payload/mosquitto" "$payload/caddy" "$payload/systemd"

install -m 600 "$PORTAL_ROOT/.env" "$payload/portal/.env"
if [[ -d "$PORTAL_ROOT/data" ]]; then cp -a "$PORTAL_ROOT/data/." "$payload/portal/data/"; fi
# Sessions are ephemeral secrets; never back them up or resurrect old admin logins.
rm -rf "$payload/portal/data/sessions"
install -m 600 "$DYNSEC_FILE" "$payload/mosquitto/dynamic-security.json"
[[ -r "$MOSQUITTO_CONF" ]] && install -m 600 "$MOSQUITTO_CONF" "$payload/mosquitto/nrbridge.conf"
[[ -d "$MOSQUITTO_CERT_DIR" ]] && cp -a "$MOSQUITTO_CERT_DIR" "$payload/mosquitto/certs"
[[ -r "$CADDY_FILE" ]] && install -m 600 "$CADDY_FILE" "$payload/caddy/Caddyfile.reference-only"
[[ -r "$SERVICE_FILE" ]] && install -m 600 "$SERVICE_FILE" "$payload/systemd/mqtt-portal.service"

commit="unknown"
if git -C "$PORTAL_ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then commit=$(git -C "$PORTAL_ROOT" rev-parse HEAD); fi
cat > "$payload/BACKUP-METADATA.txt" <<META
format=1
created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
hostname=$(hostname)
portal_commit=$commit
META

(cd "$payload" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
name="mqtt-portal-${stamp}.tar.gz.enc"
plain="$work/payload.tar.gz"
final="$BACKUP_DIR/$name"
tar -C "$payload" -czf "$plain" .
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 \
  -pass "file:$BACKUP_KEY_FILE" -in "$plain" -out "$final"
sha256sum "$final" > "$final.sha256"
chmod 600 "$final" "$final.sha256"

"$(dirname "$0")/verify-backup.sh" "$final" >/dev/null

if [[ -n "${MQTT_BACKUP_REMOTE:-}" ]]; then
  command -v rclone >/dev/null || { echo "ERROR: MQTT_BACKUP_REMOTE is set but rclone is unavailable" >&2; exit 1; }
  rclone copyto "$final" "${MQTT_BACKUP_REMOTE%/}/$name"
  rclone copyto "$final.sha256" "${MQTT_BACKUP_REMOTE%/}/$name.sha256"
  echo "Off-box copy: ${MQTT_BACKUP_REMOTE%/}/$name"
else
  echo "WARNING: MQTT_BACKUP_REMOTE is empty; this backup exists only on this VPS." >&2
fi

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'mqtt-portal-*.tar.gz.enc*' -mtime "+$BACKUP_KEEP_DAYS" -delete
echo "Backup verified: $final"
