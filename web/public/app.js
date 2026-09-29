'use strict';
/* Emergency restore: panel app.js was truncated. Load last known-good build,
   then expose window.state so Channel Desk can use the Whop Bearer session. */
(function () {
  var GOOD =
    'https://raw.githubusercontent.com/ysertrades/yserbot/cf3277b2cde73a9f153a225f03a517f81b4063f5/web/public/app.js';

  function fail(msg) {
    try {
      var el = document.getElementById('root') || document.body;
      if (el) el.textContent = msg;
    } catch (e) {}
    console.error('[panel-restore]', msg);
  }

  function inject(code) {
    if (!code || code.length < 100000) {
      fail('Panel restore failed: file too small (' + (code && code.length) + ').');
      return;
    }
    // Share session with isolated modules (desk-ui, leveling live poll).
    if (code.indexOf('window.state = state') === -1) {
      code = code.replace(
        /(gawBump:\s*null,[^\n]*\n\};)/,
        '$1\nwindow.state = state;'
      );
      if (code.indexOf('window.state = state') === -1) {
        code += '\nwindow.state = state;\n';
      }
    }
    var s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
  }

  fetch(GOOD + '?_=' + Date.now(), { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then(inject)
    .catch(function (err) {
      fail('Panel restore failed: ' + (err && err.message ? err.message : err));
    });
})();
