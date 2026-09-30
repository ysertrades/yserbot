'use strict';
(function () {
  var POLL = 2800, STORE = 'yserflow.session';
  var desk = {
    channelId: null, messages: [], canSend: false, busy: false, paused: false,
    pollTimer: null, csrf: null, replyTo: null, replyName: '', stickBottom: true
  };

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

  function fillChannelSelect(sel, channels, opts) {
    if (!sel) return;
    opts = opts || {};
    var keep = sel.value || '';
    sel.replaceChildren();
    sel.append(new Option(opts.placeholder || 'Select channel...', ''));
    var list = Array.isArray(channels) ? channels.slice() : [];
    var groups = {};
    var order = [];
    list.forEach(function (c) {
      var cat = (c.category && String(c.category).trim()) || 'Channels';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(c);
    });
    order.forEach(function (cat) {
      var og = document.createElement('optgroup');
      og.label = cat;
      groups[cat].forEach(function (c) {
        var o = new Option('#' + c.name, c.id);
        if (c.canSend === false) o.dataset.locked = '1';
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    if (keep) {
      try { sel.value = keep; } catch (e) {}
    }
    try {
      if (typeof window.enhanceSelects === 'function') window.enhanceSelects(sel.parentNode || document);
    } catch (e) {}
  }
  window.yserFillChannelSelect = fillChannelSelect;

  function shell() {
    var host = root();
    if (!host) return null;
    if (host.dataset.ready === '1' && host.querySelector('#desk-channel')) return host;
    host.dataset.ready = '1';
    host.className = 'panel desk-panel';
    host.replaceChildren();

    var head = el('div', 'desk-head');
    var tb = el('div', 'desk-title-block');
    tb.append(el('div', 'desk-kicker', 'CHANNEL DESK'));
    tb.append(el('p', 'muted', 'Watch a channel and reply as Quantbot'));
    head.append(tb);

    var controls = el('div', 'desk-controls');
    var sel = document.createElement('select');
    sel.className = 'desk-select'; sel.id = 'desk-channel'; sel.dataset.cselect = '1';
    sel.setAttribute('aria-label', 'Channel');
    sel.innerHTML = '<option value="">Select channel...</option>';
    controls.append(sel);
    var pill = el('span', 'desk-pill paused', 'Idle'); pill.id = 'desk-pill';
    controls.append(pill);
    var pause = el('button', 'btn small desk-pause-btn', 'Pause');
    pause.type = 'button'; pause.id = 'desk-pause';
    controls.append(pause);
    head.append(controls);
    host.append(head);

    var feed = el('div', 'desk-feed'); feed.id = 'desk-feed';
    var wrap = el('div', 'desk-feed-wrap'); wrap.append(feed);
    host.append(wrap);

    var jump = el('button', 'desk-jump', '\u2193 New messages');
    jump.type = 'button'; jump.id = 'desk-jump'; jump.hidden = true;
    wrap.append(jump);

    var composer = el('div', 'desk-composer');
    var chip = el('div', 'desk-reply-chip'); chip.id = 'desk-reply-chip'; chip.hidden = true;
    composer.append(chip);
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

    var lb = el('div', 'desk-lightbox'); lb.id = 'desk-lightbox'; lb.hidden = true;
    lb.innerHTML = '<button type="button" class="desk-lb-close" aria-label="Close">\u00d7</button><img alt="">';
    host.append(lb);

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
    feed.addEventListener('scroll', function () {
      var near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
      desk.stickBottom = near;
      if (near) { jump.hidden = true; }
    });
    jump.addEventListener('click', function () {
      feed.scrollTop = feed.scrollHeight;
      desk.stickBottom = true;
      jump.hidden = true;
    });
    lb.addEventListener('click', function (ev) {
      if (ev.target === lb || ev.target.classList.contains('desk-lb-close')) {
        lb.hidden = true;
        lb.querySelector('img').removeAttribute('src');
      }
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
    paintReplyChip();
  }
  function paintReplyChip() {
    var chip = $('desk-reply-chip'); if (!chip) return;
    if (!desk.replyTo) { chip.hidden = true; chip.replaceChildren(); return; }
    chip.hidden = false;
    chip.replaceChildren();
    var left = el('div', 'desk-reply-chip-text');
    left.append(el('span', 'desk-reply-label', 'Replying to'));
    left.append(el('strong', null, desk.replyName || 'message'));
    chip.append(left);
    var x = el('button', 'desk-reply-clear', '\u00d7');
    x.type = 'button'; x.setAttribute('aria-label', 'Cancel reply');
    x.addEventListener('click', function () {
      desk.replyTo = null; desk.replyName = ''; paintReplyChip();
    });
    chip.append(x);
  }

  function openLightbox(url) {
    var lb = $('desk-lightbox'); if (!lb || !url) return;
    lb.querySelector('img').src = url;
    lb.hidden = false;
  }

  function msgSig(list) {
    return (list || []).map(function (m) {
      return m.id + ':' + (m.content || '').length + ':' + ((m.attachments && m.attachments.length) || 0);
    }).join('|');
  }

  function paint() {
    var f = $('desk-feed'); if (!f) return;
    var prevScroll = f.scrollTop, prevH = f.scrollHeight;
    f.replaceChildren();
    if (!desk.channelId) { f.append(el('p', 'desk-empty', 'Select a channel to open the desk.')); return; }
    if (!desk.messages.length) { f.append(el('p', 'desk-empty', 'No recent messages.')); return; }

    desk.messages.forEach(function (m) {
      var row = el('div', 'desk-row' + (m.author && m.author.bot ? ' is-bot' : ''));
      row.dataset.id = m.id;

      if (m.author && m.author.avatar) {
        var img = document.createElement('img');
        img.className = 'desk-avatar';
        img.src = m.author.avatar;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        row.append(img);
      } else {
        var ph = el('div', 'desk-avatar desk-avatar-ph', (m.author && m.author.name || '?').slice(0, 1));
        row.append(ph);
      }

      var body = el('div', 'desk-body');
      var meta = el('div', 'desk-meta');
      meta.append(el('span', 'desk-name', (m.author && m.author.name) || '?'));
      if (m.author && m.author.bot) meta.append(el('span', 'desk-app', 'APP'));
      if (m.referenceId) meta.append(el('span', 'desk-ref', '\u21a9 reply'));
      body.append(meta);

      if (m.content) body.append(el('div', 'desk-text', m.content));

      var media = [];
      if (Array.isArray(m.attachments)) {
        m.attachments.forEach(function (a) { if (a && a.url) media.push(a); });
      }
      if (Array.isArray(m.images)) {
        m.images.forEach(function (a) { if (a && a.url) media.push(a); });
      }
      if (media.length) {
        var grid = el('div', 'desk-media');
        media.forEach(function (a) {
          var isImg = !a.contentType || /^image\//i.test(a.contentType) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.url);
          if (isImg) {
            var thumb = document.createElement('img');
            thumb.className = 'desk-thumb';
            thumb.src = a.url;
            thumb.alt = a.name || '';
            thumb.loading = 'lazy';
            thumb.referrerPolicy = 'no-referrer';
            thumb.addEventListener('click', function () { openLightbox(a.url); });
            grid.append(thumb);
          } else {
            var link = document.createElement('a');
            link.className = 'desk-file';
            link.href = a.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = a.name || 'Attachment';
            grid.append(link);
          }
        });
        body.append(grid);
      }

      var actions = el('div', 'desk-actions');
      var replyBtn = el('button', 'desk-act', 'Reply');
      replyBtn.type = 'button';
      replyBtn.addEventListener('click', function () {
        desk.replyTo = m.id;
        desk.replyName = (m.author && m.author.name) || 'message';
        paintReplyChip();
        var input = $('desk-input');
        if (input && !input.disabled) input.focus();
      });
      actions.append(replyBtn);

      var quoteBtn = el('button', 'desk-act', 'Quote');
      quoteBtn.type = 'button';
      quoteBtn.addEventListener('click', function () {
        var input = $('desk-input');
        if (!input || input.disabled) return;
        var snip = String(m.content || '').slice(0, 180);
        var q = snip ? ('> ' + snip.replace(/\n/g, '\n> ') + '\n') : '';
        input.value = (input.value ? input.value + '\n' : '') + q;
        desk.replyTo = m.id;
        desk.replyName = (m.author && m.author.name) || 'message';
        paintReplyChip();
        input.focus();
      });
      actions.append(quoteBtn);

      var copyBtn = el('button', 'desk-act', 'Copy');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(m.content || '');
        } catch (e) {}
      });
      actions.append(copyBtn);
      body.append(actions);

      row.append(body);
      f.append(row);
    });

    if (desk.stickBottom) {
      f.scrollTop = f.scrollHeight;
    } else {
      f.scrollTop = prevScroll + (f.scrollHeight - prevH);
      var jump = $('desk-jump');
      if (jump) jump.hidden = false;
    }
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
      fillChannelSelect(sel, data.channels || [], { placeholder: 'Select channel...' });
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
    desk.replyTo = null;
    desk.replyName = '';
    desk.stickBottom = true;
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
      var before = msgSig(desk.messages);
      var after = msgSig(incoming);
      if (before !== after) {
        var grew = incoming.length > desk.messages.length ||
          (incoming.length && desk.messages.length && incoming[incoming.length - 1].id !== desk.messages[desk.messages.length - 1].id);
        desk.messages = incoming.slice(-80);
        paint();
        if (grew && !desk.stickBottom) {
          var jump = $('desk-jump');
          if (jump) jump.hidden = false;
        }
      }
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
      var body = { content: text };
      if (desk.replyTo) body.replyTo = desk.replyTo;
      var res = await fetch('/api/guild/' + g + '/desk/' + desk.channelId + '/send', {
        method: 'POST', credentials: 'same-origin', headers: hdr(true),
        body: JSON.stringify(body)
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.error) {
        setFeed('Send failed: ' + (data.detail || data.error || res.status));
        return;
      }
      input.value = '';
      desk.replyTo = null; desk.replyName = ''; paintReplyChip();
      desk.stickBottom = true;
      if (data.message) {
        var exists = desk.messages.some(function (m) { return m.id === data.message.id; });
        if (!exists) desk.messages.push(data.message);
        if (desk.messages.length > 80) desk.messages = desk.messages.slice(-80);
        paint();
      } else await hist(true);
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
