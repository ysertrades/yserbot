'use strict';
(function () {
  var POLL = 2200, STORE = 'yserflow.session';
  var desk = {
    stickBottom: true,
    channelId: null,
    channels: [],
    messages: [],
    paused: false,
    busy: false,
    timer: null,
    histAbort: null,
    histSeq: 0,
    lastSig: ''
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
  async function deskGet(path, signal) {
    var opts = { credentials: 'same-origin', headers: hdr(false) };
    if (signal) opts.signal = signal;
    var r = await fetch(path, opts);
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
  function syncCselectLabel(sel) {
    if (!sel) return;
    try {
      var wrap = sel.closest('.cselect');
      if (!wrap) return;
      var val = wrap.querySelector('.cselect-value');
      if (!val) return;
      var opt = sel.options[sel.selectedIndex];
      val.textContent = opt ? (opt.textContent || opt.value || '—') : '—';
    } catch (e) {}
  }
  function setComposer() {
    var input = $('desk-input');
    var send = $('desk-send');
    var on = !desk.paused && !desk.busy && desk.channelId;
    if (input) input.disabled = !on || desk.busy;
    if (send) send.disabled = !on || !(input && input.value.trim());
  }

  function fillSelect(sel, list, prefix) {
    if (!sel) return;
    sel.replaceChildren();
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = prefix || 'Select…';
    sel.appendChild(ph);
    var groups = {}, order = [];
    list.forEach(function (c) {
      var cat = (c.category && String(c.category).trim()) || 'Uncategorized';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(c);
    });
    order.sort(function (a, b) { return a.localeCompare(b); });
    order.forEach(function (cat) {
      var og = document.createElement('optgroup');
      og.label = cat;
      groups[cat].sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
      groups[cat].forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = (c.isForum ? '' : '# ') + c.name;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
  }

  function onPick(id, source) {
    desk.channelId = id || null;
    desk.stickBottom = true;
    desk.lastSig = '';
    var chSel = $('desk-channel-sel');
    var foSel = $('desk-forum-sel');
    if (source === 'channel' && foSel) {
      foSel.value = '';
      syncCselectLabel(foSel);
    }
    if (source === 'forum' && chSel) {
      chSel.value = '';
      syncCselectLabel(chSel);
    }
    if (source === 'channel' && chSel) syncCselectLabel(chSel);
    if (source === 'forum' && foSel) syncCselectLabel(foSel);
    if (desk.channelId) {
      setFeed('Loading messages…');
      hist(false);
    } else {
      setFeed('Select a channel or forum post to open the desk.');
    }
    setComposer();
  }

  function wireScroll() {
    var f = $('desk-stream');
    if (!f || f.dataset.scrollWired) return;
    f.dataset.scrollWired = '1';
    f.addEventListener('scroll', function () {
      var dist = f.scrollHeight - f.scrollTop - f.clientHeight;
      desk.stickBottom = dist < 48;
    }, { passive: true });
  }

  function shell() {
    var host = $('overview-desk');
    if (!host || host.dataset.deskReady) return;
    host.dataset.deskReady = '1';
    host.replaceChildren();

    var head = el('div', 'desk-head');
    var title = el('div', 'desk-title-block');
    title.append(el('p', 'desk-kicker', 'CHANNEL DESK'));
    title.append(el('p', 'muted', 'Read and post as the bot. Forum posts are listed under each forum name.'));
    head.append(title);

    var controls = el('div', 'desk-controls');

    var chSel = document.createElement('select');
    chSel.id = 'desk-channel-sel';
    chSel.className = 'desk-channel-sel lvl-input';
    chSel.setAttribute('aria-label', 'Text channels');
    var chPh = document.createElement('option');
    chPh.value = '';
    chPh.textContent = 'Text channels…';
    chSel.appendChild(chPh);
    chSel.addEventListener('change', function () {
      onPick(chSel.value || null, 'channel');
    });
    controls.append(chSel);

    var foSel = document.createElement('select');
    foSel.id = 'desk-forum-sel';
    foSel.className = 'desk-forum-sel lvl-input';
    foSel.setAttribute('aria-label', 'Forum posts');
    var foPh = document.createElement('option');
    foPh.value = '';
    foPh.textContent = 'Forum posts…';
    foSel.appendChild(foPh);
    foSel.addEventListener('change', function () {
      onPick(foSel.value || null, 'forum');
    });
    controls.append(foSel);

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
    wireScroll();
    try {
      if (typeof window.enhanceSelects === 'function') {
        window.enhanceSelects(host);
      }
    } catch (e) {}
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
      var textCh = desk.channels.filter(function (c) { return !c.isForum; });
      var forums = desk.channels.filter(function (c) { return !!c.isForum; });
      fillSelect($('desk-channel-sel'), textCh, 'Text channels…');
      fillSelect($('desk-forum-sel'), forums, 'Forum posts…');
      try {
        if (typeof window.enhanceSelects === 'function') {
          window.enhanceSelects($('overview-desk') || document);
        }
      } catch (e) {}
      syncCselectLabel($('desk-channel-sel'));
      syncCselectLabel($('desk-forum-sel'));
      if (!desk.channelId) {
        setFeed((textCh.length || forums.length)
          ? 'Select a channel or forum post to open the desk.'
          : 'No channels available.');
      }
      setPill('idle', textCh.length + ' ch · ' + forums.length + ' posts');
    } catch (e) {
      setFeed('Network error loading channels.');
    }
  }

  async function hist(quiet) {
    if (!desk.channelId) return;
    var g = gid();
    if (!g) return;

    if (desk.histAbort) {
      try { desk.histAbort.abort(); } catch (e) {}
    }
    var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    desk.histAbort = ac;
    var seq = ++desk.histSeq;

    try {
      var path = '/api/guild/' + encodeURIComponent(g) + '/desk/' + encodeURIComponent(desk.channelId) + '?limit=40';
      var out = await deskGet(path, ac ? ac.signal : null);
      if (seq !== desk.histSeq) return;
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
      var sig = msgs.length + ':' + (msgs.length ? (msgs[msgs.length - 1].id || '') : '');
      if (quiet && sig === desk.lastSig) return;
      desk.lastSig = sig;
      desk.messages = msgs;
      renderMsgs(msgs);
      setPill('live', 'Live');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (!quiet) setFeed('Network error loading messages.');
    }
  }

  function renderMsgs(msgs) {
    var f = $('desk-stream');
    if (!f) return;
    var prevTop = f.scrollTop;
    var prevHeight = f.scrollHeight;
    var wasStick = desk.stickBottom;

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

    if (wasStick) {
      f.scrollTop = f.scrollHeight;
    } else {
      var delta = f.scrollHeight - prevHeight;
      f.scrollTop = prevTop + Math.max(0, delta);
    }
  }

  async function doSend() {
    var input = $('desk-input');
    if (!input || !desk.channelId) return;
    var text = input.value.trim();
    if (!text) return;
    desk.busy = true;
    desk.stickBottom = true;
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
      if (tries < 80) { tries++; setTimeout(retryLoad, 300); }
      else setFeed('Waiting for server… open Overview after the panel finishes loading.');
    }
    retryLoad();
    if (desk.timer) clearInterval(desk.timer);
    desk.timer = setInterval(tick, POLL);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
