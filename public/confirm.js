// Confirm dialogs without inline handlers (works under helmet's default CSP).
// Any <form data-confirm="message"> asks before submitting.
document.addEventListener('submit', function (e) {
  var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
