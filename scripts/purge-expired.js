'use strict';
require('dotenv').config();
const readline = require('readline');
const dynsec = require('../lib/dynsec');
const store = require('../lib/store');
const privacy = require('../lib/privacy');

const apply = process.argv.includes('--apply');
const yes = process.argv.includes('--yes');
const settings = privacy.settings();
const expired = store.entries().filter((row) => privacy.isExpired(row, settings.retentionDays));

async function confirm() {
  if (!apply) return false;
  if (yes) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`Delete ${expired.length} expired broker account(s)? Type DELETE: `, resolve));
  rl.close();
  return answer === 'DELETE';
}

(async () => {
  console.log(`Retention: ${settings.retentionDays} days; expired accounts: ${expired.length}`);
  for (const row of expired) console.log(`- ${row.username} (created ${row.createdAt || 'unknown'})`);
  if (!expired.length) return;
  if (!apply) {
    console.log('Dry run only. Re-run with --apply, review the list, and type DELETE.');
    return;
  }
  if (!(await confirm())) throw new Error('Deletion cancelled');
  let failed = 0;
  for (const row of expired) {
    try {
      await dynsec.deleteStudent(row.username);
      store.remove(row.username);
      console.log(`deleted ${row.username}`);
    } catch (e) {
      failed++;
      console.error(`FAILED ${row.username}: ${e.message}`);
    }
  }
  if (failed) throw new Error(`${failed} account deletion(s) failed; metadata was retained for retry`);
})().catch((e) => { console.error(e.message); process.exit(1); });
