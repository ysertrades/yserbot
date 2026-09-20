(function () {
  'use strict';
  function stillLoading() {
    return document.documentElement.getAttribute('data-state') === 'loading';
  }
  function showStuck(msg, detail) {
    if (!stillLoading()) return;
    var m = document.getElementById('boot-msg');
    var h = document.getElementById('boot-hint');
    var b = document.getElementById('boot-retry');
    if (m) m.textContent = msg;
    if (h) { h.hidden = false; h.textContent = detail; }
    if (b) { b.hidden = false; b.onclick = function () { location.reload(); }; }
  }
  setTimeout(function () {
    if (stillLoading()) showStuck('Still loading…', 'Waiting for the bot API. Host may be restarting.');
  }, 4000);
  setTimeout(function () {
    if (stillLoading()) showStuck('Bot not responding', 'Confirm Ready! and [Panel] listening on the host, then Try again. Open the panel URL directly if Whop caches an old page.');
  }, 10000);
})();
