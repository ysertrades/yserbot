'use strict';
/**
 * Journal feed: #journal-feed-root in Feeds. An outside trading journal posts
 * each trade it logs to a signed webhook; the bot puts it in a channel.
 * Talks to the `journalfeed` write op (web/writes.js). The secret is shown here
 * exactly once, when a feed is made or its secret rotated.
 */
(function () {
  var loadedFor = null, data = null, reveal = null, busy = false, poll = 0, armedDelete = null;

  function st() { try { return typeof state !== 'undefined' ? state : null; } catch (e) { return null; } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function say(msg, kind) { if (typeof toast === 'function') toast(msg, kind || ''); }
  function ago(t) {
    if (!t) return 'never';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function money(v) { if (v == null) return ''; var a = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (v > 0 ? '+$' : v < 0 ? '−$' : '$') + a; }
  function copy(text, what) {
    var done = function () { say((what || 'Copied') + ' to the clipboard.', 'good'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    else fallback();
    function fallback() { var t = el('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { say('Copy did not work: select it and copy by hand.', 'bad'); } t.remove(); }
  }

  async function call(op, extra) {
    if (typeof post !== 'function') return null;
    var out = await post('journalfeed', Object.assign({ op: op }, extra || {}), { quiet: true, readOnly: op === 'status' });
    if (out && out.feeds) data = out;
    return out;
  }

  function guide(f) {
    return [
      'Quant Bot · journal feed: how to send trades',
      '',
      'URL:    ' + f.url,
      'Method: POST, Content-Type: application/json',
      'Secret: sent to you privately. Keep it in your server config, never in code or a browser.',
      '',
      'Headers on every request:',
      '  X-Timestamp: <unix seconds now>',
      '  X-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" using the secret>',
      '',
      'Body:',
      '  { "event": "trade.created" | "trade.updated" | "trade.deleted" | "ping",',
      '    "id": "your stable trade id", "trader": "name", "symbol": "NQ", "side": "Long",',
      '    "pnl": 840.5, "r": 2.1, "qty": 2, "entry": 21480.25, "exit": 21501.25,',
      '    "setup": "ORB", "session": "NY AM", "notes": "...", "image": "https://...",',
      '    "url": "https://your-journal/trade/123", "at": "2026-10-22T14:31:00Z" }',
      '  Only "event" and "id" are required. Send the same id again for an edit or a delete.',
      '',
      'Node example:',
      '  const crypto = require("crypto");',
      '  const body = JSON.stringify(trade), ts = Math.floor(Date.now() / 1000).toString();',
      '  const sig = "sha256=" + crypto.createHmac("sha256", process.env.QUANTBOT_FEED_SECRET).update(ts + "." + body).digest("hex");',
      '  await fetch(URL, { method: "POST", headers: { "content-type": "application/json", "x-timestamp": ts, "x-signature": sig }, body });',
      '',
      'Answers: 200 ok (posted, updated or already posted) · 401 bad or old signature · 400 bad body · 409 paused · 429 slow down.',
      'Retry on 5xx and 429 with the same body; a retried trade never posts twice.',
    ].join('\n');
  }

  function render() {
    var root = document.getElementById('journal-feed-root'); if (!root) return;
    root.innerHTML = '';
    var head = el('div', 'queue-head'); head.appendChild(el('h2', null, 'Journal feed'));
    var live = data && data.feeds && data.feeds.some(function (f) { return f.enabled && !f.lastError; });
    head.appendChild(el('span', 'pill' + (live ? ' on' : ''), live ? 'LIVE' : (data && data.feeds && data.feeds.length ? 'PAUSED' : 'OFF')));
    root.appendChild(head);
    root.appendChild(el('p', 'hint', 'Trades logged on another journal site, posted here the moment they are saved. Edits update the card, deletes cross it out.'));
    if (!data) { root.appendChild(el('div', 'jf-sk')); return; }

    if (reveal) {   // the secret, once
      var rv = el('div', 'jf-reveal');
      rv.appendChild(el('b', null, '🔑 Copy this secret now: it is shown only once'));
      var code = el('code', 'jf-secret', reveal.secret); rv.appendChild(code);
      var acts = el('div', 'jf-acts');
      var cp = el('button', 'btn primary small', 'Copy secret'); cp.type = 'button'; cp.onclick = function () { copy(reveal.secret, 'Secret copied'); };
      var ok = el('button', 'btn small', 'I saved it'); ok.type = 'button'; ok.onclick = function () { reveal = null; render(); };
      acts.appendChild(cp); acts.appendChild(ok); rv.appendChild(acts);
      rv.appendChild(el('small', null, 'Send it to the site’s developer privately (a DM, not a channel). They keep it in their server config. If it ever leaks, rotate it.'));
      root.appendChild(rv);
    }

    (data.feeds || []).forEach(function (f) { root.appendChild(feedCard(f)); });
    if ((data.feeds || []).length < (data.max || 5)) root.appendChild(createForm(!(data.feeds || []).length));
    try { if (typeof enhanceSelects === 'function') enhanceSelects(root); } catch (e) {}
  }

  function flow() {   // journal site -> signed -> bot -> channel, the dots running along it
    var f = el('div', 'jf-flow');
    f.innerHTML = '<span class="jf-node">📒<small>Their journal</small></span><span class="jf-wire"><i></i><i></i><i></i><em>signed</em></span>'
      + '<span class="jf-node">🤖<small>Quant Bot</small></span><span class="jf-wire"><i></i><i></i><i></i><em>card</em></span><span class="jf-node">#<small>Your channel</small></span>';
    return f;
  }

  function channelSelect(selected) {
    var s = el('select', 'jf-sel'); s.setAttribute('aria-label', 'Channel for the trades');
    var o0 = el('option', null, 'Pick a channel'); o0.value = ''; s.appendChild(o0);
    (data.channels || []).forEach(function (c) { var o = el('option', null, '#' + c.name); o.value = c.id; if (c.id === selected) o.selected = true; s.appendChild(o); });
    return s;
  }

  function createForm(first) {
    var box = el('div', 'jf-new');
    if (first) box.appendChild(flow());
    var row = el('div', 'jf-row');
    var name = el('input', 'jf-in'); name.placeholder = 'Name, e.g. Ali’s journal'; name.maxLength = 40; name.setAttribute('aria-label', 'Feed name');
    var ch = channelSelect('');
    var go = el('button', 'btn primary', first ? 'Create the feed' : 'Add another feed'); go.type = 'button';
    go.onclick = async function () {
      if (busy) return; if (!ch.value) { say('Pick a channel for the trades first.', 'bad'); return; }
      busy = true; go.disabled = true;
      var out = await call('create', { name: name.value.trim() || 'Journal', channelId: ch.value });
      busy = false; go.disabled = false;
      if (out && out.secret) { reveal = { feedId: out.feedId, secret: out.secret }; say('Feed created. Copy the secret and the link for the developer.', 'good'); render(); }
    };
    row.appendChild(name); row.appendChild(ch); row.appendChild(go); box.appendChild(row);
    return box;
  }

  function feedCard(f) {
    var c = el('div', 'jf-card' + (f.enabled ? '' : ' off') + (f.lastError ? ' err' : ''));
    var top = el('div', 'jf-top');
    var title = el('div', 'jf-title');
    title.appendChild(el('b', null, f.name));
    title.appendChild(el('small', null, (f.channelName ? '#' + f.channelName : 'no channel') + ' · ' + f.count + ' trade' + (f.count === 1 ? '' : 's') + ' · last ' + ago(f.lastAt)));
    top.appendChild(title);
    top.appendChild(el('span', 'jf-state ' + (f.lastError ? 'err' : f.enabled ? 'on' : 'off'), f.lastError ? 'NEEDS ATTENTION' : f.enabled ? (f.lastAt ? 'LIVE' : 'WAITING') : 'PAUSED'));
    c.appendChild(top);
    if (f.lastError) c.appendChild(el('div', 'jf-error', f.lastError));

    var link = el('div', 'jf-line');
    link.appendChild(el('span', 'jf-k', 'Link'));
    link.appendChild(el('code', 'jf-url', f.url));
    var cu = el('button', 'btn small', 'Copy'); cu.type = 'button'; cu.onclick = function () { copy(f.url, 'Link copied'); }; link.appendChild(cu);
    c.appendChild(link);
    var sec = el('div', 'jf-line');
    sec.appendChild(el('span', 'jf-k', 'Secret')); sec.appendChild(el('code', 'jf-url', f.secretMask || '—'));
    var rot = el('button', 'btn small', 'Rotate'); rot.type = 'button';
    rot.onclick = async function () {
      if (!confirm('Rotate the secret? The journal stops being able to post until its developer puts in the new one.')) return;
      var out = await call('rotate', { feedId: f.id });
      if (out && out.secret) { reveal = { feedId: f.id, secret: out.secret }; say('New secret made. The old one no longer works.', 'good'); render(); }
    };
    sec.appendChild(rot); c.appendChild(sec);

    var acts = el('div', 'jf-acts');
    var test = el('button', 'btn small primary', 'Send test card'); test.type = 'button';
    test.onclick = async function () { test.disabled = true; var out = await call('test', { feedId: f.id }); test.disabled = false; if (out && out.tested) say('A test card is in #' + out.tested + '.', 'good'); };
    var pause = el('button', 'btn small', f.enabled ? 'Pause' : 'Resume'); pause.type = 'button';
    pause.onclick = async function () { await call('update', { feedId: f.id, enabled: !f.enabled }); render(); };
    var g = el('button', 'btn small', 'Copy setup guide'); g.type = 'button'; g.onclick = function () { copy(guide(f), 'Setup guide copied (the secret is not in it)'); };
    var del = el('button', 'btn small danger', armedDelete === f.id ? 'Tap again to delete' : 'Delete'); del.type = 'button';
    del.onclick = async function () {
      if (armedDelete !== f.id) { armedDelete = f.id; render(); setTimeout(function () { if (armedDelete === f.id) { armedDelete = null; render(); } }, 4000); return; }
      armedDelete = null; var out = await call('delete', { feedId: f.id }); if (out) say('Feed deleted. Its link stopped working.', 'good'); render();
    };
    [test, pause, g, del].forEach(function (b) { acts.appendChild(b); });
    c.appendChild(acts);

    var move = el('div', 'jf-line');
    move.appendChild(el('span', 'jf-k', 'Posts to'));
    var sel = channelSelect(f.channelId);
    sel.onchange = async function () { if (sel.value) { await call('update', { feedId: f.id, channelId: sel.value }); say('The feed now posts to #' + sel.options[sel.selectedIndex].text.replace(/^#/, '') + '.', 'good'); render(); } };
    move.appendChild(sel); c.appendChild(move);

    if (f.recent && f.recent.length) {
      var list = el('div', 'jf-recent');
      f.recent.forEach(function (r) {
        var it = el('div', 'jf-item');
        it.appendChild(el('span', 'jf-ev', r.event === 'trade.deleted' ? '🗑️' : r.event === 'trade.updated' ? '✏️' : '📈'));
        it.appendChild(el('b', null, r.symbol || r.id));
        it.appendChild(el('span', 'jf-pnl ' + (r.pnl > 0 ? 'win' : r.pnl < 0 ? 'loss' : ''), money(r.pnl)));
        it.appendChild(el('small', null, ago(r.at)));
        list.appendChild(it);
      });
      c.appendChild(list);
    }
    return c;
  }

  function injectStyles() {
    if (document.getElementById('journal-feed-css')) return;
    var s = el('style'); s.id = 'journal-feed-css';
    s.textContent = [
      '#journal-feed-root .pill.on{color:#3ccf7a}',
      '#journal-feed-root .jf-sk{height:120px;border-radius:12px;background:var(--sunken,rgba(0,0,0,.25))}',
      '#journal-feed-root .jf-flow{display:flex;align-items:center;gap:.5rem;margin:.25rem 0 .9rem;min-width:0}',
      '#journal-feed-root .jf-node{display:grid;justify-items:center;gap:.2rem;padding:.6rem .7rem;border-radius:12px;background:var(--sunken,rgba(0,0,0,.25));border:1px solid var(--rule,rgba(255,255,255,.08));font-size:1.1rem;flex:none}',
      '#journal-feed-root .jf-node small{font-size:.66rem;opacity:.7;white-space:nowrap}',
      '#journal-feed-root .jf-wire{position:relative;flex:1;height:2px;min-width:24px;background:var(--rule,rgba(255,255,255,.12));border-radius:2px}',
      '#journal-feed-root .jf-wire i{position:absolute;top:-2px;left:0;width:6px;height:6px;border-radius:50%;background:#3ccf7a;animation:jf-run 2.4s linear infinite}',
      '#journal-feed-root .jf-wire i:nth-child(2){animation-delay:.8s}#journal-feed-root .jf-wire i:nth-child(3){animation-delay:1.6s}',
      '#journal-feed-root .jf-wire em{position:absolute;top:-1.2rem;left:50%;transform:translateX(-50%);font-size:.62rem;font-style:normal;opacity:.6;letter-spacing:.06em;text-transform:uppercase}',
      '@keyframes jf-run{0%{left:0;opacity:0}10%{opacity:1}90%{opacity:1}100%{left:calc(100% - 6px);opacity:0}}',
      '#journal-feed-root .jf-row{display:grid;grid-template-columns:1fr 1fr auto;gap:.5rem}',
      '@media(max-width:640px){#journal-feed-root .jf-row{grid-template-columns:1fr}#journal-feed-root .jf-flow small{display:none}}',
      '#journal-feed-root .jf-in,#journal-feed-root .jf-sel{width:100%;box-sizing:border-box;min-width:0}',
      '#journal-feed-root .jf-new{margin-top:.6rem}',
      '#journal-feed-root .jf-card{display:flex;flex-direction:column;gap:.55rem;padding:.8rem .9rem;margin-top:.6rem;border-radius:12px;border:1px solid var(--rule,rgba(255,255,255,.08));background:var(--sunken,rgba(0,0,0,.25));min-width:0}',
      '#journal-feed-root .jf-card.err{border-color:rgba(248,113,113,.45)}#journal-feed-root .jf-card.off{opacity:.8}',
      '#journal-feed-root .jf-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem}',
      '#journal-feed-root .jf-title{display:flex;flex-direction:column;gap:.15rem;min-width:0}#journal-feed-root .jf-title small{opacity:.65;font-size:.76rem}',
      '#journal-feed-root .jf-state{flex:none;font-size:.64rem;font-weight:700;letter-spacing:.06em;padding:.22rem .5rem;border-radius:999px;background:rgba(255,255,255,.06)}',
      '#journal-feed-root .jf-state.on{color:#3ccf7a;background:rgba(60,207,122,.12)}#journal-feed-root .jf-state.err{color:#f87171;background:rgba(248,113,113,.12)}',
      '#journal-feed-root .jf-error{font-size:.8rem;color:#f87171}',
      '#journal-feed-root .jf-line{display:flex;align-items:center;gap:.5rem;min-width:0}',
      '#journal-feed-root .jf-k{flex:none;width:4.6rem;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;opacity:.6}',
      '#journal-feed-root .jf-url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem;padding:.35rem .5rem;border-radius:8px;background:rgba(0,0,0,.25)}',
      '#journal-feed-root .jf-line .jf-sel{flex:1}',
      '#journal-feed-root .jf-acts{display:flex;flex-wrap:wrap;gap:.45rem}',
      '#journal-feed-root .jf-reveal{display:flex;flex-direction:column;gap:.5rem;padding:.85rem .9rem;margin-top:.5rem;border-radius:12px;border:1.5px solid rgba(245,184,75,.55);background:rgba(245,184,75,.08);animation:jf-pop .4s ease}',
      '#journal-feed-root .jf-reveal small{opacity:.75;font-size:.76rem}',
      '#journal-feed-root .jf-secret{display:block;word-break:break-all;font-size:.82rem;padding:.5rem .6rem;border-radius:8px;background:rgba(0,0,0,.35);user-select:all}',
      '@keyframes jf-pop{from{opacity:0;transform:translateY(-6px)}}',
      '#journal-feed-root .jf-recent{display:flex;flex-direction:column;gap:.3rem;padding-top:.4rem;border-top:1px solid var(--rule,rgba(255,255,255,.08))}',
      '#journal-feed-root .jf-item{display:grid;grid-template-columns:1.4rem 1fr auto auto;gap:.5rem;align-items:center;font-size:.82rem}',
      '#journal-feed-root .jf-item small{opacity:.55;font-size:.72rem}',
      '#journal-feed-root .jf-pnl.win{color:#3ccf7a}#journal-feed-root .jf-pnl.loss{color:#f87171}',
      '@media(prefers-reduced-motion:reduce){#journal-feed-root .jf-wire i{animation:none;display:none}}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // loads when the Feeds tab opens (and again for another server), then keeps itself fresh while open
  async function maybeLoad() {
    var s = st(); if (!s || !s.guildId) return;
    var onFeeds = document.documentElement.getAttribute('data-section') === 'feeds';
    if (!onFeeds) { clearInterval(poll); poll = 0; return; }
    if (loadedFor !== s.guildId) { loadedFor = s.guildId; data = null; reveal = null; render(); await call('status'); render(); }
    if (!poll) poll = setInterval(async function () {
      var s2 = st(); if (!s2 || document.hidden || document.documentElement.getAttribute('data-section') !== 'feeds' || reveal || armedDelete || busy) return;
      var before = JSON.stringify((data && data.feeds) || []);
      var out = await call('status');
      var focused = document.activeElement && document.getElementById('journal-feed-root') && document.getElementById('journal-feed-root').contains(document.activeElement);
      if (out && JSON.stringify(out.feeds) !== before && !focused) render();
    }, 15000);
  }

  function init() {
    injectStyles();
    new MutationObserver(maybeLoad).observe(document.documentElement, { attributes: true, attributeFilter: ['data-section', 'data-state'] });
    setInterval(function () { var s = st(); if (s && s.guildId !== loadedFor && document.documentElement.getAttribute('data-section') === 'feeds') maybeLoad(); }, 1500);
    maybeLoad();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
