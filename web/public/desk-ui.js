'use strict';
(function () {
  var N = 5;
  var parts = new Array(N);
  var left = N;
  function fail(msg) {
    try {
      var host = document.getElementById('overview-desk');
      if (host) host.textContent = 'Channel Desk failed to load: ' + msg;
    } catch (e) {}
    console.error('[desk-ui]', msg);
  }
  function done() {
    try {
      var code = parts.join('');
      var s = document.createElement('script');
      s.textContent = code;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      fail(e && e.message ? e.message : String(e));
    }
  }
  for (var i = 0; i < N; i++) {
    (function (idx) {
      fetch('/desk-ui.p' + idx + '.txt?_=' + Date.now(), { cache: 'no-store' })
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
