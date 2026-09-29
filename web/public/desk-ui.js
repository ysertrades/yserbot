'use strict';
/** QuantLab Channel Desk — Overview live channel monitor (isolated) */
(function () {
  var POLL_MS = 2500;
  var MAX_ROWS = 120;
  var STORE_KEY = 'yserflow.session';
  var desk = {
    channelId: null,
    messages: [],
    canSend: false,
    replyTo: null,
    replyPreview: '',
    pollTimer: null,
    busy: false,
    paused: false,
    pendingNew: 0,
    stickBottom: true,
    csrf: null,
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** app.js uses script-scoped `const state` — not on window. Use URL + storage. */
  function guildId() {
    try {
      if (window.state && window.state.guildId) return window.state.guildId;
    } catch (e) {}
    try {
      var g = new URLSearchParams(location.search).get('g');
      if (g && /^\d{5,25}$/.test(g)) return g;
    } catch (e) {}
    return null;
  }

  function sessionToken() {
    try {
      if (window.state && window.state.token) return window.state.token;
    } catch (e) {}
    try {
      return localStorage.getItem(STORE_KEY);
    } catch (e) {}
    return null;
  }

  function headers(json) {
    var h = {};
    if (json) h['content-type'] = 'application/json';
    var tok = sessionToken();
    if (tok) h['authorization'] = 'Bearer ' + tok;
    var csrf = desk.csrf;
    try {
      if (!csrf && window.state && window.state.csrf) csrf = window.state.csrf;
    } catch (e) {}
    if (csrf) h['x-csrf-token'] = csrf;
    return h;
  }

  async function ensureCsrf() {
    if (desk.csrf) return desk.csrf;
    try {
      if (window.state && window.state.csrf) {
        desk.csrf = window.state.csrf;
        return desk.csrf;
      }
    } catch (e) {}
    try {
      var res = await fetch('/api/me', { credentials: 'same-origin', headers: headers(false) });
      var data = await res.json().catch(function () { return {}; });
      if (data.csrf) desk.csrf = data.csrf;
    } catch (e) {}
    return desk.csrf;
  }

  function overviewActive() {
    return !!document.querySelector('.section[data-section="overview"][data-active]')
      || (document.documentElement.getAttribute('data-section') === 'overview');
  }

  function pageVisible() {
    return document.visibilityState !== 'hidden';
  }

  function relTime(ts) {
    var d = Date.now() - Number(ts || 0);
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.floor(d / 60000) + 'm';
    if (d < 86400000) return Math.floor(d / 3600000) + 'h';
    return Math.floor(d / 86400000) + 'd';
  }

  function escapePreview(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function root() {
    return document.getElementById('overview-desk');
  }

  function ensureShell() {
    var host = root();
    if (!host) return null;
    if (host.dataset.ready === '1') return host;
    host.dataset.ready = '1';
    host.className = 'panel desk-panel';
    host.replaceChildren();

    var head = el('div', 'desk-head');
    var title = el('div', 'desk-title-block');
    title.append(el('h2', null, 'Channel Desk'));
    title.append(el('p', 'muted', 'Watch a channel and reply as Quantbot'));
    head.append(title);

    var controls = el('div', 'desk-controls');
    var sel = document.createElement('select');
    sel.className = 'desk-select';
    sel.id = 'desk-channel';
    // Prevent app.js enhanceSelects from wrapping this (was causing double "Select channel…")
    sel.dataset.cselect = '1';
    sel.innerHTML = '<option value="">Select channel…</option>';
    controls.append(sel);

    var pill = el('span', 'desk-pill paused', 'Idle');
    pill.id = 'desk-pill';
    controls.append(pill);

    var pauseBtn = el('button', 'btn small', 'Pause');
    pauseBtn.type = 'button';
    pauseBtn.id = 'desk-pause';
    controls.append(pauseBtn);

    var jumpBtn = el('button', 'btn small', 'Latest');
    jumpBtn.type = 'button';
    jumpBtn.id = 'desk-jump';
    controls.append(jumpBtn);

    head.append(controls);
    host.append(head);

    var feedWrap = el('div', 'desk-feed-wrap');
    var feed = el('div', 'desk-feed');
    feed.id = 'desk-feed';
    feedWrap.append(feed);
    var newChip = el('button', 'desk-newchip', 'New messages');
    newChip.type = 'button';
    newChip.id = 'desk-newchip';
    newChip.hidden = true;
    feedWrap.append(newChip);
    host.append(feedWrap);

    var composer = el('div', 'desk-composer');
    var replyBar = el('div', 'desk-reply-bar');
    replyBar.id = 'desk-reply-bar';
    replyBar.hidden = true;
    composer.append(replyBar);

    var row = el('div', 'desk-input-row');
    var input = document.createElement('textarea');
    input.className = 'desk-input';
    input.id = 'desk-input';
    input.rows = 2;
    input.placeholder = 'Message as Quantbot…';
    input.disabled = true;
    row.append(input);

    var send = el('button', 'btn primary small desk-send', 'Send');
    send.type = 'button';
    send.id = 'desk-send';
    send.disabled = true;
    row.append(send);
    composer.append(row);
    host.append(composer);

    sel.addEventListener('change', function () {
      openChannel(sel.value || null);
    });
    pauseBtn.addEventListener('click', function () {
      desk.paused = !desk.paused;
      pauseBtn.textContent = desk.paused ? 'Resume' : 'Pause';
      setPill();
      if (!desk.paused) pollOnce();
    });
    jumpBtn.addEventListener('click', function () {
      desk.stickBottom = true;
      desk.pendingNew = 0;
      hideNewChip();
      scrollBottom();
    });
    newChip.addEventListener('click', function () {
      desk.stickBottom = true;
      desk.pendingNew = 0;
      hideNewChip();
      scrollBottom();
    });
    feed.addEventListener('scroll', function () {
      var near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
      desk.stickBottom = near;
      if (near) {
        desk.pendingNew = 0;
        hideNewChip();
      }
    });
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        doSend();
      }
    });

    return host;
  }

  function setPill(kind, label) {
    var pill = document.getElementById('desk-pill');
    if (!pill) return;
    pill.className = 'desk-pill ' + (kind || (desk.paused ? 'paused' : desk.channelId ? 'live' : 'paused'));
    pill.textContent = label || (desk.paused ? 'Paused' : desk.channelId ? 'Live' : 'Idle');
  }

  function hideNewChip() {
    var c = document.getElementById('desk-newchip');
    if (c) c.hidden = true;
  }

  function showNewChip() {
    var c = document.getElementById('desk-newchip');
    if (!c) return;
    c.textContent = desk.pendingNew > 1 ? (desk.pendingNew + ' new messages') : 'New messages';
    c.hidden = false;
  }

  function scrollBottom() {
    var feed = document.getElementById('desk-feed');
    if (feed) feed.scrollTop = feed.scrollHeight;
  }

  function setFeedMsg(text) {
    var feed = document.getElementById('desk-feed');
    if (!feed) return;
    feed.replaceChildren();
    feed.append(el('p', 'desk-empty', text));
  }

  function paintFeed() {
    var feed = document.getElementById('desk-feed');
    if (!feed) return;
    feed.replaceChildren();
    if (!desk.channelId) {
      feed.append(el('p', 'desk-empty', 'Select a channel to open the desk.'));
      return;
    }
    if (!desk.messages.length) {
      feed.append(el('p', 'desk-empty', 'No recent messages in this channel.'));
      return;
    }
    desk.messages.forEach(function (m) {
      feed.append(renderRow(m));
    });
    if (desk.stickBottom) scrollBottom();
  }

  function renderRow(m) {
    var row = el('div', 'desk-row' + (m.author && m.author.bot ? ' is-bot' : ''));
    row.dataset.id = m.id;

    var av = el('div', 'desk-av');
    if (m.author && m.author.avatar) {
      var img = document.createElement('img');
      img.src = m.author.avatar;
      img.alt = '';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      av.appendChild(img);
    } else {
      av.textContent = String((m.author && m.author.name) || '?').slice(0, 2).toUpperCase();
    }
    row.append(av);

    var body = el('div', 'desk-body');
    var meta = el('div', 'desk-meta');
    meta.append(el('span', 'desk-name', (m.author && m.author.name) || 'Unknown'));
    if (m.author && m.author.bot) meta.append(el('span', 'desk-app', 'APP'));
    meta.append(el('span', 'desk-time', relTime(m.createdAt)));
    var replyBtn = el('button', 'desk-reply-btn', 'Reply');
    replyBtn.type = 'button';
    replyBtn.addEventListener('click', function () {
      desk.replyTo = m.id;
      desk.replyPreview = escapePreview(m.content) || '(attachment)';
      paintReplyBar();
      var input = document.getElementById('desk-input');
      if (input) input.focus();
    });
    meta.append(replyBtn);
    body.append(meta);

    if (m.content) body.append(el('div', 'desk-text', m.content));
    var chips = el('div', 'desk-chips');
    if (m.attachments) chips.append(el('span', 'desk-chip', m.attachments + ' file' + (m.attachments > 1 ? 's' : '')));
    if (m.embeds) chips.append(el('span', 'desk-chip', m.embeds + ' embed' + (m.embeds > 1 ? 's' : '')));
    if (m.referenceId) chips.append(el('span', 'desk-chip', 'reply'));
    if (chips.childNodes.length) body.append(chips);

    row.append(body);
    return row;
  }

  function paintReplyBar() {
    var bar = document.getElementById('desk-reply-bar');
    if (!bar) return;
    if (!desk.replyTo) {
      bar.hidden = true;
      bar.replaceChildren();
      return;
    }
    bar.hidden = false;
    bar.replaceChildren();
    var label = el('span', null, null);
    label.append(document.createTextNode('Replying to '));
    var strong = el('strong', null, desk.replyPreview || 'message');
    label.append(strong);
    bar.append(label);
    var x = el('button', 'desk-reply-cancel', '×');
    x.type = 'button';
    x.title = 'Cancel reply';
    x.addEventListener('click', function () {
      desk.replyTo = null;
      desk.replyPreview = '';
      paintReplyBar();
    });
    bar.append(x);
  }

  function setComposerEnabled() {
    var input = document.getElementById('desk-input');
    var send = document.getElementById('desk-send');
    var ok = !!(desk.channelId && desk.canSend && !desk.busy);
    if (input) {
      input.disabled = !ok;
      input.placeholder = !desk.channelId
        ? 'Select a channel first…'
        : (!desk.canSend ? 'Quantbot cannot send here…' : 'Message as Quantbot…');
    }
    if (send) send.disabled = !ok;
  }

  async function loadChannels() {
    var gid = guildId();
    var sel = document.getElementById('desk-channel');
    if (!gid || !sel) {
      if (!gid) setFeedMsg('Waiting for server…');
      return;
    }
    if (sel.dataset.loaded === gid && sel.options.length > 1) return;
    setPill('live', 'Loading');
    try {
      var res = await fetch('/api/guild/' + gid + '/desk/channels', {
        credentials: 'same-origin',
        headers: headers(false),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setPill('err', 'Error');
        setFeedMsg(
          res.status === 401 ? 'Sign in again to load channels.'
            : res.status === 403 ? 'No access to this server.'
            : ('Could not load channels (' + (data.error || res.status) + ').')
        );
        return;
      }
      var prev = desk.channelId || sel.value;
      sel.replaceChildren();
      sel.append(new Option('Select channel…', ''));
      var list = data.channels || [];
      var groups = {};
      list.forEach(function (c) {
        var cat = c.category || 'Channels';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(c);
      });
      Object.keys(groups).forEach(function (cat) {
        var og = document.createElement('optgroup');
        og.label = cat;
        groups[cat].forEach(function (c) {
          og.append(new Option('#' + c.name, c.id));
        });
        sel.append(og);
      });
      sel.dataset.loaded = gid;
      if (prev && Array.from(sel.options).some(function (o) { return o.value === prev; })) {
        sel.value = prev;
      }
      if (!list.length) {
        setPill('err', 'Empty');
        setFeedMsg('No channels Quantbot can read. Check View Channel + Read History permissions.');
      } else {
        setPill('paused', 'Idle');
        if (!desk.channelId) setFeedMsg('Select a channel to open the desk.');
      }
    } catch (e) {
      console.warn('[desk] channels', e);
      setPill('err', 'Error');
      setFeedMsg('Network error loading channels.');
    }
  }

  async function openChannel(id) {
    desk.channelId = id || null;
    desk.messages = [];
    desk.replyTo = null;
    desk.replyPreview = '';
    desk.pendingNew = 0;
    desk.stickBottom = true;
    desk.canSend = false;
    hideNewChip();
    paintReplyBar();
    paintFeed();
    setComposerEnabled();
    stopPoll();
    if (!id) {
      setPill('paused', 'Idle');
      return;
    }
    setPill('live', 'Loading');
    await fetchHistory(false);
    if (!desk.paused) startPoll();
  }

  async function fetchHistory(delta) {
    var gid = guildId();
    if (!gid || !desk.channelId || desk.busy) return;
    desk.busy = true;
    try {
      var url = '/api/guild/' + gid + '/desk/' + desk.channelId + '?limit=50';
      if (delta && desk.messages.length) {
        url += '&after=' + encodeURIComponent(desk.messages[desk.messages.length - 1].id);
      }
      var res = await fetch(url, { credentials: 'same-origin', headers: headers(false) });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setPill('err', data.error === 'no_access' ? 'No access' : 'Error');
        if (!delta) setFeedMsg(data.error === 'no_access'
          ? 'Quantbot cannot read this channel.'
          : 'Could not load messages.');
        return;
      }
      desk.canSend = !!data.canSend;
      setComposerEnabled();
      var incoming = data.messages || [];
      if (!delta) {
        desk.messages = incoming.slice(-MAX_ROWS);
        paintFeed();
        setPill(desk.paused ? 'paused' : 'live', desk.paused ? 'Paused' : 'Live');
        return;
      }
      if (!incoming.length) {
        setPill(desk.paused ? 'paused' : 'live', desk.paused ? 'Paused' : 'Live');
        return;
      }
      var known = new Set(desk.messages.map(function (m) { return m.id; }));
      var added = 0;
      incoming.forEach(function (m) {
        if (known.has(m.id)) return;
        desk.messages.push(m);
        known.add(m.id);
        added++;
      });
      if (desk.messages.length > MAX_ROWS) {
        desk.messages = desk.messages.slice(-MAX_ROWS);
      }
      if (added) {
        paintFeed();
        if (!desk.stickBottom) {
          desk.pendingNew += added;
          showNewChip();
        }
      }
      setPill(desk.paused ? 'paused' : 'live', desk.paused ? 'Paused' : 'Live');
    } catch (e) {
      console.warn('[desk] history', e);
      setPill('err', 'Error');
    } finally {
      desk.busy = false;
    }
  }

  async function doSend() {
    var input = document.getElementById('desk-input');
    var gid = guildId();
    if (!input || !gid || !desk.channelId || !desk.canSend) return;
    var text = String(input.value || '').trim();
    if (!text) return;
    var sendBtn = document.getElementById('desk-send');
    if (sendBtn) sendBtn.disabled = true;
    desk.busy = true;
    try {
      await ensureCsrf();
      var res = await fetch('/api/guild/' + gid + '/desk/' + desk.channelId + '/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers(true),
        body: JSON.stringify({ content: text, replyTo: desk.replyTo || undefined }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || data.error) {
        if (typeof toast === 'function') {
          toast('Could not send — ' + (data.detail || data.error || res.status), 'bad');
        }
        return;
      }
      input.value = '';
      desk.replyTo = null;
      desk.replyPreview = '';
      paintReplyBar();
      if (data.message) {
        desk.messages.push(data.message);
        if (desk.messages.length > MAX_ROWS) desk.messages = desk.messages.slice(-MAX_ROWS);
        desk.stickBottom = true;
        paintFeed();
      } else {
        await fetchHistory(true);
      }
    } catch (e) {
      console.warn('[desk] send', e);
      if (typeof toast === 'function') toast('Send failed', 'bad');
    } finally {
      desk.busy = false;
      setComposerEnabled();
    }
  }

  function pollOnce() {
    if (desk.paused || !desk.channelId) return;
    if (!overviewActive() || !pageVisible()) return;
    fetchHistory(true);
  }

  function startPoll() {
    stopPoll();
    desk.pollTimer = setInterval(pollOnce, POLL_MS);
  }

  function stopPoll() {
    if (desk.pollTimer) {
      clearInterval(desk.pollTimer);
      desk.pollTimer = null;
    }
  }

  function mount() {
    if (!root()) return;
    ensureShell();
    var feed = document.getElementById('desk-feed');
    if (feed && !feed.childNodes.length) paintFeed();
    var gid = guildId();
    if (!gid) return;
    loadChannels();
    if (desk.channelId && !desk.paused) startPoll();
  }

  function boot() {
    var tries = 0;
    function tryMount() {
      if (!root()) return;
      mount();
    }
    function retryUntilGuild() {
      tryMount();
      if (!guildId() && tries < 80) {
        tries += 1;
        setTimeout(retryUntilGuild, 400);
      }
    }
    document.addEventListener('panel-overview', tryMount);
    var obs = new MutationObserver(function () {
      if (overviewActive()) {
        tryMount();
        if (desk.channelId && !desk.paused) startPoll();
      } else {
        stopPoll();
      }
    });
    if (document.body) {
      obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-active', 'data-section'] });
    }
    try {
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-section'] });
    } catch (e) {}
    // URL ?g= updates when switching servers
    window.addEventListener('popstate', function () {
      var sel = document.getElementById('desk-channel');
      if (sel) delete sel.dataset.loaded;
      tryMount();
    });
    document.addEventListener('visibilitychange', function () {
      if (pageVisible() && overviewActive() && desk.channelId && !desk.paused) startPoll();
      else if (!pageVisible()) stopPoll();
    });
    var prev = window.showSection;
    if (typeof prev === 'function') {
      window.showSection = function (name) {
        var r = prev.apply(this, arguments);
        if (name === 'overview') {
          setTimeout(tryMount, 40);
          if (desk.channelId && !desk.paused) startPoll();
        } else {
          stopPoll();
        }
        return r;
      };
    }
    retryUntilGuild();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
