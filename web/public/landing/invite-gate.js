'use strict';
/*
 * Early access: "Add to Discord" is for the bot's admins only.
 *
 * A click asks the server whether this browser is signed in as an admin
 * (/api/public/invite-access). Admins go straight on to Discord; everyone else
 * gets a dark card for five seconds: the padlock snaps shut, the button that
 * was pressed gives a small "no" shake, and a bar drains until the card goes.
 * The server checks again on /invite, so the card is the explanation, not the lock:
 * opening /invite directly lands back here with ?invite=closed and the same card.
 */
(function () {
  var SHOW_MS = 5000;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var card = null, timer = 0, left = SHOW_MS, started = 0;

  function build() {
    var el = document.createElement('div');
    el.className = 'gate';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML =
      '<div class="gate-card">' +
        '<span class="gate-mark"><img src="/logo-64.jpg" alt="" width="44" height="44">' +
          '<svg class="gate-lock" viewBox="0 0 24 24" aria-hidden="true"><path class="shackle" d="M8 11V8a4 4 0 0 1 8 0v3"/><rect x="5" y="11" width="14" height="10" rx="3"/><path class="hole" d="M12 15v2"/></svg>' +
        '</span>' +
        '<div class="gate-copy">' +
          '<b>Admins only. <em>for now.</em></b>' +
          '<p>Quant Bot is in early access, so only admins can add it to a server. Got an invite? Sign in with Discord.</p>' +
          '<div class="gate-actions"><a class="gate-btn" href="/"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 12.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 6.5a15 15 0 0 0-3.7-1.2l-.5 1a13 13 0 0 0-5.6 0l-.5-1A15 15 0 0 0 5 6.5C2.7 10 2 13.4 2.3 16.7A15 15 0 0 0 6.8 19l1-1.4a9 9 0 0 1-1.5-.8l.4-.3a10.6 10.6 0 0 0 10.6 0l.4.3-1.5.8 1 1.4a15 15 0 0 0 4.5-2.3c.4-3.8-.6-7.2-2.7-10.2z"/></svg>Sign in with Discord</a>' +
          '<button class="gate-x" type="button" aria-label="Close">Got it</button></div>' +
        '</div>' +
        '<i class="gate-time"><i></i></i>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('.gate-x').addEventListener('click', hide);
    // Hovering or focusing the card holds the timer, so nobody loses the button mid-reach.
    el.addEventListener('pointerenter', pause);
    el.addEventListener('pointerleave', resume);
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', resume);
    return el;
  }

  function tick() {
    clearTimeout(timer);
    started = Date.now();
    timer = setTimeout(hide, left);
  }
  function pause() {
    if (!card || !card.classList.contains('on')) return;
    clearTimeout(timer);
    left = Math.max(400, left - (Date.now() - started));
    card.classList.add('held');
  }
  function resume() {
    if (!card || !card.classList.contains('on')) return;
    card.classList.remove('held');
    tick();
  }

  function show(from) {
    if (!card) card = build();
    card.classList.remove('on', 'held');
    void card.offsetWidth;   // restart the animations if it is already showing
    left = SHOW_MS;
    card.style.setProperty('--ms', SHOW_MS + 'ms');
    card.classList.add('on');
    tick();
    if (from && !reduce) {
      from.classList.remove('gate-no'); void from.offsetWidth; from.classList.add('gate-no');
    }
    if (navigator.vibrate) try { navigator.vibrate([12, 60, 12]); } catch (e) {}
  }
  function hide() {
    clearTimeout(timer);
    if (card) card.classList.remove('on', 'held');
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="/invite"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    fetch('/api/public/invite-access', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { allowed: false }; })
      .catch(function () { return { allowed: false }; })
      .then(function (out) { if (out && out.allowed) location.href = '/invite'; else show(a); });
  });

  // Bounced back from /invite by the server.
  if (/[?&]invite=closed\b/.test(location.search)) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    setTimeout(function () { show(null); }, 900);   // after the intro splash lifts
  }
})();
