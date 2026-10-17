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
    lastSig: '',
    replyTo: null,
    replyName: '',
    forwardMsg: null
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
      // The panel's own state carries the token. There is no /api/csrf
      // route, so the fetch that used to sit here only ever 404'd.
      if (window.state && window.state.csrf) { window.__csrf = window.state.csrf; return window.__csrf; }
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

  function paintReplyChip() {
    var chip = $('desk-reply-chip');
    if (!chip) return;
    if (!desk.replyTo) {
      chip.hidden = true;
      chip.replaceChildren();
      return;
    }
    chip.hidden = false;
    chip.replaceChildren();
    var left = el('div', 'desk-reply-left');
    left.append(el('span', 'desk-reply-label', 'Replying to'));
    left.append(el('strong', null, desk.replyName || 'message'));
    chip.append(left);
    var x = el('button', 'desk-reply-clear', 'x');
    x.type = 'button';
    x.title = 'Cancel reply';
    x.addEventListener('click', function () {
      desk.replyTo = null;
      desk.replyName = '';
      paintReplyChip();
    });
    chip.append(x);
  }

  var padTarget = null;

  function closeForwardPad() {
    desk.forwardMsg = null;
    desk.forwardSourceChannelId = null;
    padTarget = null;
    var pad = $('desk-fwd-pad');
    if (pad) pad.hidden = true;
    var go = $('desk-fwd-go');
    if (go) { go.disabled = true; go.textContent = 'Forward here'; }
    var note = $('desk-fwd-note'); if (note) note.value = '';
    var list = $('desk-fwd-list');
    if (list) list.querySelectorAll('.desk-pad-ch').forEach(function (x) { x.classList.remove('is-on'); });
  }

  function openForwardPad(m) {
    desk.forwardMsg = m || null;
    desk.forwardSourceChannelId = desk.channelId || null;
    padTarget = null;
    var pad = $('desk-fwd-pad');
    if (!pad) return;

    var prev = $('desk-fwd-preview');
    if (prev) {
      prev.textContent = ((m.author && m.author.name) || '?') + ': ' + String(m.content || '(attachment)').slice(0, 160);
    }
    var note = $('desk-fwd-note');
    if (note) note.value = '';

    var list = $('desk-fwd-list');
    if (list) {
      list.replaceChildren();
      var groups = {}, order = [];
      (desk.channels || []).forEach(function (c) {
        if (!c || !c.id) return;
        if (c.canSend === false) return;
        var cat = (c.category && String(c.category).trim()) || 'Channels';
        if (!groups[cat]) { groups[cat] = []; order.push(cat); }
        groups[cat].push(c);
      });
      order.forEach(function (cat) {
        list.append(el('div', 'desk-pad-cat', cat));
        groups[cat].forEach(function (c) {
          var label = (c.isForum ? '' : '# ') + (c.name || c.id);
          var b = el('button', 'desk-pad-ch', label);
          b.type = 'button';
          b.dataset.id = c.id;
          if (String(c.id) === String(desk.channelId)) b.classList.add('is-current');
          b.addEventListener('click', function () {
            list.querySelectorAll('.desk-pad-ch').forEach(function (x) { x.classList.remove('is-on'); });
            b.classList.add('is-on');
            padTarget = c.id;
            var go = $('desk-fwd-go');
            if (go) go.disabled = !padTarget;
          });
          list.append(b);
        });
      });
      if (!list.childNodes.length) {
        list.append(el('p', 'muted', 'No channels available.'));
      }
    }
    var go = $('desk-fwd-go'); if (go) go.disabled = true;
    pad.hidden = false;
  }

  async function doForward(targetId, m) {
    if (!targetId || !m || !m.id) {
      setPill('err', 'Pick a channel');
      return;
    }
    var sourceId = desk.forwardSourceChannelId || desk.channelId;
    if (!sourceId) {
      setPill('err', 'No source channel');
      return;
    }
    desk.busy = true;
    setComposer();
    var go = $('desk-fwd-go');
    if (go) { go.disabled = true; go.textContent = 'Forwarding...'; }
    try {
      var noteEl = $('desk-fwd-note');
      var note = noteEl ? String(noteEl.value || '').trim().slice(0, 2000) : '';
      var out = await deskPost(targetId, {
        action: 'forward',
        messageId: String(m.id),
        sourceChannelId: String(sourceId),
        content: note
      });
      if (!out.res.ok || out.data.error) {
        var det = (out.data && (out.data.detail || out.data.error)) || ('HTTP ' + out.res.status);
        setPill('err', 'Forward failed: ' + String(det).slice(0, 80));
        if (go) { go.disabled = !padTarget; go.textContent = 'Forward here'; }
      } else {
        setPill('live', 'Forwarded');
        closeForwardPad();
      }
    } catch (e) {
      setPill('err', 'Forward error');
      if (go) { go.disabled = !padTarget; go.textContent = 'Forward here'; }
    }
    desk.busy = false;
    setComposer();
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
      val.textContent = opt ? (opt.textContent || opt.value || '-') : '-';
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
    ph.textContent = prefix || 'Select...';
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
    desk.replyTo = null;
    desk.replyName = '';
    paintReplyChip();
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
      setFeed('Loading messages...');
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
    if (!host) return;

    // Hydrate existing static shell if present (avoids first-paint flash / layout jump)
    var existing = host.querySelector('.desk-head') && $('desk-channel-sel') && $('desk-stream');
    if (host.dataset.deskReady === '1' && existing) {
      wireShellHandlers(host);
      return;
    }
    if (host.dataset.deskReady === '1') return;
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
    chPh.textContent = 'Text channels...';
    chSel.appendChild(chPh);
    controls.append(chSel);

    var foSel = document.createElement('select');
    foSel.id = 'desk-forum-sel';
    foSel.className = 'desk-forum-sel lvl-input';
    foSel.setAttribute('aria-label', 'Forum posts');
    var foPh = document.createElement('option');
    foPh.value = '';
    foPh.textContent = 'Forum posts...';
    foSel.appendChild(foPh);
    controls.append(foSel);

    var pill = el('span', 'desk-pill desk-pill-idle', '-');
    pill.id = 'desk-pill';
    controls.append(pill);
    head.append(controls);
    host.append(head);

    var stream = el('div', 'desk-stream');
    stream.id = 'desk-stream';
    host.append(stream);

    var chip = el('div', 'desk-reply-chip');
    chip.id = 'desk-reply-chip';
    chip.hidden = true;
    host.append(chip);

    var pad = el('div', 'desk-pad');
    pad.id = 'desk-fwd-pad';
    pad.hidden = true;
    pad.innerHTML = ''
      + '<div class="desk-pad-card">'
      + '<div class="desk-pad-head"><span>Forward message</span>'
      + '<button type="button" class="desk-pad-x" id="desk-fwd-x" aria-label="Close">x</button></div>'
      + '<p class="desk-pad-preview muted" id="desk-fwd-preview"></p>'
      + '<label class="desk-pad-note-label" for="desk-fwd-note">Add a note (optional - appears with the forward)</label>'
      + '<textarea id="desk-fwd-note" class="desk-pad-note" rows="2" placeholder="@everyone check this out..."></textarea>'
      + '<div class="desk-pad-list" id="desk-fwd-list"></div>'
      + '<div class="desk-pad-foot">'
      + '<button type="button" class="btn small" id="desk-fwd-cancel">Cancel</button>'
      + '<button type="button" class="btn primary small" id="desk-fwd-go" disabled>Forward here</button>'
      + '</div></div>';
    host.append(pad);

    var composer = el('div', 'desk-composer');
    var input = document.createElement('textarea');
    input.id = 'desk-input';
    input.className = 'desk-input';
    input.rows = 2;
    input.placeholder = 'Message as the bot...';
    composer.append(input);
    var row = el('div', 'desk-composer-row');
    var send = el('button', 'btn primary small desk-send', 'Send');
    send.type = 'button';
    send.id = 'desk-send';
    send.disabled = true;
    row.append(send);
    composer.append(row);
    host.append(composer);

    setFeed('Select a channel when ready...');
    setComposer();
    wireScroll();
    wireShellHandlers(host);
    // Single enhance pass after structure is stable
    requestAnimationFrame(function () {
      try {
        if (typeof window.enhanceSelects === 'function') window.enhanceSelects(host);
      } catch (e) {}
      host.classList.add('desk-ready');
    });
  }

  function wireShellHandlers(host) {
    if (host.dataset.deskWired === '1') return;
    host.dataset.deskWired = '1';
    var chSel = $('desk-channel-sel');
    var foSel = $('desk-forum-sel');
    if (chSel && !chSel.dataset.wired) {
      chSel.dataset.wired = '1';
      chSel.addEventListener('change', function () { onPick(chSel.value || null, 'channel'); });
    }
    if (foSel && !foSel.dataset.wired) {
      foSel.dataset.wired = '1';
      foSel.addEventListener('change', function () { onPick(foSel.value || null, 'forum'); });
    }
    var pad = $('desk-fwd-pad');
    if (pad && !pad.dataset.wired) {
      pad.dataset.wired = '1';
      pad.addEventListener('click', function (ev) { if (ev.target === pad) closeForwardPad(); });
      var fx = $('desk-fwd-x'); if (fx) fx.addEventListener('click', closeForwardPad);
      var fc = $('desk-fwd-cancel'); if (fc) fc.addEventListener('click', closeForwardPad);
      var fg = $('desk-fwd-go');
      if (fg) fg.addEventListener('click', function () {
        if (!padTarget || !desk.forwardMsg) return;
        doForward(padTarget, desk.forwardMsg);
      });
    }
    var input = $('desk-input');
    if (input && !input.dataset.wired) {
      input.dataset.wired = '1';
      input.addEventListener('input', setComposer);
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); doSend(); }
      });
    }
    var send = $('desk-send');
    if (send && !send.dataset.wired) {
      send.dataset.wired = '1';
      send.addEventListener('click', doSend);
    }
    wireScroll();
  }

  async function loadCh() {
    var g = gid();
    if (!g) { setFeed('Connecting...'); return false; }
    try {
      var out = await deskGet('/api/guild/' + encodeURIComponent(g) + '/desk/channels');
      if (!out.res.ok) {
        setFeed(out.res.status === 401 ? 'Sign in again to load channels.' : 'Could not load channels.');
        return false;
      }
      desk.channels = out.data.channels || [];
      desk.loadedGuild = g;
      var textCh = desk.channels.filter(function (c) { return !c.isForum; });
      var forums = desk.channels.filter(function (c) { return !!c.isForum; });
      fillSelect($('desk-channel-sel'), textCh, 'Text channels...');
      fillSelect($('desk-forum-sel'), forums, 'Forum posts...');
      // Re-sync labels only - do not re-run enhanceSelects (that rebuilds triggers and causes flicker)
      try {
        syncCselectLabel($('desk-channel-sel'));
        syncCselectLabel($('desk-forum-sel'));
        // If enhance never ran (slow path), run once
        var host = $('overview-desk');
        if (host && !host.classList.contains('desk-ready') && typeof window.enhanceSelects === 'function') {
          window.enhanceSelects(host);
          host.classList.add('desk-ready');
        }
      } catch (e) {}
      if (!desk.channelId) {
        setFeed((textCh.length || forums.length)
          ? 'Select a channel or forum post to open the desk.'
          : 'No channels available.');
      }
      setPill('idle', textCh.length + ' ch | ' + forums.length + ' posts');
      var stream = $('desk-stream');
      if (stream) {
        stream.classList.remove('desk-fade');
        void stream.offsetWidth;
        stream.classList.add('desk-fade');
      }
      return true;
    } catch (e) {
      setFeed('Network error loading channels.');
      return false;
    }
  }

  function rowSig(m) {
    try {
      return JSON.stringify([m.id, m.content, m.author, m.refKind, m.repliedTo, m.forwardSnapshot, m.editedAt || m.edited || null]);
    } catch (e) { return String(m.id) + ':' + String(m.content || ''); }
  }

  // id -> { sig, node }. Rows whose message did not change are put back as
  // the same nodes, so their avatars are not fetched and decoded again. Every
  // new message used to rebuild all 40 rows from scratch.
  var rowCache = new Map();

  function renderMsgs(msgs) {
    var f = $('desk-stream');
    if (!f) return;
    var prevTop = f.scrollTop;
    var prevHeight = f.scrollHeight;
    var wasStick = desk.stickBottom;

    if (!msgs.length) {
      rowCache.clear();
      f.replaceChildren(el('div', 'desk-empty', 'No messages yet.'));
      return;
    }
    var nextCache = new Map();
    var nodes = [];
    msgs.forEach(function (m) {
      var sig = rowSig(m);
      var hit = m.id != null ? rowCache.get(m.id) : null;
      if (hit && hit.sig === sig) {
        nextCache.set(m.id, hit);
        nodes.push(hit.node);
        return;
      }
      var built = buildRow(m);
      if (m.id != null) nextCache.set(m.id, { sig: sig, node: built });
      nodes.push(built);
    });
    rowCache = nextCache;
    f.replaceChildren.apply(f, nodes);

    if (wasStick) {
      f.scrollTop = f.scrollHeight;
    } else {
      var delta = f.scrollHeight - prevHeight;
      f.scrollTop = prevTop + Math.max(0, delta);
    }
  }

  function buildRow(m) {
    {
      var rowCls = 'desk-row' + (m.author && m.author.bot ? ' is-bot' : '')
        + (m.refKind === 'forward' || m.forwardSnapshot ? ' is-fwd' : '')
        + (m.refKind === 'reply' || m.repliedTo ? ' is-reply' : '');
      var row = el('div', rowCls);
      var av = el('div', 'desk-avatar desk-avatar-ph', ((m.author && m.author.name) || '?').slice(0, 1).toUpperCase());
      if (m.author && m.author.avatar) {
        var img = document.createElement('img');
        img.className = 'desk-avatar';
        img.src = m.author.avatar;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        av = img;
      }
      row.append(av);
      var body = el('div', 'desk-body');
      var meta = el('div', 'desk-meta');
      meta.append(el('span', 'desk-author', (m.author && m.author.name) || 'Unknown'));
      if (m.author && m.author.bot) meta.append(el('span', 'desk-app', 'APP'));
      if (m.refKind === 'forward' || m.forwardSnapshot) {
        meta.append(el('span', 'desk-badge desk-badge-fwd', 'Forwarded'));
      } else if (m.refKind === 'reply' || m.repliedTo) {
        meta.append(el('span', 'desk-badge desk-badge-reply', 'Reply'));
      }
      body.append(meta);

      if (m.repliedTo || (m.refKind === 'reply' && m.reference)) {
        var rbar = el('div', 'desk-ref desk-ref-reply');
        var rWho = (m.repliedTo && m.repliedTo.author && m.repliedTo.author.name) || 'someone';
        var rTxt = (m.repliedTo && m.repliedTo.content) || '';
        var rTop = el('div', 'desk-ref-top');
        rTop.append(el('span', 'desk-ref-label', 'Replying to'));
        rTop.append(el('strong', 'desk-ref-author', rWho));
        rbar.append(rTop);
        if (rTxt) rbar.append(el('div', 'desk-ref-snippet', rTxt));
        body.append(rbar);
      }

      if (m.forwardSnapshot || m.refKind === 'forward') {
        var fbar = el('div', 'desk-ref desk-ref-fwd');
        var fTop = el('div', 'desk-ref-top');
        fTop.append(el('span', 'desk-ref-label', 'Forwarded message'));
        var fWho = (m.forwardSnapshot && m.forwardSnapshot.author && m.forwardSnapshot.author.name) || '';
        if (fWho) fTop.append(el('strong', 'desk-ref-author', fWho));
        fbar.append(fTop);
        var fTxt = (m.forwardSnapshot && m.forwardSnapshot.content) || '';
        if (fTxt) fbar.append(el('div', 'desk-ref-snippet', fTxt));
        else if (!m.content) fbar.append(el('div', 'desk-ref-snippet desk-ref-muted', '(original message)'));
        body.append(fbar);
      }

      if (m.content) body.append(el('div', 'desk-text', m.content));

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
        input.value = (input.value ? input.value + '\n' : '') + (snip ? ('> ' + snip.replace(/\n/g, '\n> ') + '\n') : '');
        desk.replyTo = m.id;
        desk.replyName = (m.author && m.author.name) || 'message';
        paintReplyChip();
        input.focus();
        setComposer();
      });
      actions.append(quoteBtn);

      var fwdBtn = el('button', 'desk-act', 'Forward');
      fwdBtn.type = 'button';
      fwdBtn.addEventListener('click', function () { openForwardPad(m); });
      actions.append(fwdBtn);

      body.append(actions);
      row.append(body);
      return row;
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
      var body = { content: text };
      if (desk.replyTo) body.replyTo = desk.replyTo;
      var out = await deskPost(desk.channelId, body);
      if (out.res.ok && !out.data.error) {
        input.value = '';
        desk.replyTo = null;
        desk.replyName = '';
        paintReplyChip();
        await hist(true);
      } else {
        var det = (out.data && (out.data.detail || out.data.error)) || ('HTTP ' + out.res.status);
        setPill('err', 'Send failed: ' + String(det).slice(0, 80));
      }
    } catch (e) {
      setPill('err', 'Send error');
    }
    desk.busy = false;
    setComposer();
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
      // Every row's content, not just count + last id: an edit or a delete
      // further up used to go unnoticed until the next new message.
      var sig = msgs.map(rowSig).join('\u0001');
      if (quiet && sig === desk.lastSig) return;
      desk.lastSig = sig;
      desk.messages = msgs;
      renderMsgs(msgs);
      setPill('live', 'Live');
      var stream = $('desk-stream');
      if (stream && !quiet) {
        stream.classList.remove('desk-fade');
        void stream.offsetWidth;
        stream.classList.add('desk-fade');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (!quiet) setFeed('Network error loading messages.');
    }
  }

  function tick() {
    // Switching server in the panel changes the guild under the desk. Its
    // channel list used to stay on the first server, so a send went to a
    // channel id the new server does not have.
    var g = gid();
    if (g && g !== desk.loadedGuild && !desk.loadingGuild) {
      if (desk.loadedGuild) {
        desk.channelId = null;
        desk.lastSig = '';
        var stream = $('desk-stream');
        if (stream) stream.replaceChildren();
      }
      desk.loadingGuild = true;
      loadCh().finally(function () { desk.loadingGuild = false; });
      return;
    }
    if (desk.paused || !desk.channelId) return;
    if (document.hidden || document.visibilityState === 'hidden') return;
    // The desk sits on Overview. On any other panel tab nobody can see it,
    // so asking Discord for its messages every 2.2s was pure load.
    var host = $('overview-desk');
    var sec = host && host.closest ? host.closest('.section') : null;
    if (sec && !sec.hasAttribute('data-active')) return;
    hist(true);
  }

  function boot() {
    if (!$('overview-desk')) return;
    shell();
    // Fast path: guild already known. Otherwise tick() picks it up as soon as
    // the panel has one. The old fallback gave up after 6s and waited for a
    // 'yser:guild-ready' event nothing ever fires, so a slow sign-in left the
    // desk stuck on "Waiting for server..." until a reload.
    if (gid()) {
      desk.loadingGuild = true;
      loadCh().finally(function () { desk.loadingGuild = false; });
    } else {
      setFeed('Connecting...');
    }
    if (desk.timer) clearInterval(desk.timer);
    desk.timer = setInterval(tick, POLL);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
