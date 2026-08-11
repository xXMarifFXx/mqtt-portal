/* Admin "Live devices" — polls the server for each device's online/offline status. */
(function () {
  'use strict';
  var box = document.getElementById('devices');
  if (!box) return;
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
  function render(list) {
    if (!list.length) {
      box.innerHTML = '<em class="muted">No device presence yet. When a board connects with the N-R_ESP32 library it appears here.</em>';
      return;
    }
    var html = '<table><thead><tr><th>Device (username)</th><th>Status</th><th>Since</th></tr></thead><tbody>';
    list.forEach(function (d) {
      var on = d.status === 'online';
      html += '<tr><td><code>' + esc(d.username) + '</code></td>'
        + '<td><span class="badge ' + (on ? 'on' : 'err') + '">' + (on ? '🟢 online' : '🔴 ' + esc(d.status)) + '</span></td>'
        + '<td class="muted">' + (d.at ? new Date(d.at).toLocaleString() : '—') + '</td></tr>';
    });
    box.innerHTML = html + '</tbody></table>';
  }
  function poll() {
    fetch('/admin/devices.json', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { render(j.devices || []); })
      .catch(function () {});
  }
  poll();
  setInterval(poll, 4000);
})();
