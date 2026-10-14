'use strict';
(function () {
  var SRC = 'https://raw.githubusercontent.com/ysertrades/yserbot/c063c65/web/public/desk-ui.js';
  var s = document.createElement('script');
  s.src = SRC + '?v=1';
  s.crossOrigin = 'anonymous';
  s.onerror = function () {
    var el = document.getElementById('overview-desk');
    if (el) el.innerHTML = '<p class="muted" style="padding:1rem">Channel Desk could not load.</p>';
  };
  document.head.appendChild(s);
})();
