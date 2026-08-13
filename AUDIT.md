# MQTT classroom system — full audit

Date: 2026-08-13

Portal commit: `f8439cae9b44ae259a1ea7696521e19219c14abb`

N-R_ESP32 commit: `0be0a1661392b54c8b2213cf4e7a3d2f50c86e9c`

Scope: `mqtt-portal`, Mosquitto/Caddy deployment files, N-R_ESP32 interoperability, Node-RED example flow.
Verdict: **NO-GO (1 P0, 7 P1, 12 P2)**.

## Profile

- Public, internet-facing Express/EJS portal controlling a Mosquitto Dynamic Security broker.
- Student devices connect over MQTT/TLS; browser console uses WSS; Node-RED is another MQTT client.
- Data includes broker credentials, usernames, optional student display names, class codes, connection presence and timestamps. Students may be minors.
- Deployment is a single VPS shared with another site, using Caddy, systemd, Mosquitto and JSON-file portal state.
- Availability target is a live classroom: account creation and MQTT messaging must work for a class sharing one network.

## P0 — release blocker

- [ ] **[Recovery] No tested backup/restore or deployment rollback.** `deploy/deploy.sh:9-21` pulls in place, installs and restarts, then only checks HTTP. It does not snapshot or restore `/etc/mosquitto/dynamic-security.json`, `/opt/mqtt-portal/.env`, portal `data/`, Mosquitto config/certs, or the previous application release. Repository search found no backup or restore runbook. A corrupt dynsec file, disk failure or failed deploy can remove the class accounts and leave no demonstrated recovery path. Add encrypted off-box backups, retention, restore verification, a pre-deploy snapshot and automatic application rollback; perform and record one restore drill.

  **Remediation implemented locally (2026-08-13):** `deploy/recovery/` now provides encrypted backups, checksum verification, an explicit restore workflow, a daily systemd timer and optional rclone off-box upload; `deploy/deploy.sh` takes a verified pre-deploy backup and rolls application code back on failure. The isolated recovery integration drill passes. This P0 remains open until the scripts are installed on the VPS, an off-box destination and separately stored key are confirmed, and a VPS restore drill succeeds.

## P1 — high priority

- [ ] **[Classroom correctness] Shared-campus NAT locks out student 21.** The registration limiter is `20` requests per IP per 15 minutes (`server.js:77`, applied at `server.js:85`). Successful registrations count too. A class on one Wi-Fi/public IP can exhaust this during normal enrollment. Limit failed class-code attempts separately, exempt successful registrations from the failure limit, and add an intentional class-wide capacity control.

  **Remediation implemented locally (2026-08-13):** valid class-code registrations bypass
  per-IP limiting; wrong codes are limited to 10/IP/15 minutes; authorized provisioning has a
  configurable whole-class cap of 200/hour. An integration test registers 25 students from
  one IP and then proves wrong-code throttling. Live deployment remains pending.

- [ ] **[Broker data integrity] Account provisioning is not transactional and hides ACL failures.** After creating a client, `createStudent()` suppresses every role/ACL error (`lib/dynsec.js:78-83`) and only reports the final role-assignment result. It can return success with missing permissions or leave orphan clients/roles on failure. Check idempotent “already exists” cases explicitly, fail on every other error, verify the resulting role/ACL/client binding, and roll back partial creation.

  **Remediation implemented locally (2026-08-13):** provisioning now checks each command,
  tolerates only explicit idempotent “already exists” results, reads the client and role back,
  verifies all three allow ACLs, and rolls back newly created client/role state on failure.
  Success, idempotency and forced-failure rollback tests pass. This remains open until tested
  against the live Mosquitto version on the VPS.

- [ ] **[End-to-end correctness] MQTT username and topic namespace can disagree.** Mosquitto accounts are authorized only for `devices/<username>/#` (`lib/dynsec.js:27-30`), while N-R_ESP32 publishes under `devices/<begin(deviceName)>/#` (`src/NodeBridge.cpp:52-58,152-163,216-228`). A board can authenticate and appear connected while all publishes are denied. The current MosquittoTLS example uses different values (`examples/MosquittoTLS/MosquittoTLS.ino:81,86`). Add a portal-specific example that uses the username as the namespace, or add an explicit authorized namespace API and make the portal display exact copy/paste code.

  **Remediation implemented locally (2026-08-13):** the portal now generates a complete,
  unit-tested sketch using one `MQTT_USERNAME` for both `login()` and `begin()`, with validated
  TLS. N-R_ESP32 1.1.3 adds the matching `MariffbPortal` example and fixes MosquittoTLS. This
  remains open until 1.1.3 is published/installed and a physical ESP32 → broker → portal →
  Node-RED test passes against the live VPS.

