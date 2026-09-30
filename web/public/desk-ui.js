'use strict';
(function () {
  var POLL = 2800, STORE = 'yserflow.session';
  var desk = {
    channelId: null, messages: [], canSend: false, canManage: false,
    busy: false, paused: false, pollTimer: null, csrf: null,
    replyTo: null, replyName: '', stickBottom: true, channels: [],
    forwardMsg: null
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

  function formatWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var nowEst = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    var msgEst = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    var time = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    var st = new Date(nowEst); st.setHours(0, 0, 0, 0);
    var sm = new Date(msgEst); sm.setHours(0, 0, 0, 0);
    var diff = Math.round((st - sm) / 86400000);
    if (diff === 0) return 'Today · ' + time + ' EST';
    if (diff === 1) return 'Yesterday · ' + time + ' EST';
    if (diff > 1 && diff < 7) {
      return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' }) + ' · ' + time + ' EST';
    }
    var date = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: d.getFullYear() !== nowEst.getFullYear() ? 'numeric' : undefined });
    return date + ' · ' + time + ' EST';
  }

  function wireDeskSelect(scope) {
    try {
      if (typeof enhanceSelects === 'function') enhanceSelects(scope || document);
    } catch (e) {}
  }

  function fillChannelSelect(sel, channels, opts) {
    if (!sel) return;
    opts = opts || {};
    var keep = sel.value || '';
    try {
      var wrap = sel.closest && sel.closest('.cselect');
      if (wrap && wrap.parentNode) {
        wrap.parentNode.insertBefore(sel, wrap);
        wrap.remove();
      }
      sel.classList.remove('cselect-native');
      sel.removeAttribute('aria-hidden');
      sel.style.cssText = '';
    } catch (e) {}

    sel.replaceChildren();
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = opts.placeholder || 'Select channel…';
    sel.appendChild(ph);

    var list = Array.isArray(channels) ? channels.slice() : [];
    var groups = {}, order = [];
    list.forEach(function (c) {
      var cat = (c.category && String(c.category).trim()) || 'Channels';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(c);
    });
    order.forEach(function (cat) {
      var sep = document.createElement('option');
      sep.value = '';
      sep.disabled = true;
      sep.textContent = cat;
      sel.appendChild(sep);
      groups[cat].forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = '#' + c.name;
        sel.appendChild(o);
      });
    });
    if (keep) { try { sel.value = keep; } catch (e) {} }
    var scope = sel.parentNode || document;
    requestAnimationFrame(function () { wireDeskSelect(scope); });
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
    var selWrap = el('div', 'desk-select-wrap');
    var sel = document.createElement('select');
    sel.className = 'lvl-input desk-channel-sel';
    sel.id = 'desk-channel';
    sel.setAttribute('aria-label', 'Channel');
    sel.innerHTML = '<option value="">Select channel…</option>';
    selWrap.append(sel);
    controls.append(selWrap);
    var pill = el('span', 'desk-pill paused', 'Idle'); pill.id = 'desk-pill';
    controls.append(pill);
    var pause = el('button', 'btn small', 'Pause');
    pause.type = 'button'; pause.id = 'desk-pause';
    controls.append(pause);
    head.append(controls); host.append(head);

    var mod = el('div', 'desk-mod'); mod.id = 'desk-mod';
    mod.innerHTML = '<button type="button" class="desk-mod-btn" data-mod="lock">Lock</button>' +
      '<button type="button" class="desk-mod-btn" data-mod="unlock">Unlock</button>' +
      '<span class="desk-mod-sep"></span>' +
      '<button type="button" class="desk-mod-btn" data-mod="purge10">Purge 10</button>' +
      '<button type="button" class="desk-mod-btn" data-mod="purge25">Purge 25</button>' +
      '<button type="button" class="desk-mod-btn" data-mod="purge50">Purge 50</button>' +
      '<button type="button" class="desk-mod-btn" data-mod="purge-user">Purge user…</button>';
    host.append(mod);
    mod.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-mod]');
      if (btn) runMod(btn.getAttribute('data-mod'));
    });

    var feed = el('div', 'desk-feed'); feed.id = 'desk-feed';
    var wrap = el('div', 'desk-feed-wrap'); wrap.append(feed); host.append(wrap);
    var jump = el('button', 'desk-jump', 'New messages');
    jump.type = 'button'; jump.id = 'desk-jump'; jump.hidden = true; wrap.append(jump);

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
    row.append(send); composer.append(row); host.append(composer);

    var pad = el('div', 'desk-pad'); pad.id = 'desk-pad'; pad.hidden = true;
    pad.innerHTML = '<div class="desk-pad-card">' +
      '<div class="desk-pad-head"><span>Forward message</span><button type="button" class="desk-pad-x" id="desk-pad-x">×</button></div>' +
      '<p class="desk-pad-preview muted" id="desk-pad-preview"></p>' +
      '<label class="desk-pad-note-label" for="desk-pad-note">Add a note (optional — appears with the forward)</label>' +
      '<textarea id="desk-pad-note" class="desk-pad-note" rows="2" placeholder="@everyone check this out…"></textarea>' +
      '<div class="desk-pad-list" id="desk-pad-list"></div>' +
      '<div class="desk-pad-foot"><button type="button" class="btn small" id="desk-pad-cancel">Cancel</button><button type="button" class="btn primary small" id="desk-pad-go" disabled>Forward here</button></div>' +
      '</div>';
    host.append(pad);

    var lb = el('div', 'desk-lightbox'); lb.id = 'desk-lightbox'; lb.hidden = true;
    lb.innerHTML = '<button type="button" class="desk-lb-close" aria-label="Close">×</button><img alt="">';
    host.append(lb);

    var padTarget = null;
    function closePad() {
      desk.forwardMsg = null; padTarget = null; pad.hidden = true;
      var go = $('desk-pad-go'); if (go) go.disabled = true;
      var note = $('desk-pad-note'); if (note) note.value = '';
    }
    function openPad(m) {
      desk.forwardMsg = m; padTarget = null;
      var prev = $('desk-pad-preview');
      if (prev) prev.textContent = ((m.author && m.author.name) || '?') + ': ' + String(m.content || '(attachment)').slice(0, 160);
      var note = $('desk-pad-note'); if (note) note.value = '';
      var list = $('desk-pad-list');
      if (list) {
        list.replaceChildren();
        var groups = {}, order = [];
        (desk.channels || []).forEach(function (c) {
          if (c.canSend === false) return;
          var cat = (c.category && String(c.category).trim()) || 'Channels';
          if (!groups[cat]) { groups[cat] = []; order.push(cat); }
          groups[cat].push(c);
        });
        order.forEach(function (cat) {
          list.append(el('div', 'desk-pad-cat', cat));
          groups[cat].forEach(function (c) {
            var b = el('button', 'desk-pad-ch', '#' + c.name);
            b.type = 'button'; b.dataset.id = c.id;
            if (c.id === desk.channelId) b.classList.add('is-current');
            b.addEventListener('click', function () {
              list.querySelectorAll('.desk-pad-ch').forEach(function (x) { x.classList.remove('is-on'); });
              b.classList.add('is-on'); padTarget = c.id;
              var go = $('desk-pad-go'); if (go) go.disabled = !padTarget;
            });
            list.append(b);
          });
        });
      }
      pad.hidden = false;
    }
    $('desk-pad-x').addEventListener('click', closePad);
    $('desk-pad-cancel').addEventListener('click', closePad);
    $('desk-pad-go').addEventListener('click', function () {
      if (!padTarget || !desk.forwardMsg) return;
      doForward(padTarget, desk.forwardMsg).then(closePad);
    });
    pad.addEventListener('click', function (ev) { if (ev.target === pad) closePad(); });

    function pick() { openCh(sel.value || null); }
    sel.addEventListener('change', pick);
    pause.addEventListener('click', function () {
      desk.paused = !desk.paused;
      pause.textContent = desk.paused ? 'Resume' : 'Pause';
      setPill(); if (!desk.paused) hist(true);
    });
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); doSend(); }
    });
    feed.addEventListener('scroll', function () {
      var near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48;
      desk.stickBottom = near; if (near) jump.hidden = true;
    });
    jump.addEventListener('click', function () {
      feed.scrollTop = feed.scrollHeight; desk.stickBottom = true; jump.hidden = true;
    });
    lb.addEventListener('click', function (ev) {
      if (ev.target === lb || ev.target.classList.contains('desk-lb-close')) {
        lb.hidden = true; lb.querySelector('img').removeAttribute('src');
      }
    });
    window.__deskOpenPad = openPad;
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
      input.placeholder = !has ? 'Select a channel first...' : (!desk.canSend ? 'Quantbot cannot send in this channel...' : 'Message as Quantbot...');
    }
    if (send) send.disabled = !(has && desk.canSend && !desk.busy);
    paintReplyChip();
    var mod = $('desk-mod'); if (mod) mod.classList.toggle('is-on', !!desk.channelId);
  }
  function paintReplyChip() {
    var chip = $('desk-reply-chip'); if (!chip) return;
    if (!desk.replyTo) { chip.hidden = true; chip.replaceChildren(); return; }
    chip.hidden = false; chip.replaceChildren();
    var left = el('div', 'desk-reply-chip-text');
    left.append(el('span', 'desk-reply-label', 'Replying to'));
    left.append(el('strong', null, desk.replyName || 'message'));
    chip.append(left);
    var x = el('button', 'desk-reply-clear', '×'); x.type = 'button';
    x.addEventListener('click', function () { desk.replyTo = null; desk.replyName = ''; paintReplyChip(); });
    chip.append(x);
  }
  function openLightbox(url) {
    var lb = $('desk-lightbox'); if (!lb || !url) return;
    lb.querySelector('img').src = url; lb.hidden = false;
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
      var isBot = !!(m.author && m.author.bot);
      var row = el('div', 'desk-row' + (isBot ? ' is-bot' : ''));
      row.dataset.id = m.id;

      if (m.author && m.author.avatar) {
        var img = document.createElement('img');
        img.className = 'desk-avatar'; img.src = m.author.avatar; img.alt = '';
        img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; row.append(img);
      } else {
        row.append(el('div', 'desk-avatar desk-avatar-ph', (m.author && m.author.name || '?').slice(0, 1)));
      }

      var body = el('div', 'desk-body');
      var meta = el('div', 'desk-meta');
      meta.append(el('span', 'desk-name', (m.author && m.author.name) || '?'));
      if (isBot) meta.append(el('span', 'desk-app', 'APP'));
      if (m.referenceId) meta.append(el('span', 'desk-ref', 'reply'));
      meta.append(el('span', 'desk-when', formatWhen(m.createdAt)));
      body.append(meta);
      if (m.content) body.append(el('div', 'desk-text', m.content));

      var media = [];
      if (Array.isArray(m.attachments)) m.attachments.forEach(function (a) { if (a && a.url) media.push(a); });
      if (Array.isArray(m.images)) m.images.forEach(function (a) { if (a && a.url) media.push(a); });
      if (media.length) {
        var grid = el('div', 'desk-media');
        media.forEach(function (a) {
          var isImg = !a.contentType || /^image\//i.test(a.contentType) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.url || '');
          if (isImg) {
            var thumb = document.createElement('img');
            thumb.className = 'desk-thumb'; thumb.src = a.url; thumb.alt = a.name || '';
            thumb.loading = 'lazy'; thumb.referrerPolicy = 'no-referrer';
            thumb.addEventListener('click', function () { openLightbox(a.url); });
            grid.append(thumb);
          } else {
            var link = document.createElement('a');
            link.className = 'desk-file'; link.href = a.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
            link.textContent = a.name || 'Attachment'; grid.append(link);
          }
        });
        body.append(grid);
      }

      var actions = el('div', 'desk-actions');
      var replyBtn = el('button', 'desk-act', 'Reply'); replyBtn.type = 'button';
      replyBtn.addEventListener('click', function () {
        desk.replyTo = m.id; desk.replyName = (m.author && m.author.name) || 'message';
        paintReplyChip(); var input = $('desk-input'); if (input && !input.disabled) input.focus();
      });
      actions.append(replyBtn);
      var quoteBtn = el('button', 'desk-act', 'Quote'); quoteBtn.type = 'button';
      quoteBtn.addEventListener('click', function () {
        var input = $('desk-input'); if (!input || input.disabled) return;
        var snip = String(m.content || '').slice(0, 180);
        input.value = (input.value ? input.value + '\n' : '') + (snip ? ('> ' + snip.replace(/\n/g, '\n> ') + '\n') : '');
        desk.replyTo = m.id; desk.replyName = (m.author && m.author.name) || 'message';
        paintReplyChip(); input.focus();
      });
      actions.append(quoteBtn);
      var fwdBtn = el('button', 'desk-act', 'Forward'); fwdBtn.type = 'button';
      fwdBtn.addEventListener('click', function () { if (window.__deskOpenPad) window.__deskOpenPad(m); });
      actions.append(fwdBtn);
      body.append(actions);
      row.append(body);

      if (isBot || desk.canManage) {
        var side = el('div', 'desk-side');
        var del = el('button', 'desk-del', 'Delete'); del.type = 'button'; del.title = 'Delete message';
        del.addEventListener('click', function () { doDelete(m.id); });
        side.append(del); row.append(side);
      }
      f.append(row);
    });

    if (desk.stickBottom) f.scrollTop = f.scrollHeight;
    else {
      f.scrollTop = prevScroll + (f.scrollHeight - prevH);
      var jump = $('desk-jump'); if (jump) jump.hidden = false;
    }
  }

  async function ensureCsrf() {
    if (desk.csrf) return;
    try {
      if (window.state && window.state.csrf) { desk.csrf = window.state.csrf; return; }
      var me = await fetch('/api/me', { credentials: 'same-origin', headers: hdr(false) });
      var md = await me.json().catch(function () { return {}; });
      if (md.csrf) desk.csrf = md.csrf;
    } catch (e) {}
  }

  async function deskPost(channelId, body) {
    var g = gid(); await ensureCsrf();
    var res = await fetch('/api/guild/' + g + '/desk/' + channelId + '/send', {
      method: 'POST', credentials: 'same-origin', headers: hdr(true), body: JSON.stringify(body)
    });
    var data = await res.json().catch(function () { return {}; });
    return { res: res, data: data };
  }

  async function doDelete(messageId) {
    if (!desk.channelId || !messageId) return;
    desk.busy = true; setComposer();
    try {
      var out = await deskPost(desk.channelId, { action: 'delete', messageId: messageId });
      if (!out.res.ok || out.data.error) { setPill('err', 'Error'); return; }
      desk.messages = desk.messages.filter(function (m) { return m.id !== messageId; });
      paint();
    } catch (e) { setPill('err', 'Error'); }
    finally { desk.busy = false; setComposer(); }
  }

  async function doForward(targetId, m) {
    if (!targetId || !m || !m.id) return;
    desk.busy = true; setComposer();
    try {
      var noteEl = $('desk-pad-note');
      var note = noteEl ? String(noteEl.value || '').trim().slice(0, 2000) : '';
      var out = await deskPost(targetId, {
        action: 'forward',
        messageId: m.id,
        sourceChannelId: desk.channelId,
        content: note
      });
      if (!out.res.ok || out.data.error) setPill('err', 'Forward failed');
      else setPill('live', 'Forwarded');
    } catch (e) { setPill('err', 'Error'); }
    finally {
      desk.busy = false; setComposer();
      if (desk.channelId && !desk.paused) setTimeout(function () { hist(true); }, 400);
    }
  }

  async function runMod(kind) {
    if (!desk.channelId) return;
    var g = gid(); desk.busy = true; setComposer();
    try {
      await ensureCsrf();
      if (kind === 'lock' || kind === 'unlock') {
        var body = { op: kind, channelId: String(desk.channelId) };
        if (kind === 'lock') body.mode = 'all';
        var res = await fetch('/api/guild/' + g + '/channellock', {
          method: 'POST', credentials: 'same-origin', headers: hdr(true), body: JSON.stringify(body)
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok || data.error) setPill('err', kind === 'lock' ? 'Lock failed' : 'Unlock failed');
        else setPill('live', kind === 'lock' ? 'Locked' : 'Unlocked');
        return;
      }
      var amount = 10;
      if (kind === 'purge25') amount = 25;
      if (kind === 'purge50') amount = 50;
      var payload = { action: 'purge', amount: amount };
      if (kind === 'purge-user') {
        var uid = window.prompt('Discord user ID to purge messages from:');
        if (!uid || !/^\d{5,25}$/.test(uid.trim())) { setPill('err', 'Bad user id'); return; }
        payload.action = 'purgeUser'; payload.userId = uid.trim(); payload.amount = 50;
      }
      var out = await deskPost(desk.channelId, payload);
      if (!out.res.ok || out.data.error) setPill('err', 'Purge failed');
      else { setPill('live', 'Purged ' + (out.data.deleted || 0)); await hist(false); }
    } catch (e) { setPill('err', 'Error'); }
    finally { desk.busy = false; setComposer(); }
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
      desk.channels = data.channels || [];
      fillChannelSelect(sel, desk.channels, { placeholder: 'Select channel…' });
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
    desk.messages = []; desk.canSend = false; desk.canManage = false; desk.busy = false;
    desk.replyTo = null; desk.replyName = ''; desk.stickBottom = true;
    stopPoll();
    if (!id) { paint(); setComposer(); setPill('paused', 'Idle'); return; }
    setPill('live', 'Loading'); setFeed('Loading messages...'); setComposer();
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
          desk.canSend = false; setComposer();
          setFeed(data.error === 'no_access' ? 'Quantbot cannot read this channel.' : 'Could not load messages.');
        }
        return;
      }
      desk.canSend = !!data.canSend;
      desk.canManage = !!data.canManage;
      setComposer();
      var incoming = data.messages || [];
      if (!delta) {
        desk.messages = incoming.slice(-80); paint();
        setPill(desk.paused ? 'paused' : 'live', desk.paused ? 'Paused' : 'Live');
        return;
      }
      if (msgSig(desk.messages) !== msgSig(incoming)) {
        var grew = incoming.length > desk.messages.length ||
          (incoming.length && desk.messages.length && incoming[incoming.length - 1].id !== desk.messages[desk.messages.length - 1].id);
        desk.messages = incoming.slice(-80); paint();
        if (grew && !desk.stickBottom) { var jump = $('desk-jump'); if (jump) jump.hidden = false; }
      }
      setPill(desk.paused ? 'paused' : 'live');
    } catch (e) { setPill('err', 'Error'); }
    finally { desk.busy = false; setComposer(); }
  }

  async function doSend() {
    var input = $('desk-input'), g = gid();
    if (!input || !g || !desk.channelId || !desk.canSend) return;
    var text = String(input.value || '').trim();
    if (!text) return;
    desk.busy = true; setComposer();
    try {
      var body = { content: text };
      if (desk.replyTo) body.replyTo = desk.replyTo;
      var out = await deskPost(desk.channelId, body);
      if (!out.res.ok || out.data.error) {
        setFeed('Send failed: ' + (out.data.detail || out.data.error || out.res.status));
        return;
      }
      input.value = '';
      desk.replyTo = null; desk.replyName = ''; paintReplyChip();
      desk.stickBottom = true;
      if (out.data.message) {
        var exists = desk.messages.some(function (m) { return m.id === out.data.message.id; });
        if (!exists) desk.messages.push(out.data.message);
        if (desk.messages.length > 80) desk.messages = desk.messages.slice(-80);
        paint();
      } else await hist(true);
    } catch (e) { setFeed('Send failed.'); }
    finally { desk.busy = false; setComposer(); }
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
