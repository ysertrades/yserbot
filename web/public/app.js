'use strict';
/*
 * Runs straight after /panel-app.js (see index.html) and only checks that it
 * arrived. It used to inject that script itself, which let every script after
 * it in the page run before the panel existed.
 */
(function () {
  if (window.state) return;
  try {
    var el = document.querySelector('[data-view="loading"] .muted');
    if (el) el.textContent = 'Panel failed to load. Restart the bot on the host.';
  } catch (e) {}
})();