- [ ] **[Operations] Health and startup checks report false success.** `/healthz` always returns `{ok:true}` (`server.js:204`), even when broker control, Dynamic Security or the monitor are unavailable. Production startup validates only `SESSION_SECRET` (`server.js:59-64`); missing admin hash or dynsec password leaves an unusable portal running. The deploy script trusts this shallow check (`deploy/deploy.sh:19-21`). Add startup schema validation plus liveness/readiness endpoints that test broker control and monitor subscription separately.

  **Remediation implemented locally (2026-08-13):** production configuration now fails fast
  on missing/unsafe settings; `/healthz` is explicitly liveness-only; `/readyz` verifies dynsec
  control plus MQTT monitor connection/SUBACK; deploy and restore use readiness. Mock readiness
  and invalid-production startup tests pass. This remains open until the live deploy confirms
  readiness against Mosquitto.

- [ ] **[Data integrity] Corrupt JSON is silently treated as empty and then overwritten.** `lib/store.js:10-17` turns any read/parse/permission error into `{}`. `lib/codes.js:18-26` similarly recreates the class-code file, possibly from stale `CLASS_CODE`. Distinguish missing files from corruption, refuse destructive writes after parse errors, quarantine bad files, log/alert, and restore from backup.

- [ ] **[Abuse/availability] The public broker has no resource quotas in the supplied configuration.** `deploy/samebox/setup-mosquitto.sh:50-67` exposes TLS MQTT without connection, message-size, inflight, queued-message or per-client protections. Any valid student credential can flood its own namespace and consume resources on the shared VPS. Set and load-test conservative Mosquitto limits and OS/service limits appropriate to the class.

  **Remediation implemented locally (2026-08-13):** supplied Mosquitto setup now limits
  listener connections, message size, inflight/queued bytes and messages, disables anonymous
  access, validates configuration before restart, and installs systemd memory/task/fd limits.
  The portal service has cgroup/fd limits too. Static policy tests pass; this remains open until
  applied and load-tested on the VPS with the installed Mosquitto 2.0.x build.

- [ ] **[Privacy/compliance — scope must be confirmed] No privacy notice, retention schedule or incident procedure.** The portal collects usernames, optional names and activity timestamps but the repository has no notice or retention/deletion policy. If used for a commercial course or other activity in scope of Malaysia's PDPA, the notice and security/retention obligations need resolution before student rollout; minors require additional institutional review. Minimize display-name collection, publish a notice, define term-end deletion and document incident handling. This is not legal advice.

  **Remediation implemented locally (2026-08-13):** `/privacy` now provides a factual student
  notice; registration records notice acknowledgment; real names are discouraged; production
  requires a responsible-party/contact and 30-730 day retention setting; admin flags overdue
  accounts; a tested cleanup command is dry-run-first and explicit; the runbook covers backups,
  Node-RED data, incidents and minors. This remains open until the responsible institution
  confirms legal/policy scope, supplies real contact details, approves the notice and deploys it.

## P2 — medium priority

- [ ] **[Sessions] Production uses Express MemoryStore.** No session store is configured (`server.js:47-53`); the runtime itself warns that it leaks memory and does not scale. Admin sessions also disappear on restart. Use a small durable store (for example SQLite or Redis) with expiry.
- [ ] **[Security] Admin mutations have no CSRF token.** Routes at `server.js:129,143,161,166,172,178,189,197` rely on `SameSite=Lax`. Add per-session CSRF protection and origin checks.
- [ ] **[Least privilege] The monitor uses the dynsec administrator as a long-lived MQTT client.** `lib/monitor.js:24-45` also suppresses grant/connection errors. Create a separate read-only monitor client; do not give the admin a runtime role.
- [ ] **[Authorization drift] The “observer” role can publish to every student's topics.** `deploy/samebox/setup-mosquitto.sh:85-88` grants `publishClientSend devices/#` despite `lib/monitor.js:4` calling it read-only. Split monitor-read and Node-RED publish roles.
- [ ] **[Secret exposure] Admin and student passwords are passed in process arguments.** `lib/dynsec.js:23-48`, `lib/monitor.js:27-29` and diagnostic/setup scripts use `-P`/`-p`; local process inspection can expose them. Prefer the Dynamic Security control topic through a persistent authenticated connection or another secret-input mechanism, and restrict host process visibility meanwhile.
- [ ] **[Monitoring accuracy] Live-device state is unbounded and never reconciled.** `_status` only grows (`lib/monitor.js:17-22,41-44`), deleted users remain, subscribe failures are ignored, and errors are swallowed. Track monitor health, verify SUBACK, prune deleted/stale entries and expose “data stale” in the UI.
- [ ] **[Browser reliability] Console error handling cancels MQTT.js recovery.** Although `reconnectPeriod` is set, every `error` calls `client.end(true)` (`public/console.js:50-69`). Distinguish permanent auth failures from transient network errors and display SUBACK reason codes.
- [ ] **[Deployment drift] Broker setup and diagnostics still assume the broken shared `%u` role.** `setup-mosquitto.sh:6,81-84` creates `devices/%u/#`, which Mosquitto 2.0.x does not substitute; `diagnose.sh:15-19` checks that stale role and hard-codes one username. Generate/check per-user roles or require Mosquitto 2.1+, and make diagnostics enumerate real users.
- [ ] **[Library TLS] `secure()` without a CA is MITM-able.** `src/NodeBridge.cpp:65-72` calls `setInsecure()`. For `mqtt.mariffb.my`, ship a portal example with CA validation and time synchronization; make insecure TLS visibly opt-in.
- [ ] **[Library input safety] Device/root/key strings are not validated.** They feed topic/client-ID/JSON construction (`src/NodeBridge.cpp:52-58,152-158,216-228`). Long device names can truncate the unique chip suffix, `/+#` changes topic structure, and quotes make telemetry JSON invalid. Validate/copy identifiers and JSON-escape the device field.
- [ ] **[Runtime responsiveness] Broker outage can block the sketch repeatedly.** The synchronous connect is bounded to 5 seconds (`src/NodeBridge.cpp:81,100-112`) but retries every 3 seconds. This can starve a student's algorithm while the broker is down. Use a longer backoff with jitter and consider a nonblocking MQTT transport in a future major version.
- [ ] **[Quality/a11y] Coverage and UI accessibility are shallow.** Portal tests cover validators/argument builders but not HTTP auth flows, provisioning rollback, broker integration, monitor recovery, deployment or restore. The admin inputs lack programmatic labels (`views/admin.ejs:34-36,66-69,101-103`) and live status is not announced. Add CI integration tests and a WCAG keyboard/screen-reader pass.

