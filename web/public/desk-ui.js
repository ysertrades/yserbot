'use strict';
(function () {
  var POLL = 2800, STORE = 'yserflow.session';
  var desk = {
    stickBottom: true,
    channelId: null, channels: [], messages: [], paused: false, busy: false,
    replyTo: null, forwardMsg: null, deleteMsg: null, padMode: null, timer: null, lastSig: ''
  };
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function gid() {
    try { if (window.state && window.state.guildId) return String(window.state.guildId); } catch (e) {}
    try {
      var g = new URLSearchParams(location.search).get('g');
      if (g && /^\d{5,25}$/.test(g)) return g;
    } catch (e) {}
    return null;
  }
  function tok() {
    try { if (window.state && window.state.token) return window.state.token; } catch (e) {}
    try { return localStorage.getItem(STORE); } catch (e) {}
    return null;
  }
  function hdr(json) {
    var h = { Accept: 'application/json' };
    if (json) h['Content-Type'] = 'application/json';
    var t = tok(); if (t) h.Authorization = 'Bearer ' + t;
    try {
      var c = (window.state && window.state.csrf) || window.__csrf || '';
      if (c) h['X-CSRF-Token'] = c;
    } catch (e) {}
    return h;
  }
  async function ensureCsrf() {
    try {
      if (window.__csrf) return window.__csrf;
      if (window.state && window.state.csrf) { window.__csrf = window.state.csrf; return window.__csrf; }
      var r = await fetch('/api/csrf', { credentials: 'same-origin', headers: hdr(false) });
      var j = await r.json().catch(function () { return {}; });
      if (j && j.csrf) window.__csrf = j.csrf;
      return window.__csrf || '';
    } catch (e) { return window.__csrf || ''; }
  }
  async function deskGet(path) {
    var r = await fetch(path, { credentials: 'same-origin', headers: hdr(false) });
    var data = await r.json().catch(function () { return {}; });
    return { res: r, data: data };
  }
  async function deskPost(channelId, body) {
    await ensureCsrf();
    var g = gid();
    var r = await fetch('/api/guild/' + encodeURIComponent(g) + '/desk/' + encodeURIComponent(channelId) + '/send', {
      method: 'POST', credentials: 'same-origin', headers: hdr(true), body: JSON.stringify(body || {})
    });
    var data = await r.json().catch(function () { return {}; });
    return { res: r, data: data };
  }
  function setPill(kind, text) {
    var p = $('desk-pill');
    if (!p) return;
    p.className = 'desk-pill ' + (kind || '');
    p.textContent = text || '';
  }
  function setFeed(text) {
    var f = $('desk-stream');
    if (!f) return;
    f.replaceChildren();
    f.append(el('div', 'desk-empty', text || ''));
  }
  function setComposer() {
    var input = $('desk-input');
    var send = $('desk-send');
    var on = !desk.paused && !desk.busy && desk.channelId;
    if (input) input.disabled = !on || desk.busy;
    if (send) { send.disabled = !on || !(input && input.value.trim()); }
  }
  function shell() {
    var host = $('overview-desk');
    if (!host || host.dataset.deskReady) return;
    host.dataset.deskReady = '1';
    host.replaceChildren();
    var head = el('div', 'desk-head');
    var title = el('div', 'desk-title-block');
    title.append(el('p', 'desk-kicker', 'CHANNEL DESK'));
    title.append(el('p', 'muted', 'Read and post as the bot in any text channel.'));
    head.append(title);
    var controls = el('div', 'desk-controls');
    var sel = document.createElement('select');
    sel.id = 'desk-channel-sel';
    sel.className = 'desk-channel-sel lvl-input';
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = 'Select channel…';
    sel.appendChild(ph);
    sel.addEventListener('change', function () {
      desk.channelId = sel.value || null;
      if (desk.channelId) hist(false);
      else setFeed('Select a channel to open the desk.');
      setComposer();
    });
    controls.append(sel);
    var pill = el('span', 'desk-pill', '');
    pill.id = 'desk-pill';
    controls.append(pill);
    head.append(controls);
    host.append(head);
    var stream = el('div', 'desk-stream');
    stream.id = 'desk-stream';
    host.append(stream);
    var composer = el('div', 'desk-composer');
    var input = document.createElement('textarea');
    input.id = 'desk-input';
    input.className = 'desk-input';
    input.rows = 2;
    input.placeholder = 'Message as the bot…';
    input.addEventListener('input', setComposer);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); doSend(); }
    });
    composer.append(input);
    var row = el('div', 'desk-composer-row');
    var send = el('button', 'btn primary small desk-send', 'Send');
    send.type = 'button';
    send.id = 'desk-send';
    send.disabled = true;
    send.addEventListener('click', doSend);
    row.append(send);
    composer.append(row);
    host.append(composer);
    setFeed('Loading channels…');
    setComposer();
  }
  async function loadCh() {
    var g = gid();
    if (!g) { setFeed('Waiting for server…'); return; }
    try {
      var out = await deskGet('/api/guild/' + encodeURIComponent(g) + '/desk/channels');
      if (!out.res.ok) {
        setFeed(out.res.status === 401 ? 'Sign in again to load channels.' : 'Could not load channels.');
        return;
      }
      desk.channels = out.data.channels || [];
      var sel = $('desk-channel-sel');
      if (sel) {
        sel.replaceChildren();
        var _ph = el('option', '', 'Select channel…'); _ph.value = ''; sel.append(_ph);
        var groups = {}, order = [];
        desk.channels.forEach(function (c) {
          var cat = c.isForum ? 'Forums' : ((c.category && String(c.category).trim()) || 'Text channels');
          if (!groups[cat]) { groups[cat] = []; order.push(cat); }
          groups[cat].push(c);
        });
        order.sort(function (a, b) {
          if (a === 'Forums') return 1;
          if (b === 'Forums') return -1;
          return a.localeCompare(b);
        });
        order.forEach(function (cat) {
          var og = document.createElement('optgroup');
          og.label = cat;
          groups[cat].forEach(function (c) {
            var o = document.createElement('option');
            o.value = c.id;
            o.textContent = (c.isForum ? 'Forum: ' : '# ') + c.name;
            og.appendChild(o);
          });
          sel.appendChild(og);
        });
      }
      if (!desk.channelId) setFeed(desk.channels.length ? 'Select a channel to open the desk.' : 'No channels available.');
      setPill('idle', desk.channels.length + ' channels');
    } catch (e) {
      setFeed('Network error loading channels.');
    }
  }
  async function hist(quiet) {
    if (!desk.channelId) return;
    var g = gid();
    if (!g) return;
    try {
      var out = await deskGet('/api/guild/' + encodeURIComponent(g) + '/desk/' + encodeURIComponent(desk.channelId) + '?limit=50');
      if (!out.res.ok) {
        if (!quiet) {
          var det = (out.data && (out.data.error || out.data.detail)) || ('HTTP ' + out.res.status);
          setFeed('Could not load messages (' + det + ').');
        }
        return;
      }
      if (out.data && out.data.error) {
        if (!quiet) setFeed('Could not load messages (' + out.data.error + ').');
        return;
      }
      var msgs = (out.data.messages || out.data.history || []);
      desk.messages = msgs;
      renderMsgs(msgs);
      setPill('live', 'Live');
    } catch (e) {
      if (!quiet) setFeed('Network error loading messages.');
    }
  }
  function renderMsgs(msgs) {
    var f = $('desk-stream');
    if (!f) return;
    f.replaceChildren();
    if (!msgs.length) {
      f.append(el('div', 'desk-empty', 'No messages yet.'));
      return;
    }
    msgs.forEach(function (m) {
      var row = el('div', 'desk-row');
      var av = el('div', 'desk-avatar desk-avatar-ph', ((m.author && m.author.name) || '?').slice(0, 1).toUpperCase());
      if (m.author && m.author.avatar) {
        var img = document.createElement('img');
        img.className = 'desk-avatar';
        img.src = m.author.avatar;
        img.alt = '';
        av = img;
      }
      row.append(av);
      var body = el('div', 'desk-body');
      var meta = el('div', 'desk-meta');
      meta.append(el('span', 'desk-author', (m.author && m.author.name) || 'Unknown'));
      body.append(meta);
      body.append(el('div', 'desk-text', m.content || ''));
      row.append(body);
      f.append(row);
    });
    if (desk.stickBottom) f.scrollTop = f.scrollHeight;
  }
  async function doSend() {
    var input = $('desk-input');
    if (!input || !desk.channelId) return;
    var text = input.value.trim();
    if (!text) return;
    desk.busy = true;
    setComposer();
    try {
      var out = await deskPost(desk.channelId, { content: text });
      if (out.res.ok) {
        input.value = '';
        await hist(true);
      } else {
        setPill('err', 'Send failed');
      }
    } catch (e) {
      setPill('err', 'Send error');
    }
    desk.busy = false;
    setComposer();
  }
  function tick() {
    if (desk.paused || !desk.channelId) return;
    if (document.hidden || document.visibilityState === 'hidden') return;
    hist(true);
  }
  function boot() {
    if (!$('overview-desk')) return;
    shell();
    var tries = 0;
    function retryLoad() {
      if (gid()) { loadCh(); return; }
      if (tries < 80) { tries++; setTimeout(retryLoad, 400); }
      else setFeed('Waiting for server… open Overview after the panel finishes loading.');
    }
    retryLoad();
    if (desk.timer) clearInterval(desk.timer);
    desk.timer = setInterval(tick, POLL);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
