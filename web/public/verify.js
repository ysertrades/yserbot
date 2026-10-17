'use strict';
/*
 * The entry check page.
 *
 * The link the bot handed out carries a signed one-time code (?t=…) saying
 * which member and which giveaway this is for — no sign-in. Pressing and
 * holding the shield reads three things from this browser and sends them:
 *
 *   device      — a random id this browser keeps (localStorage + cookie)
 *   fingerprint — a SHA-256 of screen, timezone, languages, graphics and a
 *                 canvas drawing; never the raw values
 *   connection  — the server sees the address the request came from
 *
 * The server decides (utils/entryVerify.js) and the page shows the result,
 * with Return to Discord pointing straight back at the giveaway.
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var token = new URLSearchParams(location.search).get('t') || '';
  var body = document.body;
  var shield = $('shield');
  var info = null;

  function setState(s) { body.dataset.state = s; }
  function setText(id, text) { var n = $(id); if (n) n.textContent = text; }

  /* ── device id: the same browser coming back on another account ────────── */
  function deviceId() {
    var KEY = 'qlv.dev';
    var id = null;
    try { id = localStorage.getItem(KEY); } catch (e) {}
    if (!id) {
      var m = document.cookie.match(/(?:^|; )qlv_dev=([A-Za-z0-9_-]{16,64})/);
      if (m) id = m[1];
    }
    if (!id) {
      var a = new Uint8Array(16);
      crypto.getRandomValues(a);
      id = Array.from(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    try { localStorage.setItem(KEY, id); } catch (e) {}
    try { document.cookie = 'qlv_dev=' + id + '; max-age=31536000; path=/; SameSite=Lax; Secure'; } catch (e) {}
    return id;
  }

  /* ── fingerprint: hashed, never sent raw ───────────────────────────────── */
  function canvasMark() {
    try {
      var c = document.createElement('canvas');
      c.width = 220; c.height = 40;
      var x = c.getContext('2d');
      x.textBaseline = 'top';
      x.font = '16px Arial';
      x.fillStyle = '#f60'; x.fillRect(110, 1, 60, 20);
      x.fillStyle = '#069'; x.fillText('one person, one entry ✨', 2, 15);
      x.fillStyle = 'rgba(102,204,0,.7)'; x.fillText('one person, one entry ✨', 4, 17);
      return c.toDataURL();
    } catch (e) { return 'nocanvas'; }
  }
  function glMark() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return 'nogl';
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      return [gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR), gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)].join('|');
    } catch (e) { return 'nogl'; }
  }
  async function sha256(text) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function fingerprint() {
    var n = navigator, s = screen;
    var parts = [
      n.userAgent, (n.languages || [n.language]).join(','), n.platform, n.hardwareConcurrency, n.deviceMemory,
      s.width + 'x' + s.height + 'x' + s.colorDepth, window.devicePixelRatio,
      Intl.DateTimeFormat().resolvedOptions().timeZone, new Date().getTimezoneOffset(),
      'ontouchstart' in window, n.maxTouchPoints, glMark(), canvasMark(),
    ];
    return sha256(parts.join('§'));
  }

  /* ── particles + confetti on one canvas ─────────────────────────────────── */
  var fx = $('fx'), ctx = fx.getContext('2d'), dots = [], bits = [], raf = 0;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size() { fx.width = innerWidth * devicePixelRatio; fx.height = innerHeight * devicePixelRatio; }
  size();
  addEventListener('resize', size);
  for (var i = 0; i < 46; i++) dots.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + .4, v: Math.random() * .00025 + .00008, a: Math.random() * .5 + .15 });
  function frame() {
    var w = fx.width, h = fx.height, d = devicePixelRatio;
    ctx.clearRect(0, 0, w, h);
    for (var k = 0; k < dots.length; k++) {
      var p = dots[k];
      p.y -= p.v; if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
      ctx.globalAlpha = p.a; ctx.fillStyle = '#9aa7ff';
      ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.r * d, 0, 6.283); ctx.fill();
    }
    for (var j = bits.length - 1; j >= 0; j--) {
      var b = bits[j];
      b.vy += .18 * d; b.x += b.vx; b.y += b.vy; b.rot += b.vr; b.life -= 1;
      if (b.life <= 0) { bits.splice(j, 1); continue; }
      ctx.save(); ctx.globalAlpha = Math.min(1, b.life / 40); ctx.translate(b.x, b.y); ctx.rotate(b.rot);
      ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); ctx.restore();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  if (!reduce) raf = requestAnimationFrame(frame);
  function confetti() {
    if (reduce) return;
    var r = shield.getBoundingClientRect(), d = devicePixelRatio;
    var cx = (r.left + r.width / 2) * d, cy = (r.top + r.height / 2) * d;
    var colors = ['#22c55e', '#8b9cff', '#f5c451', '#ec4899', '#06b6d4', '#ffffff'];
    for (var n = 0; n < 140; n++) {
      var ang = Math.random() * Math.PI * 2, sp = (Math.random() * 9 + 4) * d;
      bits.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 6 * d, rot: Math.random() * 6, vr: (Math.random() - .5) * .4, s: (Math.random() * 8 + 5) * d, c: colors[n % colors.length], life: 90 + Math.random() * 50 });
    }
  }

  /* ── steps ──────────────────────────────────────────────────────────────── */
  function step(n, cls) { var li = document.querySelector('.steps li[data-step="' + n + '"]'); if (li) li.className = cls; }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function showResult(kind, data) {
    setState(kind);
    var res = $('result');
    var ret = $('return');
    if (data && data.returnUrl) ret.href = data.returnUrl;
    res.hidden = false;
    $('hold-hint').textContent = kind === 'verified' ? 'Verified' : kind === 'flagged' ? 'On hold' : '';
    if (kind === 'verified') {
      setText('title', 'You’re verified ✨');
      setText('sub', 'One person, one entry — and that’s you.');
      setText('next', '');
      $('next').innerHTML = 'Now tap <b>Finish verification</b> on the giveaway to lock in your entry.';
      [1, 2, 3].forEach(function (n) { step(n, 'ok'); });
      confetti();
      if (navigator.vibrate) try { navigator.vibrate([18, 40, 18]); } catch (e) {}
    } else if (kind === 'flagged') {
      setText('title', 'Entry on hold');
      setText('sub', 'This device already verified another account in this server.');
      $('next').textContent = 'If that’s a mistake (a shared computer, say), a moderator can approve you in one tap.';
      step(1, 'ok'); step(2, 'ok'); step(3, 'bad');
    } else {
      $('next').textContent = '';
    }
  }

  function fail(title, sub, returnUrl) {
    setState('error');
    setText('title', title);
    setText('sub', sub);
    $('hold-hint').textContent = '';
    if (returnUrl) { $('return').href = returnUrl; $('result').hidden = false; $('next').textContent = 'Press Enter on the giveaway again for a fresh link.'; }
  }

  /* ── the check ──────────────────────────────────────────────────────────── */
  async function runCheck() {
    setState('checking');
    $('hold-hint').textContent = 'Checking…';
    shield.disabled = true;
    step(1, 'run');
    var dev = deviceId();
    var fpP = fingerprint();
    await wait(650);
    step(1, 'ok'); step(2, 'run');
    var fp = await fpP;
    await wait(650);
    step(2, 'ok'); step(3, 'run');
    var started = Date.now();
    var out = null, status = 0;
    try {
      var r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: token, device: dev, fingerprint: fp }) });
      status = r.status;
      out = await r.json().catch(function () { return {}; });
    } catch (e) { out = null; }
    // Let the last step be seen, even on a fast connection.
    var left = 700 - (Date.now() - started);
    if (left > 0) await wait(left);
    if (!out) return fail('No connection', 'Check your internet and try again.', null), resetHold();
    if (status === 409 && out.status) return showResult(out.status === 'verified' ? 'verified' : 'flagged', out);
    if (status === 410 || out.error === 'expired') return fail('This link has expired', 'Links last 15 minutes and work once.', out.returnUrl);
    if (out.error) return fail('That link doesn’t work', 'Open a fresh one from the giveaway in Discord.', out.returnUrl);
    showResult(out.status === 'verified' ? 'verified' : 'flagged', out);
  }

  /* ── press and hold ─────────────────────────────────────────────────────── */
  var HOLD_MS = 1300, holdStart = 0, holdRaf = 0, done = false;
  function setP(p) { shield.style.setProperty('--p', String(p)); }
  function tickHold() {
    var p = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
    setP(p);
    if (p >= 1) { done = true; shield.classList.remove('holding'); runCheck(); return; }
    holdRaf = requestAnimationFrame(tickHold);
  }
  function startHold(e) {
    if (shield.disabled || done) return;
    if (e) e.preventDefault();
    shield.classList.add('holding');
    $('hold-hint').textContent = 'Keep holding…';
    holdStart = performance.now();
    if (navigator.vibrate) try { navigator.vibrate(10); } catch (err) {}
    cancelAnimationFrame(holdRaf);
    holdRaf = requestAnimationFrame(tickHold);
  }
  function resetHold() {
    done = false;
    shield.disabled = false;
    setState('ready');
    $('hold-hint').textContent = 'Press & hold';
    setP(0);
  }
  function stopHold() {
    if (done) return;
    cancelAnimationFrame(holdRaf);
    shield.classList.remove('holding');
    // The ring drains back instead of snapping to empty.
    var from = parseFloat(getComputedStyle(shield).getPropertyValue('--p')) || 0, t0 = performance.now();
    (function drain() {
      var p = Math.max(0, from - (performance.now() - t0) / 350 * from);
      setP(p);
      if (p > 0 && !done) requestAnimationFrame(drain);
    })();
    if (!done) $('hold-hint').textContent = 'Press & hold';
  }
  shield.addEventListener('pointerdown', startHold);
  shield.addEventListener('pointerup', stopHold);
  shield.addEventListener('pointerleave', stopHold);
  shield.addEventListener('pointercancel', stopHold);
  shield.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  shield.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) startHold(e); });
  shield.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') stopHold(); });

  /* ── load: who this is for ──────────────────────────────────────────────── */
  async function load() {
    if (!token) return fail('Missing link', 'Open this page from the Verify me button on a giveaway.', null);
    try {
      var r = await fetch('/api/verify/info?t=' + encodeURIComponent(token));
      info = await r.json();
      if (!r.ok) {
        if (info && info.error === 'bad_link') return fail('That link doesn’t work', 'Open a fresh one from the giveaway in Discord.', null);
        return fail('Something went wrong', 'Try the link again in a moment.', null);
      }
    } catch (e) { return fail('No connection', 'Check your internet and reload.', null); }

    setText('brand-name', info.brand || 'QuantLab');
    if (info.logo) $('brand-logo').src = info.logo;
    if (info.accent) document.documentElement.style.setProperty('--accent', info.accent);
    if (info.serverIcon) { var si = $('server-icon'); si.src = info.serverIcon; si.hidden = false; $('server-ph').hidden = true; }
    else setText('server-ph', String(info.server || '?').charAt(0).toUpperCase());
    if (info.prize) { setText('prize-name', info.prize); $('prize').hidden = false; }
    setText('sub', (info.user ? 'Hi ' + info.user + ' — h' : 'H') + 'old the shield for a second to verify in ' + (info.server || 'this server') + '.');
    document.title = 'Verify · ' + (info.server || 'Giveaway');
    if (info.expired) return fail('This link has expired', 'Links last 15 minutes and work once.', info.returnUrl);
    if (info.status === 'verified') return showResult('verified', info);
    if (info.status === 'flagged') return showResult('flagged', info);
    resetHold();
  }
  load();
})();
