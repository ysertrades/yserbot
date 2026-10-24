'use strict';
/**
 * Countdowns: #countdown-root in Automation. Make a live countdown card for a
 * channel, preview it (running and ended) before it posts, and pick the two
 * pings separately: one when the card is posted, one when it ends.
 * Talks to the `countdown` write op (web/writes.js → utils/countdown.js).
 */
(function () {
  var loadedFor = null, data = null, busy = false, poll = 0, armed = null, prevTimer = 0, prevEnded = false, lastPrev = '';
  var form = { title: '', channelId: '', when: '', tz: 'America/New_York', kicker: '', note: '', endTitle: '',
    pingStart: { target: 'none', roleId: '', text: '' }, pingEnd: { target: 'none', roleId: '', text: '' } };

  function st() { try { return typeof state !== 'undefined' ? state : null; } catch (e) { return null; } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function say(msg, kind) { if (typeof toast === 'function') toast(msg, kind || ''); }
  function left(l) { if (!l) return ''; var p = []; if (l.d) p.push(l.d + 'd'); if (l.d || l.h) p.push(l.h + 'h'); p.push(l.m + 'm'); return p.join(' '); }
  function tzName(z) { return ({ 'America/New_York': 'New York (ET)', 'America/Chicago': 'Chicago (CT)', 'America/Los_Angeles': 'Los Angeles (PT)', 'Europe/London': 'London', 'Europe/Berlin': 'Berlin', 'Asia/Dubai': 'Dubai', 'Asia/Tokyo': 'Tokyo', 'Australia/Sydney': 'Sydney', UTC: 'UTC' })[z] || z; }

  async function call(op, extra) {
    if (typeof post !== 'function') return null;
    var out = await post('countdown', Object.assign({ op: op }, extra || {}), { quiet: op === 'status' || op === 'preview', readOnly: op === 'status' || op === 'preview' });
    if (out && out.countdowns) data = out;
    return out;
  }

  function render() {
    var root = document.getElementById('countdown-root'); if (!root) return;
    var keepPrev = root.querySelector('.cd-prev img');
    root.innerHTML = '';
    var head = el('div', 'queue-head'); head.appendChild(el('h2', null, 'Countdowns'));
    var running = data ? data.countdowns.filter(function (c) { return c.status === 'running'; }).length : 0;
    head.appendChild(el('span', 'pill' + (running ? ' on' : ''), running ? running + ' LIVE' : 'NONE'));
    root.appendChild(head);
    root.appendChild(el('p', 'hint', 'A dark countdown card in a channel. It redraws itself every minute and turns into a "live" card the moment the time comes. The post ping and the end ping are set apart.'));
    if (!data) { root.appendChild(el('div', 'cd-sk')); return; }
    if (data.countdowns.length) { var list = el('div', 'cd-list'); data.countdowns.forEach(function (c) { list.appendChild(item(c)); }); root.appendChild(list); }
    root.appendChild(builder(keepPrev ? keepPrev.src : null));
    try { if (typeof enhanceSelects === 'function') enhanceSelects(root); } catch (e) {}
  }

  function item(c) {
    var row = el('div', 'cd-item ' + c.status + (c.error ? ' err' : ''));
    var top = el('div', 'cd-top');
    var t = el('div', 'cd-t'); t.appendChild(el('b', null, c.title));
    var ch = (data.channels || []).find(function (x) { return x.id === c.channelId; });
    var when = new Date(c.endsAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    t.appendChild(el('small', null, (ch ? '#' + ch.name : 'channel gone') + ' · ' + when));
    top.appendChild(t);
    top.appendChild(el('span', 'cd-state ' + c.status, c.status === 'running' ? left(c.left) : c.status === 'gone' ? 'DELETED' : 'ENDED'));
    row.appendChild(top);
    var pings = el('div', 'cd-pings');
    pings.appendChild(el('span', null, 'Post ping: ' + pingLabel(c.pingStart)));
    pings.appendChild(el('span', null, 'End ping: ' + pingLabel(c.pingEnd)));
    row.appendChild(pings);
    if (c.error) row.appendChild(el('div', 'cd-error', c.error));
    var acts = el('div', 'cd-acts');
    if (c.status === 'running') {
      var end = el('button', 'btn small', 'End now'); end.type = 'button';
      end.onclick = async function () { if (busy) return; busy = true; end.disabled = true; var o = await call('end', { id: c.id }); busy = false; if (o && !o.error) { say('Countdown ended. The live card is up.', 'good'); render(); } else end.disabled = false; };
      acts.appendChild(end);
    }
    var rm = el('button', 'btn small danger', armed === c.id ? 'Remove: sure?' : 'Remove'); rm.type = 'button';
    rm.onclick = async function () {
      if (armed !== c.id) { armed = c.id; render(); setTimeout(function () { if (armed === c.id) { armed = null; render(); } }, 4000); return; }
      armed = null; busy = true; var o = await call('remove', { id: c.id }); busy = false; if (o && !o.error) { say('Countdown removed and its card deleted.', 'good'); render(); }
    };
    acts.appendChild(rm);
    row.appendChild(acts);
    return row;
  }
  function pingLabel(p) {
    if (!p || p.target === 'none') return 'off';
    var who = p.target === 'everyone' ? '@everyone' : p.target === 'here' ? '@here' : '@' + ((data.roles || []).find(function (r) { return r.id === p.roleId; }) || { name: 'role' }).name;
    return who + (p.text ? ' · "' + p.text.slice(0, 40) + (p.text.length > 40 ? '…"' : '"') : '');
  }

  function field(label, node, hint) { var f = el('label', 'cd-f'); f.appendChild(el('span', 'cd-k', label)); f.appendChild(node); if (hint) f.appendChild(el('small', null, hint)); return f; }
  function input(key, ph, max) { var i = el('input', 'cd-in'); i.value = form[key] || ''; i.placeholder = ph || ''; if (max) i.maxLength = max; i.oninput = function () { form[key] = i.value; schedulePreview(); }; return i; }
  function select(opts, val, onChange, aria) { var s = el('select', 'cd-sel'); if (aria) s.setAttribute('aria-label', aria); opts.forEach(function (o) { var n = el('option', null, o[1]); n.value = o[0]; if (o[0] === val) n.selected = true; s.appendChild(n); }); s.onchange = function () { onChange(s.value); }; return s; }

  function pingBlock(key, title, sample) {
    var p = form[key], box = el('div', 'cd-ping');
    box.appendChild(el('b', null, title));
    var line = el('div', 'cd-row3');
    line.appendChild(select([['none', 'No ping'], ['everyone', '@everyone'], ['here', '@here'], ['role', 'A role']], p.target, function (v) { p.target = v; render(); }, title + ' target'));
    if (p.target === 'role') line.appendChild(select([['', 'Pick a role']].concat((data.roles || []).map(function (r) { return [r.id, '@' + r.name]; })), p.roleId, function (v) { p.roleId = v; }, title + ' role'));
    if (p.target !== 'none') { var t = el('input', 'cd-in'); t.placeholder = sample; t.maxLength = 300; t.value = p.text; t.oninput = function () { p.text = t.value; }; line.appendChild(t); }
    box.appendChild(line);
    return box;
  }

  function builder(prevSrc) {
    var box = el('div', 'cd-new');
    var grid = el('div', 'cd-grid');
    var left = el('div', 'cd-form');
    left.appendChild(field('Title', input('title', 'NY Open, live trading session', 80)));
    var r1 = el('div', 'cd-row2');
    r1.appendChild(field('Channel', select([['', 'Pick a channel']].concat((data.channels || []).map(function (c) { return [c.id, '#' + c.name]; })), form.channelId, function (v) { form.channelId = v; }, 'Channel')));
    var dt = el('input', 'cd-in'); dt.type = 'datetime-local'; dt.value = form.when; dt.oninput = function () { form.when = dt.value; schedulePreview(); };
    r1.appendChild(field('Ends at', dt));
    left.appendChild(r1);
    var r2 = el('div', 'cd-row2');
    r2.appendChild(field('Time zone', select((data.tzs || []).map(function (z) { return [z, tzName(z)]; }), form.tz, function (v) { form.tz = v; schedulePreview(); }, 'Time zone')));
    r2.appendChild(field('Small label', input('kicker', 'COUNTDOWN', 28), 'Above the title'));
    left.appendChild(r2);
    var r3 = el('div', 'cd-row2');
    r3.appendChild(field('Detail line', input('note', '#live-trading', 26), 'After the time'));
    r3.appendChild(field('Live headline', input('endTitle', "We're live.", 40), 'Shown when it ends'));
    left.appendChild(r3);
    left.appendChild(pingBlock('pingStart', 'Ping when posted', 'NY Open countdown is on.'));
    left.appendChild(pingBlock('pingEnd', 'Ping when it ends', 'We are live, come in.'));
    var go = el('button', 'btn primary', 'Post the countdown'); go.type = 'button';
    go.onclick = async function () {
      if (busy) return;
      if (!form.title.trim()) { say('Give the countdown a title.', 'bad'); return; }
      if (!form.channelId) { say('Pick a channel for the countdown.', 'bad'); return; }
      if (!form.when) { say('Pick when it ends.', 'bad'); return; }
      busy = true; go.disabled = true;
      var o = await call('create', JSON.parse(JSON.stringify(form)));
      busy = false; go.disabled = false;
      if (o && !o.error) { say('Countdown posted in #' + o.channel + '.', 'good'); form.title = ''; form.note = ''; render(); }
    };
    left.appendChild(go);
    grid.appendChild(left);

    var right = el('div', 'cd-prev');
    var tabs = el('div', 'cd-tabs');
    [['Counting down', false], ['When it ends', true]].forEach(function (x) { var b = el('button', 'cd-tab' + (prevEnded === x[1] ? ' on' : ''), x[0]); b.type = 'button'; b.onclick = function () { prevEnded = x[1]; lastPrev = ''; render(); schedulePreview(0); }; tabs.appendChild(b); });
    right.appendChild(tabs);
    var frame = el('div', 'cd-frame');
    var img = el('img'); img.alt = 'Countdown card preview'; if (prevSrc) img.src = prevSrc; frame.appendChild(img);
    right.appendChild(frame);
    right.appendChild(el('small', null, 'This is the whole message: a dark card with the image and nothing else. Pings go on their own line.'));
    grid.appendChild(right);
    box.appendChild(grid);
    if (!prevSrc) schedulePreview(0);
    return box;
  }

  function schedulePreview(delay) {
    clearTimeout(prevTimer);
    prevTimer = setTimeout(async function () {
      var key = JSON.stringify([form.title, form.when, form.tz, form.kicker, form.note, form.endTitle, prevEnded]);
      if (key === lastPrev) return; lastPrev = key;
      var o = await call('preview', { title: form.title, when: form.when, tz: form.tz, kicker: form.kicker, note: form.note, endTitle: form.endTitle, ended: prevEnded });
      var img = document.querySelector('#countdown-root .cd-frame img');
      if (o && o.image && img) img.src = o.image;
    }, delay == null ? 500 : delay);
  }

  function injectStyles() {
    if (document.getElementById('countdown-ui-css')) return;
    var s = document.createElement('style'); s.id = 'countdown-ui-css';
    s.textContent = [
      '#countdown-root .cd-list{display:flex;flex-direction:column;gap:.5rem;margin:.6rem 0 .2rem}',
      '#countdown-root .cd-item{display:flex;flex-direction:column;gap:.45rem;padding:.75rem .9rem;border-radius:12px;border:1px solid var(--rule,rgba(255,255,255,.08));background:var(--sunken,rgba(0,0,0,.25))}',
      '#countdown-root .cd-item.err{border-color:rgba(248,113,113,.45)}#countdown-root .cd-item.ended,#countdown-root .cd-item.gone{opacity:.75}',
      '#countdown-root .cd-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.6rem}',
      '#countdown-root .cd-t{display:flex;flex-direction:column;gap:.15rem;min-width:0}#countdown-root .cd-t small{opacity:.65;font-size:.76rem}',
      '#countdown-root .cd-state{flex:none;font:700 .7rem/1 ui-monospace,monospace;letter-spacing:.06em;padding:.3rem .55rem;border-radius:999px;background:rgba(79,109,255,.14);color:#8d9bff}',
      '#countdown-root .cd-state.ended{color:#3ccf7a;background:rgba(60,207,122,.12)}#countdown-root .cd-state.gone{color:#f87171;background:rgba(248,113,113,.12)}',
      '#countdown-root .cd-pings{display:flex;flex-wrap:wrap;gap:.3rem 1rem;font-size:.76rem;opacity:.7}',
      '#countdown-root .cd-error{font-size:.8rem;color:#f87171}',
      '#countdown-root .cd-acts{display:flex;gap:.45rem;flex-wrap:wrap}',
      '#countdown-root .cd-new{margin-top:.7rem;padding-top:.8rem;border-top:1px solid var(--rule,rgba(255,255,255,.08))}',
      '#countdown-root .cd-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:1rem;align-items:start}',
      '@media(max-width:900px){#countdown-root .cd-grid{grid-template-columns:1fr}}',
      '#countdown-root .cd-form{display:flex;flex-direction:column;gap:.65rem;min-width:0}',
      '#countdown-root .cd-row2{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}@media(max-width:560px){#countdown-root .cd-row2{grid-template-columns:1fr}}',
      '#countdown-root .cd-row3{display:grid;grid-template-columns:auto auto 1fr;gap:.5rem}@media(max-width:560px){#countdown-root .cd-row3{grid-template-columns:1fr}}',
      '#countdown-root .cd-f{display:flex;flex-direction:column;gap:.3rem;min-width:0}#countdown-root .cd-f small{opacity:.55;font-size:.7rem}',
      '#countdown-root .cd-k{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;opacity:.65}',
      '#countdown-root .cd-in,#countdown-root .cd-sel{width:100%;box-sizing:border-box;min-width:0}',
      '#countdown-root .cd-ping{display:flex;flex-direction:column;gap:.4rem;padding:.65rem .75rem;border-radius:10px;background:var(--sunken,rgba(0,0,0,.2));border:1px solid var(--rule,rgba(255,255,255,.07))}',
      '#countdown-root .cd-ping b{font-size:.8rem}',
      '#countdown-root .cd-prev{display:flex;flex-direction:column;gap:.5rem;min-width:0;position:sticky;top:1rem}',
      '#countdown-root .cd-tabs{display:flex;gap:.3rem}',
      '#countdown-root .cd-tab{font-size:.74rem;padding:.35rem .7rem;border-radius:999px;border:1px solid var(--rule,rgba(255,255,255,.1));background:transparent;color:inherit;cursor:pointer;opacity:.7}',
      '#countdown-root .cd-tab.on{opacity:1;background:rgba(79,109,255,.16);border-color:rgba(79,109,255,.5)}',
      '#countdown-root .cd-frame{border-radius:10px;overflow:hidden;background:#0b0c0f;border:1px solid rgba(255,255,255,.08);border-left:4px solid #0b0c0f;aspect-ratio:1200/420}',
      '#countdown-root .cd-frame img{display:block;width:100%;height:100%;object-fit:cover}',
      '#countdown-root .cd-prev small{opacity:.55;font-size:.72rem}',
      '#countdown-root .cd-sk{height:9rem;border-radius:12px;background:rgba(255,255,255,.04)}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // loads when the Automation tab opens (and again for another server), then refreshes the list while it's open
  async function maybeLoad() {
    var s = st(); if (!s || !s.guildId) return;
    var on = document.documentElement.getAttribute('data-section') === 'automation';
    if (!on) { clearInterval(poll); poll = 0; return; }
    if (loadedFor !== s.guildId) { loadedFor = s.guildId; data = null; lastPrev = ''; render(); await call('status'); render(); }
    if (!poll) poll = setInterval(async function () {
      var root = document.getElementById('countdown-root');
      if (document.hidden || busy || armed || document.documentElement.getAttribute('data-section') !== 'automation') return;
      if (root && root.contains(document.activeElement)) return;   // never redraw under someone typing
      var before = JSON.stringify((data && data.countdowns) || []);
      var o = await call('status');
      if (o && JSON.stringify(o.countdowns) !== before) render();
    }, 30000);
  }

  function init() {
    injectStyles();
    new MutationObserver(maybeLoad).observe(document.documentElement, { attributes: true, attributeFilter: ['data-section', 'data-state'] });
    setInterval(function () { var s = st(); if (s && s.guildId !== loadedFor && document.documentElement.getAttribute('data-section') === 'automation') maybeLoad(); }, 1500);
    maybeLoad();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
