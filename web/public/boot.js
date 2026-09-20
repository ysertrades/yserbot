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
  var done = false;
  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (res) {
      done = true;
      if (!stillLoading()) return;
      if (res.status === 401) {
        document.documentElement.setAttribute('data-state', 'login');
        return;
      }
      if (res.status >= 500) {
        showStuck('Panel error', 'Bot returned ' + res.status + '. Check host console.');
      }
    })
    .catch(function () { done = true; });
  setTimeout(function () {
    if (stillLoading() && !done) showStuck('Still loading…', 'Waiting for the panel script.');
  }, 5000);
  setTimeout(function () {
    if (stillLoading()) {
      document.documentElement.setAttribute('data-state', 'login');
    }
  }, 8000);
})();
