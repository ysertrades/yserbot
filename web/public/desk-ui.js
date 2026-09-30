'use strict';
(async function () {
  function fail(msg) {
    try {
      var host = document.getElementById('overview-desk');
      if (host) host.textContent = 'Channel Desk failed to load: ' + msg;
    } catch (e) {}
    console.error('[desk-ui]', msg);
  }
  try {
    var N = 3;
    var chunks = [];
    for (var i = 0; i < N; i++) {
      var r = await fetch('/desk-ui.b' + i + '.txt?_=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('part ' + i + ' HTTP ' + r.status);
      chunks.push(await r.text());
    }
    var b64 = chunks.join('');
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    var ds = new DecompressionStream('gzip');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var code = await new Response(stream).text();
    var s = document.createElement('script');
    s.textContent = code;
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
