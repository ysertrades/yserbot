/**
 * Soft watchdog only. Never force login — embed auth uses Bearer (?t= / storage).
 * An anonymous /api/me probe 401s even when the user is signed in.
 */
(function () {
  'use strict';
  function stillLoading() {
    return document.documentElement.getAttribute('data-state') === 'loading';
  }
  setTimeout(function () {
    if (!stillLoading()) return;
    var m = document.getElementById('boot-msg');
    var h = document.getElementById('boot-hint');
    var b = document.getElementById('boot-retry');
    if (m) m.textContent = 'Still loading…';
    if (h) {
      h.hidden = false;
      h.textContent = 'Taking longer than usual. If this stays, reload once.';
    }
    if (b) {
      b.hidden = false;
      b.onclick = function () { location.reload(); };
    }
  }, 15000);
})();