## Efficiency and speed

- The N-R_ESP32 library itself is lightweight: two compiled source files and one dependency. First Arduino builds are dominated by the ESP32 core/toolchain and PubSubClient; the library cannot make a cold ESP32-core build instant.
- Runtime hot paths use bounded static buffers and avoid dynamic JSON allocation. The host parser suite passes with `-Wall -Wextra -pedantic`.
- Portal account creation launches five sequential `mosquitto_ctrl` processes (`lib/dynsec.js:78-84`). This is acceptable for occasional admin use but inefficient and failure-prone during simultaneous class registration. A persistent Dynamic Security control client plus a bounded provisioning queue would reduce latency and improve atomicity.
- Portal JSON files are synchronously read on each metadata lookup (`lib/store.js:10-37`). Small classes are fine; cache validated state or use SQLite before scaling beyond one process or hundreds of accounts.

## STRIDE summary

| Threat | Existing control | Main residual risk |
|---|---|---|
| Spoofing | TLS/WSS, username/password, scrypt admin hash | Insecure library TLS mode; credentials in firmware/argv |
| Tampering | Dynsec ACLs, admin route guard, atomic JSON rename | No CSRF; partial ACL provisioning; corruption overwritten |
| Repudiation | systemd/Mosquitto logs | No durable admin audit log for account/code changes |
| Information disclosure | HTTPS, Helmet, HttpOnly cookie, generic broker errors | CLI argv secrets; privacy notice absent |
| Denial of service | login/register rate limits, exec timeout, systemd restart | shared-NAT lockout; broker quotas absent; sync reconnect blocking |
| Elevation of privilege | per-user namespace roles | broad observer/admin runtime privileges; ACL setup drift |

## Supply chain and licenses

- `npm audit --omit=dev`: **0 known vulnerabilities**.
- `npm ls --omit=dev --depth=0`: clean; lockfile committed.
- Runtime dependency licenses observed: MIT/BSD/ISC/Apache-2.0/0BSD; no incompatible license found.
- N-R_ESP32 and PubSubClient are MIT-compatible.
- No tracked real `.env`, private key, dynsec database or obvious credential was found in the scanned Git history/files.
- No CI workflow, automated dependency update policy, SBOM artifact or release provenance is present. Add CI, lockfile audit, secret scan and CycloneDX SBOM generation.

## Verification performed

- Portal: `npm test` **13/13 pass**; all JavaScript parses; all deployment shell scripts pass `bash -n`; `npm audit` clean.
- Isolated production smoke: Helmet headers present; `/healthz` returned 200; Express emitted the MemoryStore production warning.
- Library: host parser/topic tests pass with strict compiler warnings.
- Current-machine ESP32 compile matrix was not rerun because `arduino-cli` is not installed in this environment. Previous tracker claims ESP32 core 2.0.18 and 3.3.11 compilation, but v1.1.2 requires a fresh CI compile matrix before release.

## Recommended fix order

1. Backup/restore + rollback drill.
2. Namespace contract and a known-good `mqtt.mariffb.my` example; integration-test ESP32 → broker → portal → Node-RED.
3. Transactional provisioning and real readiness checks/startup validation.
4. Classroom-safe registration limiting and broker resource quotas.
5. Privacy/retention decision and notice.
6. Separate monitor identity, CSRF, durable sessions, monitoring and CI/compile matrix.

## Primary external references

- Mosquitto Dynamic Security documentation: <https://mosquitto.org/documentation/dynamic-security/>
- Mosquitto control client manual: <https://mosquitto.org/man/mosquitto_ctrl-1.html>
- Mosquitto 2.1 release notes (`%u`/`%c` ACL substitution): <https://mosquitto.org/blog/2026/01/version-2-1-0-released/>
- Malaysia Personal Data Protection principles: <https://www.pdp.gov.my/ppdpv1/en/principles-of-personal-data-protection/>
- Malaysia guidance on privacy notices: <https://www.pdp.gov.my/ppdpv1/en/akta/guidance-on-the-preparation-of-personal-data-protection-notices/>
