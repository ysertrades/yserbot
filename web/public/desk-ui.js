'use strict';
(function () {
  function hostEl() {
    return document.getElementById('overview-desk');
  }
  function showStatus(msg, isErr) {
    try {
      var host = hostEl();
      if (!host) return;
      host.dataset.ready = '1';
      host.className = 'panel desk-panel';
      var color = isErr ? '#f87171' : '#9aa3b5';
      host.innerHTML = '<div style="padding:1rem;color:' + color + ';font-size:.9rem">' + msg + '</div>';
    } catch (e) {}
  }
  showStatus('Channel Desk loading...');
  var N = 13;
  var parts = new Array(N);
  var left = N;
  var failed = false;
  function fail(msg) {
    if (failed) return;
    failed = true;
    showStatus('Channel Desk failed: ' + msg, true);
    console.error('[desk-ui]', msg);
  }
  function done() {
    if (failed) return;
    try {
      var b64 = parts.join('');
      var code = atob(b64);
      if (code.length < 8000) throw new Error('incomplete (' + code.length + ')');
      var s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      fail(e && e.message ? e.message : String(e));
    }
  }
  for (var i = 0; i < N; i++) {
    (function (idx) {
      fetch('/desk-p' + idx + '.txt?_=' + Date.now(), { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('part ' + idx + ' HTTP ' + r.status);
          return r.text();
        })
        .then(function (t) {
          if (failed) return;
          parts[idx] = String(t).replace(/\s+/g, '');
          if (--left === 0) done();
        })
        .catch(function (e) {
          fail(e && e.message ? e.message : String(e));
        });
    })(i);
  }
})();
