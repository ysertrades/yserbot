'use strict';
/* Emergency panel restore — load last known-good app.js from jsDelivr (works on iPhone).
   Desk auth (window.state) will be fixed in a follow-up once the panel is stable. */
(function () {
  var CDN =
    'https://cdn.jsdelivr.net/gh/ysertrades/yserbot@cf3277b2cde73a9f153a225f03a517f81b4063f5/web/public/app.js';

  function fail(msg) {
    try {
      var el = document.getElementById('root') || document.body;
      if (el) el.textContent = msg;
    } catch (e) {}
    console.error('[panel-restore]', msg);
  }

  var s = document.createElement('script');
  s.src = CDN;
  s.async = false;
  s.onload = function () {
    // Best-effort: if the loaded script ever sets window.state, desk can use it.
    // Full window.state bridge needs the in-repo file restored on a computer later.
    try {
      if (typeof state !== 'undefined' && state && !window.state) window.state = state;
    } catch (e) {}
  };
  s.onerror = function () {
    fail('Panel restore failed: could not load panel script. Restart the bot or try again later.');
  };
  (document.head || document.documentElement).appendChild(s);
})();
