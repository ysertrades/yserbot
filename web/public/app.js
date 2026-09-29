'use strict';
(function () {
  function fail(msg) {
    try {
      var el = document.getElementById('root') || document.body;
      if (el) el.textContent = 'Panel restore failed: ' + msg;
    } catch (e) {}
    console.error('[panel-restore]', msg);
  }
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var t = setTimeout(function () {
    try { if (ctrl) ctrl.abort(); } catch (e) {}
    fail('timeout loading panel — restart the bot after the latest deploy');
  }, 20000);
  fetch('/panel-app.js?_=' + Date.now(), {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: ctrl ? ctrl.signal : undefined,
  })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(function (code) {
      clearTimeout(t);
      if (!code || code.length < 100000) throw new Error('script too small (' + (code && code.length) + ')');
      var s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
    })
    .catch(function (e) {
      clearTimeout(t);
      fail(e && e.message ? e.message : String(e));
    });
})();
