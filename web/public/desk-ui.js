'use strict';
(function () {
  var N = 5;
  var parts = new Array(N);
  var left = N;
  function go() {
    if (left) return;
    try {
      var bin = atob(parts.join(''));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/javascript' }));
      var s = document.createElement('script');
      s.src = url;
      s.onerror = function () {
        var el = document.getElementById('overview-desk');
        if (el) el.innerHTML = '<p class="muted" style="padding:1rem">Channel Desk failed to start.</p>';
      };
      document.head.appendChild(s);
    } catch (e) {
      var el = document.getElementById('overview-desk');
      if (el) el.innerHTML = '<p class="muted" style="padding:1rem">Channel Desk decode error.</p>';
      console.error('[desk-ui]', e);
    }
  }
  for (var i = 0; i < N; i++) {
    (function (idx) {
      fetch('/desk-ui.p' + idx + '.txt?v=2', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('part ' + idx); return r.text(); })
        .then(function (t) { parts[idx] = t.trim(); left--; go(); })
        .catch(function (e) {
          console.error('[desk-ui] part', idx, e);
          var el = document.getElementById('overview-desk');
          if (el) el.innerHTML = '<p class="muted" style="padding:1rem">Channel Desk could not load (part ' + idx + ').</p>';
        });
    })(i);
  }
})();
