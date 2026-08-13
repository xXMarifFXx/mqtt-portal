'use strict';
const assert = require('assert');
const fs = require('fs');
const setup = fs.readFileSync('deploy/samebox/setup-mosquitto.sh', 'utf8');
for (const directive of [
  'message_size_limit 16384', 'max_inflight_messages 20', 'max_inflight_bytes 262144',
  'max_queued_messages 100', 'max_queued_bytes 1048576', 'queue_qos0_messages false',
  'allow_anonymous false',
  'listener 8883', 'max_connections 200', 'listener 8083 127.0.0.1',
  'max_connections 100', 'listener 1883 127.0.0.1', 'max_connections 30',
  'MemoryMax=512M', 'LimitNOFILE=8192', 'mosquitto -c /etc/mosquitto/mosquitto.conf -t',
]) assert(setup.includes(directive), 'missing broker protection: ' + directive);
console.log('Mosquitto classroom resource-limit checks passed');
