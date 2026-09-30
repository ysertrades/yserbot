'use strict';
(function () {
  var host = document.getElementById('overview-desk');
  if (host && !host.dataset.ready) {
    host.innerHTML = '<div style="padding:1rem;color:#9aa3b5;font-size:.9rem">Channel Desk…</div>';
  }
  var N = 4;
  var parts = new Array(N);
  var left = N;
  function fail(msg) {
    try {
      if (host) host.innerHTML = '<div style="padding:1rem;color:#f87171;font-size:.9rem">Channel Desk failed: ' + msg + '</div>';
    } catch (e) {}
    console.error('[desk-ui]', msg);
  }
  function done() {
    try {
      var code = parts.join('');
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
          parts[idx] = t;
          if (--left === 0) done();
        })
        .catch(function (e) {
          fail(e && e.message ? e.message : String(e));
        });
    })(i);
  }
})();
