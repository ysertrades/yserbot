'use strict';
/* Load full panel from same-origin /panel-app.js (server proxies last good build). */
(function () {
  function fail(msg) {
    try {
      var el = document.getElementById('root') || document.body;
      if (el) el.textContent = 'Panel restore failed: ' + msg;
    } catch (e) {}
    console.error('[panel-restore]', msg);
  }
  fetch('/panel-app.js?_=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (code) {
      if (!code || code.length < 100000) throw new Error('script too small (' + (code && code.length) + ')');
      var s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
    })
    .catch(function (e) {
      fail(e && e.message ? e.message : String(e));
    });
})();
