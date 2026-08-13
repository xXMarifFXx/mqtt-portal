#!/usr/bin/env bash
# Decrypt and verify an archive without changing the running system.
set -euo pipefail
umask 077

CONFIG_FILE="${MQTT_BACKUP_CONFIG:-/etc/mqtt-portal-backup.conf}"
[[ -f "$CONFIG_FILE" ]] && source "$CONFIG_FILE"
BACKUP_KEY_FILE="${BACKUP_KEY_FILE:-/root/.config/mqtt-portal/backup.key}"
archive="${1:-}"
[[ -n "$archive" && -r "$archive" ]] || { echo "Usage: $0 /path/to/backup.tar.gz.enc" >&2; exit 2; }
[[ -r "$BACKUP_KEY_FILE" ]] || { echo "ERROR: backup key not readable: $BACKUP_KEY_FILE" >&2; exit 1; }

work=$(mktemp -d "${TMPDIR:-/tmp}/mqtt-portal-verify.XXXXXX")
trap 'rm -rf "$work"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 \
  -pass "file:$BACKUP_KEY_FILE" -in "$archive" -out "$work/payload.tar.gz"

if tar -tzf "$work/payload.tar.gz" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "ERROR: unsafe path in archive" >&2; exit 1
fi
mkdir "$work/payload"
tar -C "$work/payload" -xzf "$work/payload.tar.gz"
[[ -r "$work/payload/SHA256SUMS" ]] || { echo "ERROR: checksum manifest missing" >&2; exit 1; }
(cd "$work/payload" && sha256sum -c SHA256SUMS >/dev/null)
[[ -r "$work/payload/portal/.env" ]] || { echo "ERROR: portal .env missing" >&2; exit 1; }
[[ -r "$work/payload/mosquitto/dynamic-security.json" ]] || { echo "ERROR: dynsec database missing" >&2; exit 1; }
echo "Backup is decryptable and internally consistent: $archive"

