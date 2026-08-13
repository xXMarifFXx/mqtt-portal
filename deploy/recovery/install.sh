#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo "ERROR: run as root" >&2; exit 1; }
ROOT=/opt/mqtt-portal
mkdir -p /root/.config/mqtt-portal /var/backups/mqtt-portal
if [[ ! -f /root/.config/mqtt-portal/backup.key ]]; then
  openssl rand -base64 48 > /root/.config/mqtt-portal/backup.key
fi
chmod 600 /root/.config/mqtt-portal/backup.key
if [[ ! -f /etc/mqtt-portal-backup.conf ]]; then
  install -m 600 "$ROOT/deploy/recovery/backup.env.example" /etc/mqtt-portal-backup.conf
fi
install -m 644 "$ROOT/deploy/recovery/mqtt-portal-backup.service" /etc/systemd/system/mqtt-portal-backup.service
install -m 644 "$ROOT/deploy/recovery/mqtt-portal-backup.timer" /etc/systemd/system/mqtt-portal-backup.timer
systemctl daemon-reload
systemctl enable --now mqtt-portal-backup.timer
"$ROOT/deploy/recovery/backup.sh"
echo "IMPORTANT: configure MQTT_BACKUP_REMOTE in /etc/mqtt-portal-backup.conf and store a second copy of the key outside this VPS."

