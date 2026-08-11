/* Browser MQTT test console — connects to the broker over WebSocket (wss) with
   MQTT.js using the student's own credentials. No data touches the portal server. */
(function () {
  'use strict';
  var wssDefault = document.body.dataset.wss || '';
  var user0 = document.body.dataset.user || '';
  var client = null;

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $('status');
  var devEl = $('devstatus');
  var myUser = '';

  function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = 'badge ' + cls; }
  function setDev(text, cls) { if (devEl) { devEl.textContent = text; devEl.className = 'badge ' + cls; } }
  function enable(on) { $('subBtn').disabled = !on; $('pubBtn').disabled = !on; }

  // Prefill topics from the username
  function prefill(u) {
    if (u && !$('subTopic').value) $('subTopic').value = 'devices/' + u + '/#';
    if (u && !$('pubTopic').value) $('pubTopic').value = 'devices/' + u + '/test';
  }
  prefill(user0);
  $('user').addEventListener('change', function () { prefill($('user').value.trim()); });

  function log(topic, payload) {
    var box = $('messages');
    if (box.querySelector('em')) box.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'msg';
    var t = new Date().toLocaleTimeString();
    row.innerHTML = '<span class="mt"></span> <span class="mtopic"></span> <span class="mpay"></span>';
    row.querySelector('.mt').textContent = t;
    row.querySelector('.mtopic').textContent = topic;
    row.querySelector('.mpay').textContent = payload;
    box.insertBefore(row, box.firstChild);
    while (box.childNodes.length > 50) box.removeChild(box.lastChild);
  }

  $('connect').addEventListener('click', function () {
    if (client) { client.end(true); client = null; }
    var url = $('wss').value.trim();
    var username = $('user').value.trim();
    var password = $('pass').value;
    myUser = username;
    setStatus('connecting…', 'warn');
    setDev('— waiting…', 'off');
    enable(false);

    client = mqtt.connect(url, {
      username: username,
      password: password,
      connectTimeout: 8000,
      reconnectPeriod: 0,          // manual — don't hammer the broker on bad creds
      clientId: 'console-' + Math.floor(Math.random() * 1e6),
    });

    client.on('connect', function () {
      setStatus('connected', 'on'); enable(true);
      // Auto-watch this student's whole namespace so their device shows up immediately.
      if (myUser) client.subscribe('devices/' + myUser + '/#');
    });
    client.on('reconnect', function () { setStatus('reconnecting…', 'warn'); });
    client.on('close', function () { setStatus('disconnected', 'off'); enable(false); setDev('— (not connected to broker)', 'off'); });
    client.on('error', function (e) {
      setStatus('error: ' + (e && e.message ? e.message : 'failed'), 'err');
      enable(false);
      if (client) { client.end(true); client = null; }
    });
    client.on('message', function (topic, payload) {
      var msg = payload.toString();
      // The library publishes devices/<user>/status = online/offline (retained).
      if (myUser && topic === 'devices/' + myUser + '/status') {
        if (msg === 'online') setDev('🟢 device online', 'on');
        else setDev('🔴 device offline', 'err');
      }
      log(topic, msg);
    });
  });

  $('subBtn').addEventListener('click', function () {
    var topic = $('subTopic').value.trim();
    if (!client || !topic) return;
    client.subscribe(topic, function (err) {
      log(err ? 'SUBSCRIBE FAILED' : 'subscribed', topic + (err ? ' — ' + err.message : ''));
    });
  });

  $('pubBtn').addEventListener('click', function () {
    var topic = $('pubTopic').value.trim();
    if (!client || !topic) return;
    client.publish(topic, $('pubPayload').value, function (err) {
      if (err) log('PUBLISH FAILED', topic + ' — ' + err.message);
    });
  });
})();
