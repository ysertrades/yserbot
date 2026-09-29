'use strict';
(function () {
  function fail(msg) {
    try {
      var loading = document.querySelector('[data-view="loading"] .muted');
      if (loading) loading.textContent = 'Panel restore failed: ' + msg;
      else {
        var el = document.body;
        if (el) el.textContent = 'Panel restore failed: ' + msg;
      }
    } catch (e) {}
    console.error('[panel-restore]', msg);
  }
  var done = false;
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var t = setTimeout(function () {
    if (done) return;
    try { if (ctrl) ctrl.abort(); } catch (e) {}
    fail('timeout — restart the bot on bot-hosting after the latest deploy');
  }, 25000);
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
      if (!code || code.length < 100000) throw new Error('script too small (' + (code && code.length) + ')');
      if (code.indexOf('panel restore failed') !== -1) throw new Error('server could not build panel script');
      try {
        var s = document.createElement('script');
        s.textContent = code;
        (document.head || document.documentElement).appendChild(s);
        done = true;
        clearTimeout(t);
      } catch (e) {
        throw new Error('script parse error: ' + (e && e.message ? e.message : e));
      }
    })
    .catch(function (e) {
      if (done) return;
      clearTimeout(t);
      fail(e && e.message ? e.message : String(e));
    });
})();
