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
    // the section's jump tabs live at the right of the top bar (the breadcrumb already names the page)
    var right = document.querySelector('.content-toolbar .toolbar-right');
    if (right && !$('tb-tabs')) {
      var tabs = el('nav', 'tb-tabs'); tabs.id = 'tb-tabs'; tabs.setAttribute('aria-label', 'Jump to');
      tabs.appendChild(el('span', 'tb-ind')).setAttribute('aria-hidden', 'true');
      right.prepend(tabs);
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
      sec.insertBefore(cols, sec.firstChild);
      if (spec.main) {
        spec.main.map(function (k) { return find(sec, k); }).filter(Boolean).forEach(function (m) { main.appendChild(m); });
        side.forEach(function (s) { aside.appendChild(s); });
        rest.forEach(function (k) { if (k.isConnected && k.parentNode === sec && k !== cols) main.appendChild(k); });
      } else {
        rest.forEach(function (k) { (side.indexOf(k) !== -1 ? aside : main).appendChild(k); });
      }
      // the "full" blocks head the main column, in their listed order, so the
      // side rail runs the whole height from the top bar down
      full.slice().reverse().forEach(function (f) { main.insertBefore(f, main.firstChild); });
      if (spec.left) { cols.appendChild(aside); cols.appendChild(main); } else { cols.appendChild(main); cols.appendChild(aside); }
      sec.classList.add('has-cols');
    });
  }

  /* ── motion: the charts app's vocabulary ─────────────────────────────── */
  var EASE = 'cubic-bezier(.32,.72,0,1)', ENTER = 'cubic-bezier(.22,1,.36,1)';
  var reduced = function () { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  var play = function (node, frames, opts) { if (node && node.animate && !reduced()) { try { return node.animate(frames, opts); } catch (e) {} } return null; };

  /* ── jump tabs in the top bar: one per block of the open section ───────
   * [label, where]: a selector, or "h:Heading" for the block whose own
   * heading starts with that text. Blocks that are not on the page right
   * now simply get no tab. The highlight glides to the block in view. */
  var TABS = {
    giveaways:  [['Live', 'h:Live drops'], ['Recent', 'h:Recent drops'], ['New drop', 'h:New drop']],
    feeds:      [['News', '#newsfeed-panel'], ['Calendar', 'h:Economic calendar'], ['Releases', '#release-desk'], ['Whop', '#whop-panel']],
    automation: [['Week', '#auto-week'], ['Replies', '#reply-panel'], ['Countdowns', '#countdown-root'], ['Schedules', '#sched-panel']],
    tickets:    [['Queue', '.tix-queue'], ['Panel', '.tix-post'], ['Rules', '.tix-rules']],
    moderation: [['Entry check', '#entry-verify-card'], ['Reports', '#report-card'], ['Actions', '#quick-card'], ['Cases', '#case-log-card'], ['Locks', '#channel-locks-card']],
    leveling:   [['Board', '.lvl-lb-panel'], ['Curve', 'h:XP curve'], ['Rules', '.lvl-rules'], ['Ranks', '.lvl-ladder-card'], ['Feed', '.lvl-feed-card']],
    owner:      [['Console', '#owner-vitals'], ['Tools', '.owner-tools'], ['Global', '.owner-global'], ['Servers', '#owner-guilds']],
  };
  var curSection = function () { return document.querySelector('.workspace-body > .section[data-section="' + (root.dataset.section || '') + '"]'); };
  function target(sec, where) {
    if (where.indexOf('h:') !== 0) return sec.querySelector(where);
    var want = where.slice(2).toLowerCase();
    var hs = sec.querySelectorAll('h2, h3');
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim().toLowerCase().indexOf(want) !== 0) continue;
      var box = hs[i].closest('article, .panel');
      // a heading inside one big panel (Owner) jumps to its own part, not the whole panel
      if (!box || box.parentElement === sec) return hs[i].parentElement;
      return box;
    }
    return null;
  }
  var tabsSig = '';
  function tabsFor() {
    var nav = $('tb-tabs');
    if (!nav) return;
    var sec = curSection(), name = root.dataset.section || '';
    var list = (TABS[name] || []).filter(function (t) { var n = sec && target(sec, t[1]); return n && n.offsetParent !== null; });
    var sig = name + '|' + list.map(function (t) { return t[0]; }).join(',');
    if (sig === tabsSig) return;
    tabsSig = sig;
    nav.querySelectorAll('.tb-tab').forEach(function (b) { b.remove(); });
    list.forEach(function (t) {
      var b = el('button', 'tb-tab', t[0]); b.type = 'button'; b.dataset.where = t[1];
      b.addEventListener('click', function () { jump(b); });
      nav.appendChild(b);
    });
    nav.hidden = list.length < 2;
    spyNow(true);
  }
  function moveInd(btn, instant) {
    var nav = $('tb-tabs'), ind = nav && nav.querySelector('.tb-ind');
    if (!ind) return;
    nav.querySelectorAll('.tb-tab').forEach(function (b) { b.classList.toggle('on', b === btn); });
    if (!btn) { ind.style.opacity = '0'; return; }
    ind.style.transition = instant || reduced() ? 'none' : 'transform .34s ' + EASE + ', width .34s ' + EASE + ', opacity .2s';
    ind.style.width = btn.offsetWidth + 'px';
    ind.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
    ind.style.opacity = '1';
  }
  var jumping = 0;
  function jump(btn) {
    var sec = curSection(), node = sec && target(sec, btn.dataset.where), body = document.querySelector('.workspace-body');
    if (!node || !body) return;
    moveInd(btn);
    var inRail = !!node.closest('.sec-side') && getComputedStyle(node.closest('.sec-cols')).display === 'grid';
    if (inRail) {
      // the rail is already beside the page: bring it into view and light it up
      var r = node.getBoundingClientRect();
      if (r.top < 70 || r.bottom > innerHeight) node.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'nearest' });
    } else {
      jumping = Date.now() + 700;
      var tb = document.querySelector('.content-toolbar');
      var top = node.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - (tb ? tb.offsetHeight : 0) - 16;
      body.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
    }
    play(node, [{ boxShadow: 'inset 0 0 0 1px rgba(47,107,255,.55)' }, { boxShadow: 'inset 0 0 0 1px rgba(47,107,255,0)' }], { duration: 900, easing: ENTER });
  }
  function spyNow(instant) {
    var nav = $('tb-tabs'), sec = curSection(), body = document.querySelector('.workspace-body');
    if (!nav || nav.hidden || !sec || !body) return;
    if (!instant && Date.now() < jumping) return;
    var tabs = nav.querySelectorAll('.tb-tab'), tb = document.querySelector('.content-toolbar');
    var line = (tb ? tb.getBoundingClientRect().bottom : 0) + 40, pick = null, first = null;
    tabs.forEach(function (b) {
      var node = target(sec, b.dataset.where);
      if (!node || node.closest('.sec-side') && getComputedStyle(node.closest('.sec-cols')).display === 'grid') return;
      if (!first) first = b;
      if (node.getBoundingClientRect().top <= line) pick = b;
    });
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
      var mains = Array.prototype.filter.call(tabs, function (b) { var n = target(sec, b.dataset.where); return n && !(n.closest('.sec-side') && getComputedStyle(n.closest('.sec-cols')).display === 'grid'); });
      if (mains.length) pick = mains[mains.length - 1];
    }
    moveInd(pick || first, instant);
  }
  var spyQueued = false;
  function bindSpy() {
    var body = document.querySelector('.workspace-body');
    if (!body || body.dataset.spy) return;
    body.dataset.spy = '1';
    body.addEventListener('scroll', function () {
      if (spyQueued) return; spyQueued = true;
      requestAnimationFrame(function () { spyQueued = false; spyNow(false); });
    }, { passive: true });
    addEventListener('resize', function () { spyNow(true); });
  }

  /* ── a section arriving opens at its top (the cards' own entrance is the
   *    panel's sec-enter), and its jump tabs are drawn afresh ──────────── */
  var lastSection = root.dataset.section;
  function arrive() {
    var name = root.dataset.section;
    if (name === lastSection) return;
    lastSection = name;
    var body = document.querySelector('.workspace-body');
    if (body) body.scrollTop = 0;
    settle();
  }
  // some sections draw their blocks a moment after they open (Leveling, Owner): look again shortly
  var settleTimers = [];
  function settle() {
    settleTimers.forEach(clearTimeout);
    settleTimers = [250, 1000, 2500].map(function (ms) { return setTimeout(function () { try { tabsFor(); spyNow(true); } catch (e) {} }, ms); });
  }

  /* ── dropdowns that morph, like the charts app's MorphSelect ──────────
   * The panel's own menus (app.full.js) are untouched in what they do: the
   * same options, the same change events. This only adds motion. On open
   * the trigger grows into the list (a lid that repeats the trigger sits on
   * top), a highlight glides between options, and on a pick or a close the
   * surface folds back into the trigger. */
  var CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  function triggerOf(menu) {
    var sel = document.querySelector('select[data-cselect-id="' + menu.dataset.forSelect + '"]');
    var wrap = sel && sel.closest('.cselect');
    return wrap ? { wrap: wrap, btn: wrap.querySelector('.cselect-trigger') } : null;
  }
  function shapeOf(menuRect, r, down, rad) {
    var top = down ? 0 : Math.max(0, menuRect.height - r.height), bottom = down ? Math.max(0, menuRect.height - r.height) : 0;
    var left = Math.max(0, r.left - menuRect.left), right = Math.max(0, menuRect.right - r.right);
    return 'inset(' + top + 'px ' + right + 'px ' + bottom + 'px ' + left + 'px round ' + rad + 'px)';
  }
  function morphOpen(menu) {
    var t = triggerOf(menu);
    if (!t || !t.btn || menu.querySelector(':scope > .cs-lid')) return;
    var r = t.btn.getBoundingClientRect();
    var down = menu.style.top && menu.style.top !== 'auto';
    var lid = el('div', 'cs-lid');
    lid.style.height = r.height + 'px';
    var v = t.btn.querySelector('.cselect-value');
    lid.appendChild(el('span', 'cs-lid-text', v ? v.textContent : ''));
    var chev = el('span', 'cs-lid-chev'); chev.innerHTML = CHEV; lid.appendChild(chev);
    lid.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (typeof t.wrap._cselectSoftClose === 'function') t.wrap._cselectSoftClose(); });
    var hl = el('span', 'cs-hl'); hl.setAttribute('aria-hidden', 'true');
    menu.classList.add('cs-morph');
    menu.classList.toggle('cs-up', !down);
    if (down) { menu.prepend(lid); menu.style.top = r.top + 'px'; }
    else { menu.appendChild(lid); menu.style.bottom = (innerHeight - r.bottom) + 'px'; }
    menu.style.maxHeight = (parseFloat(menu.style.maxHeight) || 280) + r.height + 'px';
    menu.appendChild(hl);
    glide(menu, menu.querySelector('.cselect-option.is-selected'), true);
    var m = menu.getBoundingClientRect();
    menu._shape = { m: m, down: down };
    play(menu, [{ clipPath: shapeOf(m, r, down, 12) }, { clipPath: 'inset(0px 0px 0px 0px round 16px)' }], { duration: 400, easing: EASE });
    var items = menu.querySelectorAll('.cselect-search, .cselect-list, .cselect-option, .cselect-group, .cselect-empty');
    var parts = Array.prototype.filter.call(items, function (n) { return !n.parentElement.closest('.cselect-list') || n.classList.contains('cselect-list'); });
    parts.forEach(function (n) { play(n, [{ opacity: 0, transform: 'translateY(' + (down ? -6 : 6) + 'px)', filter: 'blur(2px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 240, delay: 40, easing: ENTER, fill: 'backwards' }); });
    play(chev, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(180deg)' }], { duration: 280, easing: EASE, fill: 'forwards' });
  }
  function glide(menu, opt, instant) {
    var hl = menu.querySelector(':scope > .cs-hl');
    if (!hl) return;
    if (!opt || opt.disabled) { hl.style.opacity = '0'; return; }
    hl.style.transition = instant || reduced() ? 'none' : 'transform .28s ' + EASE + ', height .28s ' + EASE + ', opacity .12s';
    hl.style.height = opt.offsetHeight + 'px';
    hl.style.width = opt.offsetWidth + 'px';
    hl.style.transform = 'translate(' + opt.offsetLeft + 'px,' + opt.offsetTop + 'px)';
    hl.style.opacity = '1';
  }
  function fold(menu, picked) {
    var t = triggerOf(menu), s = menu._shape;
    menu._shape = null;
    if (!t || !t.btn || !s || reduced()) return;
    var r = t.btn.getBoundingClientRect();
    if (!picked) {
      // a close: the live menu folds itself back over its 160ms leave
      play(menu, [{ clipPath: 'inset(0px 0px 0px 0px round 16px)', opacity: 1 }, { clipPath: shapeOf(s.m, r, s.down, 12), opacity: .4 }], { duration: 160, easing: EASE, fill: 'forwards' });
      return;
    }
    // a pick empties the menu at once, so a quiet copy of the surface folds back into the trigger
    var ghost = el('div', 'cs-ghost');
    ghost.style.cssText = 'left:' + s.m.left + 'px;top:' + s.m.top + 'px;width:' + s.m.width + 'px;height:' + s.m.height + 'px';
    var lid = el('div', 'cs-lid'); lid.style.height = r.height + 'px';
    var v = t.btn.querySelector('.cselect-value');
    lid.appendChild(el('span', 'cs-lid-text', v ? v.textContent : ''));
    ghost.classList.toggle('cs-up', !s.down);
    ghost.appendChild(lid);
    document.body.appendChild(ghost);
    var a = play(ghost, [{ clipPath: 'inset(0px 0px 0px 0px round 16px)', opacity: 1 }, { clipPath: shapeOf(s.m, r, s.down, 12), opacity: 1, offset: .85 }, { clipPath: shapeOf(s.m, r, s.down, 12), opacity: 0 }], { duration: 300, easing: EASE, fill: 'forwards' });
    if (a) a.onfinish = function () { ghost.remove(); }; else ghost.remove();
    if (v) play(v, [{ opacity: 0, transform: 'translateY(.4em)', filter: 'blur(2px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 260, delay: 60, easing: ENTER, fill: 'backwards' });
  }
  function watchMenu(menu) {
    if (menu._csWatch) return;
    menu._csWatch = true;
    var state = 'closed';
    new MutationObserver(function () {
      var open = !menu.hidden && menu.classList.contains('is-open');
      var leaving = menu.classList.contains('is-leaving');
      if (open && state !== 'open') { state = 'open'; try { morphOpen(menu); } catch (e) {} }
      else if (leaving && state === 'open') { state = 'leaving'; try { fold(menu, false); } catch (e) {} }
      else if (menu.hidden && state !== 'closed') { var was = state; state = 'closed'; menu.classList.remove('cs-morph', 'cs-up'); try { if (was === 'open') fold(menu, true); } catch (e) {} }
    }).observe(menu, { attributes: true, attributeFilter: ['hidden', 'class'] });
    menu.addEventListener('pointermove', function (e) {
      var o = e.target.closest && e.target.closest('.cselect-option');
      if (o && o !== menu._csHover) { menu._csHover = o; glide(menu, o, false); }
    });
    menu.addEventListener('pointerleave', function () { menu._csHover = null; glide(menu, menu.querySelector('.cselect-option.is-selected'), false); });
  }
  function bindMenus() {
    if (!document.body) return;
    document.querySelectorAll('body > .cselect-menu').forEach(watchMenu);
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1 && n.classList.contains('cselect-menu')) watchMenu(n); }); });
    }).observe(document.body, { childList: true });
  }

  function sync() {
    try { copyServer(); } catch (e) {}
    try { statusLine(); } catch (e) {}
    try { weekStrip(); } catch (e) {}
    try { arrive(); } catch (e) {}
    try { tabsFor(); } catch (e) {}
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
    try { bindSpy(); } catch (e) {}
    try { bindMenus(); } catch (e) {}
    sync();
    settle();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
