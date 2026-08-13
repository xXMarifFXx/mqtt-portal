'use strict';
const assert = require('assert');
const D = require('../lib/dynsec');

const c = { host: 'h', port: '1883', admin: 'admin', pass: 'secret', mode: 'real' };
const command = (argv) => argv[argv.indexOf('dynsec') + 1];

function goodOutput(argv) {
  if (command(argv) === 'getClient') return 'Username: ada\nRoles: ns-ada (priority: -1)';
  if (command(argv) === 'getRole') return `Rolename: ns-ada
ACLs: publishClientSend : allow : devices/ada/#
      publishClientReceive : allow : devices/ada/#
      subscribePattern : allow : devices/ada/#`;
  return '';
}

(async () => {
  const successCalls = [];
  await D.provisionStudent(c, 'ada', 'password123', async (argv) => {
    successCalls.push(command(argv)); return goodOutput(argv);
  });
  assert(successCalls.includes('getClient') && successCalls.includes('getRole'), 'final state must be verified');

  const rollbackCalls = [];
  await assert.rejects(
    D.provisionStudent(c, 'ada', 'password123', async (argv) => {
      const cmd = command(argv); rollbackCalls.push(cmd);
      if (cmd === 'addRoleACL') throw new Error('broker write failed');
      return goodOutput(argv);
    }),
    /partial account rolled back/
  );
  assert(rollbackCalls.includes('deleteClient'), 'failed provisioning must delete client');
  assert(rollbackCalls.includes('deleteRole'), 'failed provisioning must delete newly created role');

  await D.provisionStudent(c, 'ada', 'password123', async (argv) => {
    if (command(argv) === 'addRoleACL') throw new Error('ACL with this topic already exists');
    return goodOutput(argv);
  });
  console.log('dynsec transactional provisioning tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
