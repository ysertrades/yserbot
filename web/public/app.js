'use strict';
(function () {
  var loading = document.querySelector('[data-view="loading"] .muted');
  function setMsg(msg) {
    try {
      if (loading) loading.textContent = msg;
      else if (document.body) document.body.textContent = msg;
    } catch (e) {}
    console.error('[panel-restore]', msg);
  }

  // If you still see the old "Loading…" text after restart, the host has NOT
  // deployed this file yet.
  setMsg('Connecting to panel…');

  var done = false;
  var t = setTimeout(function () {
    if (done) return;
    setMsg('Stuck loading — restart the bot on bot-hosting (must pull latest main).');
  }, 20000);

  var s = document.createElement('script');
  s.src = '/panel-app.js?_=' + Date.now();
  s.async = false;
  s.onload = function () {
    done = true;
    clearTimeout(t);
  };
  s.onerror = function () {
    if (done) return;
    clearTimeout(t);
    setMsg('Panel script failed to load (/panel-app.js). Restart bot after latest deploy.');
  };
  (document.head || document.documentElement).appendChild(s);
})();
