'use strict';
(function () {
  var POLL = 2500, STORE = 'yserflow.session';
  var desk = { channelId: null, messages: [], canSend: false, busy: false, paused: false, pollTimer: null, csrf: null };

  function $(id) { return document.getElementById(id); }
  function el(t, c, x) { var n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; }
  function gid() {
    try { if (window.state && window.state.guildId) return window.state.guildId; } catch (e) {}
    try { var g = new URLSearchParams(location.search).get('g'); if (g && /^\d{5,25}$/.test(g)) return g; } catch (e) {}
    return null;
  }
  function tok() {
    try { if (window.state && window.state.token) return window.state.token; } catch (e) {}
    try { return localStorage.getItem(STORE); } catch (e) {}
    return null;
  }
  function hdr(json) {
    var h = {};
    if (json) h['content-type'] = 'application/json';
    var t = tok(); if (t) h['authorization'] = 'Bearer ' + t;
    var c = desk.csrf;
    try { if (!c && window.state && window.state.csrf) c = window.state.csrf; } catch (e) {}
    if (c) h['x-csrf-token'] = c;
    return h;
  }
  function root() { return $('overview-desk'); }
  function overviewOn() {
    return !!document.querySelector('.section[data-section="overview"][data-active]')
      || document.documentElement.getAttribute('data-section') === 'overview';
  }

  function shell() {
    var host = root();
    if (!host) return null;
    if (host.dataset.ready === '1' && host.querySelector('#desk-channel')) return host;
    host.dataset.ready = '1';
    host.className = 'panel desk-panel';
    host.replaceChildren();

    var head = el('div', 'desk-head');
    var tb = el('div', 'desk-title-block');
    tb.append(el('h2', null, 'Channel Desk'));
    tb.append(el('p', 'muted', 'Watch a channel and reply as Quantbot'));
    head.append(tb);

    var controls = el('div', 'desk-controls');
    var sel = document.createElement('select');
    sel.className = 'desk-select'; sel.id = 'desk-channel'; sel.dataset.cselect = '1';
    sel.innerHTML = '<option value="">Select channel...</option>';
    controls.append(sel);
    var pill = el('span', 'desk-pill paused', 'Idle'); pill.id = 'desk-pill';
    controls.append(pill);
    var pause = el('button', 'btn small', 'Pause'); pause.type = 'button'; pause.id = 'desk-pause';
    controls.append(pause);
    head.append(controls);
    host.append(head);

    var feed = el('div', 'desk-feed'); feed.id = 'desk-feed';
    var wrap = el('div', 'desk-feed-wrap'); wrap.append(feed);
    host.append(wrap);

    var composer = el('div', 'desk-composer');
    var row = el('div', 'desk-input-row');
    var input = document.createElement('textarea');
    input.className = 'desk-input'; input.id = 'desk-input'; input.rows = 2;
    input.placeholder = 'Select a channel first...'; input.disabled = true;
    row.append(input);
    var send = el('button', 'btn primary small desk-send', 'Send');
    send.type = 'button'; send.id = 'desk-send'; send.disabled = true;
    row.append(send);
    composer.append(row);
    host.append(composer);

    function pick() { openCh(sel.value || null); }
    sel.addEventListener('change', pick);
    sel.addEventListener('input', pick);
    pause.addEventListener('click', function () {
      desk.paused = !desk.paused;
      pause.textContent = desk.paused ? 'Resume' : 'Pause';
      setPill();
      if (!desk.paused) hist(true);
    });
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); doSend(); }
    });
    return host;
  }

  function setPill(k, l) {
    var p = $('desk-pill'); if (!p) return;
    p.className = 'desk-pill ' + (k || (desk.paused ? 'paused' : desk.channelId ? 'live' : 'paused'));
    p.textContent = l || (desk.paused ? 'Paused' : desk.channelId ? 'Live' : 'Idle');
  }
  function setFeed(msg) {
    var f = $('desk-feed'); if (!f) return;
    f.replaceChildren(); f.append(el('p', 'desk-empty', msg));
  }
  function setComposer() {
    var input = $('desk-input'), send = $('desk-send');
    var has = !!desk.channelId;
    if (input) {
      input.disabled = !has || desk.busy;
      input.readOnly = has && !desk.canSend && !desk.busy;
      input.placeholder = !has ? 'Select a channel first...'
        : (!desk.canSend ? 'Quantbot cannot send in this channel...' : 'Message as Quantbot...');
    }
    if (send) send.disabled = !(has && desk.canSend && !desk.busy);
  }
  function paint() {
    var f = $('desk-feed'); if (!f) return;
    f.replaceChildren();
    if (!desk.channelId) { f.append(el('p', 'desk-empty', 'Select a channel to open the desk.')); return; }
    if (!desk.messages.length) { f.append(el('p', 'desk-empty', 'No recent messages.')); return; }
    desk.messages.forEach(function (m) {
      var row = el('div', 'desk-row' + (m.author && m.author.bot ? ' is-bot' : ''));
      var body = el('div', 'desk-body');
      var meta = el('div', 'desk-meta');
      meta.append(el('span', 'desk-name', (m.author && m.author.name) || '?'));
      if (m.author && m.author.bot) meta.append(el('span', 'desk-app', 'APP'));
      body.append(meta);
      if (m.content) body.append(el('div', 'desk-text', m.content));
      row.append(body);
      f.append(row);
    });
    f.scrollTop = f.scrollHeight;
  }

  async function loadCh() {
    var g = gid(), sel = $('desk-channel');
    if (!g || !sel) { if (!g) setFeed('Waiting for server...'); return; }
    if (sel.dataset.loaded === g && sel.options.length > 1) return;
    setPill('live', 'Loading');
    try {
      var res = await fetch('/api/guild/' + g + '/desk/channels', { credentials: 'same-origin', headers: hdr(false) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setPill('err', 'Error');
        setFeed(res.status === 401 ? 'Sign in again to load channels.' : 'Could not load channels.');
        return;
      }
      sel.replaceChildren();
      sel.append(new Option('Select channel...', ''));
      (data.channels || []).forEach(function (c) {
        sel.append(new Option('#' + c.name, c.id));
      });
      sel.dataset.loaded = g;
      setPill('paused', 'Idle');
      if (!desk.channelId) setFeed('Select a channel to open the desk.');
    } catch (e) {
      setPill('err', 'Error');
      setFeed('Network error loading channels.');
    }
  }

  async function openCh(id) {
    desk.channelId = id || null;
    desk.messages = [];
    desk.canSend = false;
    desk.busy = false;
    stopPoll();
    if (!id) { paint(); setComposer(); setPill('paused', 'Idle'); return; }
    setPill('live', 'Loading');
    setFeed('Loading messages...');
    setComposer();
    await hist(false);
    if (!desk.paused && desk.channelId === id) startPoll();
  }

  async function hist(delta) {
    var g = gid();
    if (!g || !desk.channelId || desk.busy) return;
    desk.busy = true;
    try {
      var url = '/api/guild/' + g + '/desk/' + desk.channelId + '?limit=50';
      if (delta && desk.messages.length) url += '&after=' + desk.messages[desk.messages.length - 1].id;
      var res = await fetch(url, { credentials: 'same-origin', headers: hdr(false) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setPill('err', data.error === 'no_access' ? 'No access' : 'Error');
        if (!delta) {
          desk.canSend = false;
          setComposer();
          setFeed(data.error === 'no_access' ? 'Quantbot cannot read this channel.' : 'Could not load messages.');
        }
        return;
      }
      desk.canSend = !!data.canSend;
      setComposer();
      var incoming = data.messages || [];
      if (!delta) {
        desk.messages = incoming.slice(-80);
        paint();
        setPill(desk.paused ? 'paused' : 'live', desk.paused ? 'Paused' : 'Live');
        return;
      }
      if (!incoming.length) { setPill(desk.paused ? 'paused' : 'live'); return; }
      var known = {};
      desk.messages.forEach(function (m) { known[m.id] = 1; });
      incoming.forEach(function (m) { if (!known[m.id]) desk.messages.push(m); });
      if (desk.messages.length > 80) desk.messages = desk.messages.slice(-80);
      paint();
      setPill(desk.paused ? 'paused' : 'live');
    } catch (e) {
      setPill('err', 'Error');
    } finally {
      desk.busy = false;
      setComposer();
    }
  }

  async function doSend() {
    var input = $('desk-input'), g = gid();
    if (!input || !g || !desk.channelId || !desk.canSend) return;
    var text = String(input.value || '').trim();
    if (!text) return;
    desk.busy = true; setComposer();
    try {
      if (!desk.csrf) {
        try {
          if (window.state && window.state.csrf) desk.csrf = window.state.csrf;
          else {
            var me = await fetch('/api/me', { credentials: 'same-origin', headers: hdr(false) });
            var md = await me.json().catch(function () { return {}; });
            if (md.csrf) desk.csrf = md.csrf;
          }
        } catch (e) {}
      }
      var res = await fetch('/api/guild/' + g + '/desk/' + desk.channelId + '/send', {
        method: 'POST', credentials: 'same-origin', headers: hdr(true),
        body: JSON.stringify({ content: text })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.error) {
        setFeed('Send failed: ' + (data.detail || data.error || res.status));
        return;
      }
      input.value = '';
      if (data.message) { desk.messages.push(data.message); paint(); }
      else await hist(true);
    } catch (e) {
      setFeed('Send failed.');
    } finally {
      desk.busy = false; setComposer();
    }
  }

  function startPoll() {
    stopPoll();
    desk.pollTimer = setInterval(function () {
      if (desk.paused || !desk.channelId || !overviewOn() || document.visibilityState === 'hidden') return;
      hist(true);
    }, POLL);
  }
  function stopPoll() {
    if (desk.pollTimer) { clearInterval(desk.pollTimer); desk.pollTimer = null; }
  }

  function mount() {
    if (!root()) return;
    shell();
    if ($('desk-feed') && !$('desk-feed').childNodes.length) paint();
    if (gid()) loadCh();
  }

  function boot() {
    var tries = 0;
    function tryM() { if (root()) mount(); }
    function retry() {
      tryM();
      if (!gid() && tries < 80) { tries++; setTimeout(retry, 400); }
    }
    var obs = new MutationObserver(function () {
      if (overviewOn()) { tryM(); if (desk.channelId && !desk.paused) startPoll(); }
      else stopPoll();
    });
    if (document.body) obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-active', 'data-section'] });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'hidden' && overviewOn() && desk.channelId && !desk.paused) startPoll();
      else if (document.visibilityState === 'hidden') stopPoll();
    });
    retry();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
