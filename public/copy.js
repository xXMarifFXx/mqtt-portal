/* Copy-to-clipboard for any <button data-copy="#targetId">. CSP-safe (external file). */
document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('[data-copy]');
  if (!btn) return;
  var el = document.querySelector(btn.getAttribute('data-copy'));
  if (!el) return;
  var text = el.innerText;
  navigator.clipboard.writeText(text).then(function () {
    var old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(function () { btn.textContent = old; }, 1200);
  });
});
