'use strict';
/* Load full panel from same-origin /panel-app.js — keep stock Loading… UI. */
(function () {
  var s = document.createElement('script');
  s.src = '/panel-app.js?_=' + Date.now();
  s.async = false;
  s.onerror = function () {
    try {
      var el = document.querySelector('[data-view="loading"] .muted');
      if (el) el.textContent = 'Panel failed to load. Restart the bot on the host.';
    } catch (e) {}
  };
  (document.head || document.documentElement).appendChild(s);
})();
