# Privacy and term-end retention runbook

Before production deployment, set these real values in `/opt/mqtt-portal/.env`:

```dotenv
DATA_RETENTION_DAYS=180
PRIVACY_CONTROLLER=Institution or instructor responsible for the class
PRIVACY_CONTACT=working-email-or-contact-channel
```

The software notice is a factual baseline, not a substitute for your institution's legal,
minor-consent, ethics or records requirements. Confirm whether Malaysia's PDPA and any school
policy applies to your course. If Node-RED stores MQTT payloads, document and delete that data
separately—the portal cannot see every Node-RED database or flow context.

## Monthly and term-end review

The cleanup command is deliberately dry-run by default:

```bash
cd /opt/mqtt-portal
sudo -u mqttportal node scripts/purge-expired.js
```

Review the usernames with the instructor. To delete those broker accounts and their portal
metadata, take a verified backup and then explicitly apply:

```bash
sudo deploy/recovery/backup.sh
sudo -u mqttportal node scripts/purge-expired.js --apply
```

Type `DELETE` when prompted. A failed broker deletion retains portal metadata so the operation
can be retried. Do not use `--yes` interactively; it exists only for controlled automated tests.

Also perform these term-end actions:

1. Remove old class codes in `/admin`.
2. Delete any Node-RED flow/context/database telemetry that is no longer needed.
3. Let encrypted backups expire under the configured backup retention policy.
4. Record the cleanup date, operator and failures in the institution's records.
5. For an incident, preserve relevant logs, disable affected accounts, reset credentials,
   assess notification duties and follow the institution's incident-response procedure.
