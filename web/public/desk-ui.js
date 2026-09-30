'use strict';
(function () {
  var POLL = 2800, STORE = 'yserflow.session';
  var desk = {
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
    try {
      var s = localStorage.getItem(STORE);
      if (!s) return null;
      var j = JSON.parse(s);
      return j && j.guildId ? String(j.guildId) : null;
    } catch (e) { return null; }
  }
  function token() {
    try {
      var s = localStorage.getItem(STORE);
      if (!s) return null;
      var j = JSON.parse(s);
      return j && j.token ? String(j.token) : null;
    } catch (e) { return null; }
  }
  async function ensureCsrf() {
    try {
      if (window.__csrf) return window.__csrf;
      var r = await fetch('/api/csrf', { credentials: 'same-origin' });
      var j = await r.json().catch(function () { return {}; });
      if (j && j.csrf) window.__csrf = j.csrf;
      return window.__csrf || '';
    } catch (e) { return window.__csrf || ''; }
  }
  async function deskGet(path) {
    var t = token();
    var headers = { Accept: 'application/json' };
    if (t) headers.Authorization = 'Bearer ' + t;
    var r = await fetch(path, { credentials: 'same-origin', headers: headers });
    var data = await r.json().catch(function () { return {}; });
    return { res: r, data: data };
  }
  async function deskPost(channelId, body) {
    var t = token();
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (t) headers.Authorization = 'Bearer ' + t;
    var csrf = await ensureCsrf();
    if (csrf) headers['X-CSRF-Token'] = csrf;
    var r = await fetch('/desk/' + encodeURIComponent(channelId) + '/send', {
      method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify(body || {})
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
  function setComposer() {
    var input = $('desk-input');
    var send = $('desk-send');
    var on = !!(desk.channelId && !desk.busy);
    if (input) { input.disabled = !on; }
    if (send) { send.disabled = !on || !(input && input.value.trim()); }
  }
  function fmtWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    try {
      var est = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true
      }).format(d);
      var now = new Date();
      var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var diffDays = Math.round((startToday - startMsg) / 86400000);
      if (diffDays === 0) return 'Today · ' + est + ' EST';
      if (diffDays === 1) return 'Yesterday · ' + est + ' EST';
      var date = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric'
      }).format(d);
      return date + ' · ' + est + ' EST';
    } catch (e) {
      return d.toLocaleString();
    }
  }
  function paint() {
    var feed = $('desk-feed');
    if (!feed) return;
    feed.replaceChildren();
    if (!desk.messages.length) {
      feed.append(el('div', 'desk-empty', desk.channelId ? 'No messages yet' : 'Select a channel'));
      return;
    }
    desk.messages.forEach(function (m) {
      var row = el('div', 'desk-row' + (m.author && m.author.bot ? ' is-bot' : ''));
      var av;
      if (m.author && m.author.avatar) {
        av = document.createElement('img');
        av.className = 'desk-avatar';
        av.src = m.author.avatar;
        av.alt = '';
      } else {
        av = el('div', 'desk-avatar desk-avatar-ph', ((m.author && m.author.name) || '?').slice(0, 1).toUpperCase());
      }
      row.append(av);
      var body = el('div', 'desk-body');
      var meta = el('div', 'desk-meta');
      meta.append(el('span', 'desk-name', (m.author && m.author.name) || 'Unknown'));
      if (m.author && m.author.bot) meta.append(el('span', 'desk-app', 'APP'));
      if (m.referenceId) meta.append(el('span', 'desk-ref', 'reply'));
      meta.append(el('span', 'desk-when', fmtWhen(m.createdAt)));
      body.append(meta);
      if (m.content) body.append(el('div', 'desk-text', m.content));
      var media = el('div', 'desk-media');
      var imgs = [].concat(m.images || [], (m.attachments || []).filter(function (a) {
        return a && a.url && (/^image\//i.test(a.contentType || '') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.url));
      }));
      imgs.slice(0, 4).forEach(function (im) {
        var img = document.createElement('img');
        img.className = 'desk-thumb';
        img.src = im.url;
        img.alt = im.name || '';
        img.addEventListener('click', function () {
          var lb = $('desk-lightbox');
          if (!lb) return;
          var i = lb.querySelector('img');
          if (i) i.src = im.url;
          lb.hidden = false;
        });
        media.append(img);
      });
      (m.attachments || []).forEach(function (a) {
        if (!a || !a.url) return;
        if (/^image\//i.test(a.contentType || '') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.url)) return;
        var link = el('a', 'desk-file', a.name || 'file');
        link.href = a.url;
        link.target = '_blank';
        link.rel = 'noopener';
        media.append(link);
      });
      if (media.childNodes.length) body.append(media);
      var actions = el('div', 'desk-actions');
      var replyBtn = el('button', 'desk-act', 'Reply');
      replyBtn.type = 'button';
      replyBtn.addEventListener('click', function () {
        desk.replyTo = m.id;
        var chip = $('desk-reply-chip');
        if (chip) {
          chip.hidden = false;
          var lab = chip.querySelector('.desk-reply-to');
          if (lab) lab.textContent = (m.author && m.author.name) || 'message';
        }
        var input = $('desk-input');
        if (input) input.focus();
      });
      actions.append(replyBtn);
      var quoteBtn = el('button', 'desk-act', 'Quote');
      quoteBtn.type = 'button';
      quoteBtn.addEventListener('click', function () {
        var input = $('desk-input');
        if (!input) return;
        var q = '> ' + String(m.content || '').split('\n').join('\n> ');
        input.value = (input.value ? input.value + '\n' : '') + q + '\n';
        setComposer();
        input.focus();
      });
      actions.append(quoteBtn);
      var fwdBtn = el('button', 'desk-act', 'Forward');
      fwdBtn.type = 'button';
      fwdBtn.addEventListener('click', function () { openPad(m); });
      actions.append(fwdBtn);
      body.append(actions);
      row.append(body);
      if (m.author && m.author.bot) {
        var side = el('div', 'desk-side');
        var del = el('button', 'desk-del', 'Delete');
        del.type = 'button';
        del.title = 'Delete message';
        del.addEventListener('click', function () { openDeletePad(m); });
        side.append(del);
        row.append(side);
      }
      feed.append(row);
    });
    try { feed.scrollTop = feed.scrollHeight; } catch (e) {}
  }
  async function hist(full) {
    if (!desk.channelId || desk.busy) return;
    try {
      var q = '/desk/' + encodeURIComponent(desk.channelId) + '?limit=50';
      var out = await deskGet(q);
      if (!out.res.ok || out.data.error) {
        setPill('err', 'Error');
        return;
      }
      var incoming = out.data.messages || [];
      var sig = incoming.map(function (m) { return m.id; }).join(',');
      if (sig !== desk.lastSig || full) {
        desk.lastSig = sig;
        desk.messages = incoming.slice(-80);
        paint();
      }
    } catch (e) {
      setPill('err', 'Error');
    }
  }
  async function loadCh() {
    var g = gid();
    if (!g) return;
    var out = await deskGet('/desk/channels?guildId=' + encodeURIComponent(g));
    if (!out.res.ok || out.data.error) return;
    desk.channels = out.data.channels || [];
    var sel = $('desk-channel-sel');
    if (!sel) return;
    sel.replaceChildren();
    sel.append(el('option', '', 'Select channel…')).value = '';
    var groups = {}, order = [];
    desk.channels.forEach(function (c) {
      var cat = (c.category && String(c.category).trim()) || 'Channels';
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(c);
    });
    order.forEach(function (cat) {
      var og = document.createElement('optgroup');
      og.label = cat;
      groups[cat].forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = '# ' + c.name;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    try {
      if (typeof window.enhanceSelects === 'function') window.enhanceSelects(sel.parentElement || sel);
    } catch (e) {}
  }
  async function openCh(id) {
    desk.channelId = id || null;
    desk.messages = [];
    desk.lastSig = '';
    desk.replyTo = null;
    paint();
    setComposer();
    var mod = $('desk-mod');
    if (mod) mod.classList.toggle('is-on', !!id);
    if (!id) { setPill('paused', 'Idle'); return; }
    setPill('live', 'LIVE');
    await hist(true);
  }
  async function doSend() {
    var input = $('desk-input');
    if (!input || !desk.channelId) return;
    var text = String(input.value || '').trim();
    if (!text) return;
    desk.busy = true;
    setComposer();
    try {
      var body = { content: text };
      if (desk.replyTo) body.replyTo = desk.replyTo;
      var out = await deskPost(desk.channelId, body);
      if (!out.res.ok || out.data.error) { setPill('err', 'Send failed'); return; }
      input.value = '';
      desk.replyTo = null;
      var chip = $('desk-reply-chip');
      if (chip) chip.hidden = true;
      if (out.data.message) {
        desk.messages.push(out.data.message);
        paint();
      } else {
        await hist(true);
      }
      setPill('live', 'LIVE');
    } catch (e) {
      setPill('err', 'Error');
    } finally {
      desk.busy = false;
      setComposer();
    }
  }
  async function doDelete(messageId) {
    if (!desk.channelId || !messageId) return;
    desk.busy = true;
    setComposer();
    try {
      var out = await deskPost(desk.channelId, { action: 'delete', messageId: messageId });
      if (!out.res.ok || out.data.error) { setPill('err', 'Error'); return; }
      desk.messages = desk.messages.filter(function (m) { return m.id !== messageId; });
      paint();
    } catch (e) {
      setPill('err', 'Error');
    } finally {
      desk.busy = false;
      setComposer();
    }
  }
  async function doForward(targetId, m) {
    if (!targetId || !m || !m.id) return;
    desk.busy = true;
    setComposer();
    try {
      var noteEl = $('desk-pad-note');
      var note = noteEl ? String(noteEl.value || '').trim().slice(0, 2000) : '';
      if (desk._pendingNote != null) { note = desk._pendingNote; desk._pendingNote = null; }
      var out = await deskPost(targetId, {
        action: 'forward',
        messageId: m.id,
        sourceChannelId: desk.channelId,
        content: note
      });
      if (!out.res.ok || out.data.error) setPill('err', 'Forward failed');
      else setPill('live', 'Forwarded');
    } catch (e) {
      setPill('err', 'Error');
    } finally {
      desk.busy = false;
      setComposer();
      if (desk.channelId && !desk.paused) setTimeout(function () { hist(true); }, 400);
    }
  }
  async function runMod(kind) {
    if (!desk.channelId) return;
    desk.busy = true;
    setComposer();
    try {
      await ensureCsrf();
      if (kind === 'lock' || kind === 'unlock') {
        var r = await fetch('/api/moderation/channel-lock', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + (token() || ''),
            'X-CSRF-Token': window.__csrf || ''
          },
          body: JSON.stringify({ channelId: desk.channelId, lock: kind === 'lock' })
        });
        if (!r.ok) setPill('err', 'Mod failed');
        else setPill('live', kind === 'lock' ? 'Locked' : 'Unlocked');
        return;
      }
      var amount = 10;
      if (kind === 'purge25') amount = 25;
      if (kind === 'purge50') amount = 50;
      if (kind === 'purgeuser') {
        var uid = prompt('User ID to purge');
        if (!uid) return;
        var out = await deskPost(desk.channelId, { action: 'purgeUser', amount: amount, userId: String(uid).trim() });
        if (!out.res.ok || out.data.error) setPill('err', 'Purge failed');
        else { setPill('live', 'Purged'); await hist(true); }
        return;
      }
      var out2 = await deskPost(desk.channelId, { action: 'purge', amount: amount });
      if (!out2.res.ok || out2.data.error) setPill('err', 'Purge failed');
      else { setPill('live', 'Purged'); await hist(true); }
    } catch (e) {
      setPill('err', 'Error');
    } finally {
      desk.busy = false;
      setComposer();
    }
  }
  var padTarget = null;
  function fillPreview(host, m) {
    if (!host || !m) return;
    host.replaceChildren();
    var top = el('div', 'desk-pad-prev-top');
    var av;
    if (m.author && m.author.avatar) {
      av = document.createElement('img');
      av.className = 'desk-pad-prev-av';
      av.src = m.author.avatar;
      av.alt = '';
    } else {
      av = el('div', 'desk-pad-prev-av desk-avatar-ph', ((m.author && m.author.name) || '?').slice(0, 1).toUpperCase());
    }
    top.append(av);
    var meta = el('div', 'desk-pad-prev-meta');
    meta.append(el('div', 'desk-pad-prev-name', (m.author && m.author.name) || 'Unknown'));
    var body = String(m.content || '').trim();
    if (!body) {
      var hasMedia = (m.attachments && m.attachments.length) || (m.images && m.images.length) || m.embeds;
      body = hasMedia ? '(media attachment)' : '(empty message)';
    }
    meta.append(el('div', 'desk-pad-prev-text', body.slice(0, 220)));
    top.append(meta);
    host.append(top);
  }
  function closePad() {
    desk.forwardMsg = null;
    desk.deleteMsg = null;
    desk.padMode = null;
    padTarget = null;
    var pad = $('desk-pad');
    if (pad) { pad.hidden = true; pad.classList.remove('is-delete'); }
    var go = $('desk-pad-go');
    if (go) { go.disabled = true; go.textContent = 'Forward here'; go.className = 'btn primary small'; }
    var note = $('desk-pad-note');
    if (note) note.value = '';
    var warn = $('desk-pad-warn');
    if (warn) warn.hidden = true;
    var body = $('desk-pad-forward-body');
    if (body) body.hidden = false;
  }
  function openPad(m) {
    desk.padMode = 'forward';
    desk.forwardMsg = m;
    desk.deleteMsg = null;
    padTarget = null;
    var pad = $('desk-pad');
    if (pad) pad.classList.remove('is-delete');
    var title = $('desk-pad-title');
    if (title) title.textContent = 'Forward message';
    fillPreview($('desk-pad-preview'), m);
    var note = $('desk-pad-note');
    if (note) note.value = '';
    var warn = $('desk-pad-warn');
    if (warn) warn.hidden = true;
    var body = $('desk-pad-forward-body');
    if (body) body.hidden = false;
    var go = $('desk-pad-go');
    if (go) { go.disabled = true; go.textContent = 'Forward here'; go.className = 'btn primary small'; }
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
          b.type = 'button';
          b.dataset.id = c.id;
          if (c.id === desk.channelId) b.classList.add('is-current');
          b.addEventListener('click', function () {
            list.querySelectorAll('.desk-pad-ch').forEach(function (x) { x.classList.remove('is-on'); });
            b.classList.add('is-on');
            padTarget = c.id;
            var g = $('desk-pad-go');
            if (g) g.disabled = !padTarget;
          });
          list.append(b);
        });
      });
    }
    if (pad) pad.hidden = false;
  }
  function openDeletePad(m) {
    desk.padMode = 'delete';
    desk.deleteMsg = m;
    desk.forwardMsg = null;
    padTarget = null;
    var pad = $('desk-pad');
    if (pad) pad.classList.add('is-delete');
    var title = $('desk-pad-title');
    if (title) title.textContent = 'Delete message?';
    fillPreview($('desk-pad-preview'), m);
    var body = $('desk-pad-forward-body');
    if (body) body.hidden = true;
    var warn = $('desk-pad-warn');
    if (warn) warn.hidden = false;
    var go = $('desk-pad-go');
    if (go) { go.disabled = false; go.textContent = 'Delete permanently'; go.className = 'btn small desk-pad-danger'; }
    if (pad) pad.hidden = false;
  }
  function shell() {
    var host = $('overview-desk');
    if (!host) return;
    host.dataset.ready = '1';
    host.className = 'panel desk-panel';
    host.replaceChildren();
    var head = el('div', 'desk-head');
    var tb = el('div', 'desk-title-block');
    tb.append(el('p', 'desk-kicker', 'CHANNEL DESK'));
    tb.append(el('p', 'muted', 'Watch a channel and reply as Quantbot'));
    head.append(tb);
    var controls = el('div', 'desk-controls');
    var wrap = el('div', 'desk-select-wrap');
    var sel = document.createElement('select');
    sel.id = 'desk-channel-sel';
    sel.className = 'lvl-input desk-channel-sel';
    sel.append(el('option', '', 'Select channel…'));
    wrap.append(sel);
    controls.append(wrap);
    var pill = el('span', 'desk-pill paused', 'Idle');
    pill.id = 'desk-pill';
    controls.append(pill);
    var pause = el('button', 'btn small', 'Pause');
    pause.type = 'button';
    pause.id = 'desk-pause';
    controls.append(pause);
    head.append(controls);
    host.append(head);
    var mod = el('div', 'desk-mod');
    mod.id = 'desk-mod';
    [['lock', 'Lock'], ['unlock', 'Unlock'], ['sep'], ['purge10', 'Purge 10'], ['purge25', 'Purge 25'], ['purge50', 'Purge 50'], ['purgeuser', 'Purge user…']].forEach(function (x) {
      if (x[0] === 'sep') { mod.append(el('div', 'desk-mod-sep')); return; }
      var b = el('button', 'desk-mod-btn', x[1]);
      b.type = 'button';
      b.addEventListener('click', function () { runMod(x[0]); });
      mod.append(b);
    });
    host.append(mod);
    var wrapF = el('div', 'desk-feed-wrap');
    var feed = el('div', 'desk-feed');
    feed.id = 'desk-feed';
    wrapF.append(feed);
    host.append(wrapF);
    var composer = el('div', 'desk-composer');
    var chip = el('div', 'desk-reply-chip');
    chip.id = 'desk-reply-chip';
    chip.hidden = true;
    chip.innerHTML = '<span><span class="desk-reply-label">Replying to</span><span class="desk-reply-to"></span></span><button type="button" class="desk-reply-clear" id="desk-reply-clear">×</button>';
    composer.append(chip);
    var row = el('div', 'desk-input-row');
    var input = document.createElement('textarea');
    input.id = 'desk-input';
    input.className = 'desk-input';
    input.rows = 1;
    input.placeholder = 'Message as Quantbot…';
    input.disabled = true;
    input.addEventListener('input', setComposer);
    row.append(input);
    var send = el('button', 'btn primary small desk-send', 'Send');
    send.type = 'button';
    send.id = 'desk-send';
    send.disabled = true;
    send.addEventListener('click', doSend);
    row.append(send);
    composer.append(row);
    host.append(composer);
    var pad = el('div', 'desk-pad');
    pad.id = 'desk-pad';
    pad.hidden = true;
    pad.innerHTML = '<div class="desk-pad-card">' +
      '<div class="desk-pad-head"><span id="desk-pad-title">Forward message</span><button type="button" class="desk-pad-x" id="desk-pad-x" aria-label="Close">×</button></div>' +
      '<div class="desk-pad-preview-card" id="desk-pad-preview"></div>' +
      '<div id="desk-pad-forward-body">' +
      '<label class="desk-pad-note-label" for="desk-pad-note">Add a note (optional — posts below the forward)</label>' +
      '<textarea id="desk-pad-note" class="desk-pad-note" rows="2" placeholder="@everyone check this out…"></textarea>' +
      '<div class="desk-pad-list" id="desk-pad-list"></div>' +
      '</div>' +
      '<p class="desk-pad-warn" id="desk-pad-warn" hidden>This cannot be undone. The message will be removed from the channel.</p>' +
      '<div class="desk-pad-foot">' +
      '<button type="button" class="btn small" id="desk-pad-cancel">Cancel</button>' +
      '<button type="button" class="btn primary small" id="desk-pad-go" disabled>Forward here</button>' +
      '</div></div>';
    host.append(pad);
    var lb = el('div', 'desk-lightbox');
    lb.id = 'desk-lightbox';
    lb.hidden = true;
    lb.innerHTML = '<button type="button" class="desk-lb-close" aria-label="Close">×</button><img alt="">';
    host.append(lb);
    $('desk-pad-x').addEventListener('click', closePad);
    $('desk-pad-cancel').addEventListener('click', closePad);
    $('desk-pad-go').addEventListener('click', function () {
      if (desk.padMode === 'delete') {
        var dm = desk.deleteMsg;
        if (!dm || !dm.id) return;
        closePad();
        doDelete(dm.id);
        return;
      }
      if (!padTarget || !desk.forwardMsg) return;
      var target = padTarget;
      var msg = desk.forwardMsg;
      var noteEl = $('desk-pad-note');
      desk._pendingNote = noteEl ? String(noteEl.value || '').trim().slice(0, 2000) : '';
      closePad();
      doForward(target, msg);
    });
    pad.addEventListener('click', function (ev) { if (ev.target === pad) closePad(); });
    $('desk-reply-clear').addEventListener('click', function () {
      desk.replyTo = null;
      var c = $('desk-reply-chip');
      if (c) c.hidden = true;
    });
    sel.addEventListener('change', function () { openCh(sel.value || null); });
    pause.addEventListener('click', function () {
      desk.paused = !desk.paused;
      pause.textContent = desk.paused ? 'Resume' : 'Pause';
      setPill(desk.paused ? 'paused' : 'live', desk.paused ? 'Paused' : 'LIVE');
    });
    lb.addEventListener('click', function (ev) {
      if (ev.target === lb || ev.target.classList.contains('desk-lb-close')) lb.hidden = true;
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); doSend(); }
    });
    paint();
    setComposer();
    loadCh();
  }
  function tick() {
    if (desk.paused || !desk.channelId) return;
    if (document.hidden || document.visibilityState === 'hidden') return;
    hist(true);
  }
  function boot() {
    if (!$('overview-desk')) return;
    shell();
    if (desk.timer) clearInterval(desk.timer);
    desk.timer = setInterval(tick, POLL);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
