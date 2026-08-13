# Backup, restore and deployment rollback

The backup contains the Mosquitto Dynamic Security database, portal `.env` and `data/`,
Mosquitto listener configuration/certs, the portal systemd unit, a reference copy of the
Caddyfile, checksums and the deployed Git commit. It is encrypted with AES-256-CBC using
PBKDF2 and verified immediately after creation.

## One-time VPS setup

```bash
cd /opt/mqtt-portal && git pull --ff-only
sudo bash deploy/recovery/install.sh
sudo nano /etc/mqtt-portal-backup.conf
```

Set `MQTT_BACKUP_REMOTE` to an rclone remote on a different provider/account, install and
configure `rclone`, then run another backup:

```bash
sudo /opt/mqtt-portal/deploy/recovery/backup.sh
sudo systemctl status mqtt-portal-backup.timer --no-pager
```

Copy `/root/.config/mqtt-portal/backup.key` to an offline password manager or encrypted
drive. A backup without a separately stored key is not recoverable after total VPS loss.
Local backups are retained for 30 days by default. Set the off-box provider's independent
retention/versioning policy as well.

## Verify or restore

Verification is non-mutating:

```bash
sudo deploy/recovery/verify-backup.sh /var/backups/mqtt-portal/FILE.tar.gz.enc
sudo deploy/recovery/restore.sh /var/backups/mqtt-portal/FILE.tar.gz.enc
```

An actual restore is explicit, creates a safety backup first, stops both services, restores
critical state and verifies that they restart:

```bash
sudo deploy/recovery/restore.sh /var/backups/mqtt-portal/FILE.tar.gz.enc --apply
```

Perform a restore drill before relying on this for a class. The safest drill is on a second
temporary VPS. Record its date and result. The Caddyfile and certificates are reference-only
and are not automatically restored because this VPS also hosts S&I.

## Deployment rollback

`deploy/deploy.sh` now requires a clean deployment tree, takes and verifies a backup before
pulling, and remembers the previous Git commit. If dependency installation, restart or health
checking fails, it resets the deployment tree to that commit, reinstalls its locked
dependencies and restarts the previous application automatically. Persistent broker/portal
state is not rolled back during an application rollback; use `restore.sh` only when state is
known to be damaged.

