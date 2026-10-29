'use strict';
/*
 * The charts-style shell (the design board, built on the real panel).
 * Nothing here talks to the bot or changes what a control does:
 *   - mirrors: the sidebar's server card, the breadcrumb and the page title
 *     copy what app.full.js has drawn into #crest / #server-name /
 *     #server-meta / #here;
 *   - columns: each section's own blocks are moved (never rebuilt or copied)
 *     into a main and a side column, so every listener and id stays attached;
 *   - read-only extras drawn from data the panel already loaded: the week
 *     strip in Automation and the one-line bot status in the sidebar.
 * If this file failed to load, the panel would simply keep its old layout.
 */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  /* The redesign is on for everyone: index.html carries the qb-charts class
   * and charts-skin.css, so the first paint is already in the new look. The
   * old preview switch's flag is cleared so it never lingers. */
  root.classList.add('qb-charts');
  try { localStorage.removeItem('qb-charts-preview'); } catch (e) { /* storage blocked */ }

  /* The skin is for the panel itself: the sign-in, locked, offline and setup
   * pages have their own designs, so the stylesheet is only live while the
   * panel view is showing (data-state="panel"). */
  var skin = $('charts-skin');
  var skinFor = function () { if (skin) skin.disabled = root.dataset.state !== 'panel'; };
  skinFor();
  new MutationObserver(skinFor).observe(root, { attributes: true, attributeFilter: ['data-state'] });

  /* ── the shell's extra pieces (ids kept; only additions and moves) ─────── */
  function shell() {
    var nav = $('sections');
    if (!nav || $('sb-server')) return;
    var by = function (k) { return nav.querySelector('button[data-goto="' + k + '"]'); };
    var group = function (t) { var p = el('p', 'nav-group', t); p.setAttribute('aria-hidden', 'true'); return p; };
    var run = ['overview', 'composer', 'giveaways', 'leveling', 'feeds', 'automation', 'tickets', 'moderation'];
    var make = ['appearance', 'studio', 'settings', 'owner'];
    nav.appendChild(group('Run your server')); run.forEach(function (k) { var b = by(k); if (b) nav.appendChild(b); });
    nav.appendChild(group('Make it yours')); make.forEach(function (k) { var b = by(k); if (b) nav.appendChild(b); });
    var brand = document.querySelector('.sidebar-brand');
    var card = el('div', 'sb-server'); card.id = 'sb-server';
    var crest = el('span', 'sb-crest'); crest.id = 'sb-crest'; crest.setAttribute('aria-hidden', 'true');
    var text = el('span', 'sb-server-text'); var nm = el('b', null, '—'); nm.id = 'sb-server-name'; var mt = el('span'); mt.id = 'sb-server-meta';
    text.append(nm, mt); card.append(crest, text);
    if (brand) brand.after(card);
    var ident = $('bar-right'), status = document.querySelector('.sidebar-status');
    if (ident && status) status.appendChild(ident);
    var here = $('here');
    if (here) {
      var c = el('span', 'crumb-guild'); c.id = 'crumb-guild';
      var s = el('span', 'crumb-sep', '/'); s.setAttribute('aria-hidden', 'true');
      here.before(c, s);
    }
    var server = $('server');
    if (server) {
      var head = el('div', 'page-head'); head.id = 'page-head';
      var h = el('h2', 'page-title'); var main = el('span', null, here ? here.textContent : ''); main.id = 'page-title-main';
      h.appendChild(main); head.appendChild(h); server.before(head);
    }
    var autoHead = document.querySelector('.section[data-section="automation"] .auto-head');
    if (autoHead && !$('auto-week')) { var aw = el('div', 'panel auto-week'); aw.id = 'auto-week'; autoHead.after(aw); }
  }
  try { shell(); } catch (e) { /* leaves the panel as it was */ }

  /* ── mirrors ─────────────────────────────────────────────────────────── */
  function copyServer() {
    var name = $('server-name'), meta = $('server-meta'), crest = $('crest');
    var sbName = $('sb-server-name'), sbMeta = $('sb-server-meta'), sbCrest = $('sb-crest'), crumb = $('crumb-guild');
    var n = name ? name.textContent.trim() : '';
    if (sbName && n && sbName.textContent !== n) sbName.textContent = n;
    if (crumb && crumb.textContent !== n) crumb.textContent = n === '—' ? '' : n;
    if (sbMeta && meta && sbMeta.textContent !== meta.textContent) sbMeta.textContent = meta.textContent;
    if (sbCrest && crest) {
      var img = crest.querySelector('img');
      var src = img && img.getAttribute('src');
      var mine = sbCrest.querySelector('img');
      if (src) {
        if (!mine) { mine = el('img'); mine.alt = ''; mine.decoding = 'async'; sbCrest.textContent = ''; sbCrest.appendChild(mine); }
        if (mine.getAttribute('src') !== src) mine.setAttribute('src', src);
      } else {
        var letter = (n && n !== '—' ? n.charAt(0) : '').toUpperCase();
        if (mine) mine.remove();
        if (sbCrest.textContent !== letter) sbCrest.textContent = letter;
      }
    }
  }
  function copyTitle() {
    var here = $('here'), main = $('page-title-main');
    if (here && main && main.textContent !== here.textContent) main.textContent = here.textContent;
  }

  /* ── the sidebar's status, as one quiet line ─────────────────────────── */
  function statusLine() {
    var card = document.querySelector('.sidebar-status-card');
    if (!card) return;
    var line = $('sb-status-line');
    if (!line) {
      line = el('div', 'sb-status-line'); line.id = 'sb-status-line';
      line.append(el('i', 'sb-status-dot'), el('span', 'sb-status-text', 'Checking…'), el('span', 'sb-status-ms'));
      line.appendChild(el('span', 'sb-status-dots'));
      card.prepend(line);
    }
    var rows = card.querySelectorAll('.sidebar-status-row');
    // repaint only when a value changed (the line lives inside the card being watched)
    var sig = Array.prototype.map.call(rows, function (r) { var v = r.querySelector('.val'); return v ? v.className + v.textContent : ''; }).join('|');
    if (line.dataset.sig === sig) return;
    line.dataset.sig = sig;
    var on = 0, warn = 0, known = 0, ms = '';
    var dots = line.querySelector('.sb-status-dots');
    dots.textContent = '';
    rows.forEach(function (r) {
      var v = r.querySelector('.val'); if (!v) return;
      var label = (r.querySelector('span') || {}).textContent || '';
      var txt = v.textContent.trim();
      var state = v.classList.contains('is-on') ? 'on' : v.classList.contains('is-warn') ? 'warn' : (txt && txt !== '—' ? 'off' : 'wait');
      if (state !== 'wait') known++;
      if (state === 'on') on++; else if (state === 'warn') warn++;
      if (/gateway/i.test(label) && /ms/i.test(txt)) ms = txt;
      var d = el('i', 'sb-dot ' + state); d.title = label + ': ' + (txt || '—'); dots.appendChild(d);
    });
    var text = !known ? 'Checking…' : warn ? warn + ' need a look' : on === rows.length ? 'All systems running' : on + ' of ' + rows.length + ' running';
    line.querySelector('.sb-status-text').textContent = text;
    line.querySelector('.sb-status-ms').textContent = ms;
    line.className = 'sb-status-line ' + (warn ? 'warn' : known && on === rows.length ? 'good' : '');
  }

  /* ── Automation: the week at a glance, from the schedules already loaded ── */
  var DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  function weekStrip() {
    var host = $('auto-week');
    if (!host) return;
    var sched = [];
    try { sched = (window.state || state).overview.features.schedules || []; } catch (e) { sched = []; }
    var now = new Date();
    var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    var cells = DAYS.map(function () { return []; });
    sched.forEach(function (s) {
      if (s.enabled === false || !s.time) return;
      var t = new Date(Number(s.time));
      if (isNaN(t.getTime())) return;
      var hm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      var label = hm + ' ' + (s.embedName || 'post');
      var add = function (i) { cells[i].push({ label: label, sort: t.getHours() * 60 + t.getMinutes() }); };
      var idxOf = function (jsDay) { return (jsDay + 6) % 7; };
      if (s.frequency === 'everyday') DAYS.forEach(function (_, i) { add(i); });
      else if (s.frequency === 'weekdays') [0, 1, 2, 3, 4].forEach(add);
      else if (s.frequency === 'weekly') add(idxOf(s.dayOfWeek === null || s.dayOfWeek === undefined ? t.getDay() : Number(s.dayOfWeek)));
      else {
        var diff = Math.floor((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - monday) / 864e5);
        if (diff >= 0 && diff < 7) add(diff);
      }
    });
    var sig = JSON.stringify(cells) + monday.toDateString();
    if (host.dataset.sig === sig) return;
    host.dataset.sig = sig;
    var today = (now.getDay() + 6) % 7;
    var head = el('div', 'queue-head');
    head.append(el('h2', null, 'This week'), el('span', 'hint', sched.length ? 'what posts when · your time' : 'nothing scheduled yet'));
    var grid = el('div', 'aw-grid');
    cells.forEach(function (list, i) {
      var day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      var cell = el('div', 'aw-day' + (i === today ? ' today' : '') + (list.length ? '' : ' empty'));
      var top = el('div', 'aw-top');
      top.append(el('span', 'aw-name', DAYS[i]), el('span', 'aw-date', String(day.getDate())));
      cell.appendChild(top);
      list.sort(function (a, b) { return a.sort - b.sort; }).slice(0, 4).forEach(function (p) { cell.appendChild(el('span', 'aw-post', p.label)); });
      if (list.length > 4) cell.appendChild(el('span', 'aw-more', '+' + (list.length - 4) + ' more'));
      grid.appendChild(cell);
    });
    host.replaceChildren(head, grid);
  }

  /* ── section columns ─────────────────────────────────────────────────── */
  // full: above the columns · main / side: anywhere in the section (an empty
  // wrapper left behind is hidden by CSS) · left: Settings' index column.
  var LAYOUT = {
    overview:   { full: ['#ov-hero'], side: ['#overview-desk'] },
    giveaways:  { full: ['.drop-desk-head'], side: ['h2:New drop'] },
    feeds:      { side: ['#release-desk', '#whop-panel'] },
    tickets:    { full: ['#tix-hero'], main: ['.tix-queue', '.tix-post'], side: ['.tix-rules'] },
    automation: { full: ['.auto-head', '#auto-week'], main: ['#reply-panel', '#countdown-root'], side: ['#sched-panel'] },
    moderation: { full: ['#mod-deck'], side: ['#incidents-card', '#channel-locks-card'] },
    settings:   { left: ['#set-nav'] },
  };
  function find(section, key) {
    if (key.indexOf('h2:') === 0) {
      var want = key.slice(3);
      for (var i = 0; i < section.children.length; i++) {
        var h = section.children[i].querySelector(':scope > h2, :scope > .queue-head > h2');
        if (h && h.textContent.trim() === want) return section.children[i];
      }
      return null;
    }
    return section.querySelector(key);
  }
  function columns() {
    Object.keys(LAYOUT).forEach(function (name) {
      var sec = document.querySelector('.workspace-body > .section[data-section="' + name + '"]');
      if (!sec || sec.querySelector(':scope > .sec-cols')) return;
      var spec = LAYOUT[name];
      var full = (spec.full || []).map(function (k) { return find(sec, k); }).filter(Boolean);
      var side = (spec.side || spec.left || []).map(function (k) { return find(sec, k); }).filter(Boolean);
      if (!side.length) return;
      var cols = el('div', 'sec-cols' + (spec.left ? ' sec-cols-left' : ''));
      var main = el('div', 'sec-main');
      var aside = el('div', 'sec-side');
      var kids = Array.prototype.slice.call(sec.children);
      var rest = kids.filter(function (k) { return full.indexOf(k) === -1; });
      if (!rest.length) return;
      var lastFull = full.length ? full[full.length - 1] : null;
      // full blocks first, in their listed order, then the columns
      full.forEach(function (f) { sec.insertBefore(f, rest[0]); });
      sec.insertBefore(cols, lastFull ? lastFull.nextSibling : rest[0]);
      if (spec.main) {
        spec.main.map(function (k) { return find(sec, k); }).filter(Boolean).forEach(function (m) { main.appendChild(m); });
        side.forEach(function (s) { aside.appendChild(s); });
        rest.forEach(function (k) { if (k.isConnected && k.parentNode === sec && k !== cols) main.appendChild(k); });
      } else {
        rest.forEach(function (k) { (side.indexOf(k) !== -1 ? aside : main).appendChild(k); });
      }
      if (spec.left) { cols.appendChild(aside); cols.appendChild(main); } else { cols.appendChild(main); cols.appendChild(aside); }
      sec.classList.add('has-cols');
    });
  }

  function sync() {
    try { copyServer(); } catch (e) {}
    try { copyTitle(); } catch (e) {}
    try { statusLine(); } catch (e) {}
    try { weekStrip(); } catch (e) {}
  }

  try { columns(); } catch (e) { /* the sections keep their single column */ }

  var queued = false;
  var obs = new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; sync(); });
  });
  function watch() {
    ['server-name', 'server-meta', 'crest', 'here', 'sched-list'].forEach(function (id) {
      var n = $(id);
      if (n) obs.observe(n, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    });
    var st = document.querySelector('.sidebar-status-card');
    if (st) obs.observe(st, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    obs.observe(root, { attributes: true, attributeFilter: ['data-section'] });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
