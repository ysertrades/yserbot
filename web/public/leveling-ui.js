'use strict';
/** Quantlab HQ Leveling — overview, curve, roles, unlocks, XP + journal */
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function data() {
    try { return state?.overview?.features?.levels || null; } catch { return null; }
  }
  async function writeLeveling(body) {
    const guildId = state?.guildId;
    if (!guildId) throw Object.assign(new Error('no_guild'), { data: { error: 'no_guild' } });
    const headers = { 'content-type': 'application/json', 'x-csrf-token': state?.csrf || '' };
    try { if (typeof authHeaders === 'function') Object.assign(headers, authHeaders()); } catch {}
    let res;
    try {
      res = await fetch('/api/guild/' + guildId + '/leveling', {
        method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body || {}),
      });
    } catch (net) {
      throw Object.assign(new Error('network'), { data: { error: 'network', detail: String(net.message || net) } });
    }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(out.detail || out.error || ('http_' + res.status)), { data: out });
    if (out.overview) state.overview = out.overview;
    if (out.levels) {
      if (!state.overview) state.overview = {};
      if (!state.overview.features) state.overview.features = {};
      state.overview.features.levels = out.levels;
    }
    return out;
  }
  function applyResult(res) {
    if (res?.overview) state.overview = res.overview;
    if (res?.levels) {
      if (!state.overview) state.overview = {};
      if (!state.overview.features) state.overview.features = {};
      state.overview.features.levels = res.levels;
    }
  }
  function field(label, control, hint) {
    const f = el('div', 'field lvl-field');
    f.append(el('span', null, label));
    f.append(control);
    if (hint) f.append(el('p', 'hint', hint));
    return f;
  }
  function num(value, opts) {
    opts = opts || {};
    const i = document.createElement('input');
    i.type = 'number';
    i.className = 'lvl-input';
    if (opts.min != null) i.min = String(opts.min);
    if (opts.max != null) i.max = String(opts.max);
    if (opts.step != null) i.step = String(opts.step);
    i.value = value == null || Number.isNaN(Number(value)) ? (opts.min != null ? opts.min : 0) : Number(value);
    return i;
  }
  function selectOne(options, value, blank) {
    const s = document.createElement('select');
    s.className = 'lvl-input';
    if (blank != null) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = blank;
      s.append(o);
    }
    const list = options || [];
    const hasCat = list.some(function (opt) { return opt && opt.category; });
    if (hasCat) {
      const order = [];
      const map = {};
      list.forEach(function (opt) {
        const g = (opt && opt.category) ? String(opt.category) : 'No category';
        if (!map[g]) { map[g] = []; order.push(g); }
        map[g].push(opt);
      });
      order.forEach(function (g) {
        const og = document.createElement('optgroup');
        og.label = g;
        map[g].forEach(function (opt) {
          const o = document.createElement('option');
          o.value = opt.id || opt.value;
          o.textContent = opt.name || opt.label || o.value;
          if (String(o.value) === String(value || '')) o.selected = true;
          og.appendChild(o);
        });
        s.appendChild(og);
      });
    } else {
      list.forEach(function (opt) {
        const o = document.createElement('option');
        o.value = opt.id || opt.value;
        o.textContent = opt.name || opt.label || o.value;
        if (String(o.value) === String(value || '')) o.selected = true;
        s.append(o);
      });
    }
    return s;
  }
  function multi(options, selectedIds) {
    const s = document.createElement('select');
    s.className = 'lvl-input';
    s.multiple = true;
    s.size = Math.min(5, Math.max(3, (options || []).length || 3));
    const chosen = new Set(selectedIds || []);
    for (const opt of options || []) {
      const o = document.createElement('option');
      o.value = opt.id || opt.value;
      o.textContent = opt.name || opt.label || o.value;
      if (chosen.has(o.value)) o.selected = true;
      s.append(o);
    }
    return s;
  }
  function toggle(label, checked) {
    const row = el('div', 'toggle');
    row.append(el('span', 'toggle-text', label));
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    row.append(input);
    const wrap = el('div', 'lvl-toggle-block');
    wrap.append(row);
    wrap._input = input;
    return wrap;
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  /** 90 → "90s", 3600 → "1h", 21600 → "6h", 0 → "every message". */
  function secWord(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    if (!s) return 'every message';
    if (s % 86400 === 0) return (s / 86400) + 'd';
    if (s % 3600 === 0) return (s / 3600) + 'h';
    if (s % 60 === 0) return (s / 60) + 'm';
    return s + 's';
  }
  /**
   * Preset chips over a number, with a Custom box for anything else. The
   * usual answers are one tap; the field is still there for the rest.
   * @returns {HTMLElement & { _value: () => number }}
   */
  function presetChips(presets, value, opts) {
    opts = opts || {};
    const wrap = el('div', 'lvl-presets');
    const row = el('div', 'chipset lvl-preset-row');
    const custom = num(value, { min: opts.min, max: opts.max, step: opts.step });
    custom.classList.add('lvl-preset-custom');
    custom.setAttribute('aria-label', opts.label || 'Custom value');
    let cur = Number(value);
    function paint() {
      const isPreset = presets.some(function (p) { return Number(p[0]) === cur; });
      row.querySelectorAll('[data-v]').forEach(function (b) {
        const v = b.dataset.v === 'custom' ? null : Number(b.dataset.v);
        b.setAttribute('aria-pressed', String(v === null ? !isPreset : v === cur));
      });
      custom.hidden = isPreset;
      if (opts.onChange) opts.onChange(cur);
    }
    presets.forEach(function (p) {
      const b = el('button', 'chip-toggle', p[1]);
      b.type = 'button';
      b.dataset.v = String(p[0]);
      b.addEventListener('click', function () { cur = Number(p[0]); custom.value = String(cur); paint(); });
      row.append(b);
    });
    const other = el('button', 'chip-toggle', 'Custom');
    other.type = 'button';
    other.dataset.v = 'custom';
    other.addEventListener('click', function () {
      custom.hidden = false;
      row.querySelectorAll('[data-v]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === other)); });
      custom.focus();
    });
    row.append(other, custom);
    custom.addEventListener('input', function () { cur = Number(custom.value) || 0; if (opts.onChange) opts.onChange(cur); });
    wrap.append(row);
    paint();
    wrap._value = function () { return cur; };
    return wrap;
  }
  /** Card heading: an icon tile, the title and one line on what it is for. */
  function cardHead(card, icon, title, sub, extra) {
    const h = el('div', 'lvl-card-head');
    h.append(el('span', 'lvl-card-ic', icon));
    const t = el('div', 'lvl-card-t');
    t.append(el('h2', null, title));
    if (sub) t.append(el('p', 'hint', sub));
    h.append(t);
    if (extra) h.append(extra);
    card.append(h);
    return h;
  }
  function selectedValues(sel) {
    return Array.from(sel && sel.selectedOptions ? sel.selectedOptions : []).map(function (o) { return o.value; }).filter(Boolean);
  }
  function makeSaveBtn(label, buildBody) {
    const btn = el('button', 'btn primary small', label || 'Save');
    btn.type = 'button';
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      const prev = btn.textContent;
      try {
        const res = await writeLeveling(buildBody());
        try { applyResult(res); render(); } catch (pe) { console.warn('[leveling] paint', pe); }
        if (typeof toast === 'function') toast('Saved.', 'good');
        btn.textContent = 'Saved';
        setTimeout(function () { btn.textContent = prev; }, 1200);
      } catch (e) {
        console.error('[leveling save]', e);
        if (typeof toast === 'function') toast('Could not save — ' + ((e.data && (e.data.detail || e.data.error)) || e.message || 'failed'), 'bad');
      } finally { btn.disabled = false; }
    });
    return btn;
  }
  function stepXp(n, mode, base, mult) {
    const x = Math.max(0, Math.floor(Number(n) || 0));
    if (mode === 'exponential') {
      const b = Math.max(10, Number(base) || 100);
      const m = Math.max(1, Number(mult) || 1);
      if (m === 1) return Math.round(b);
      return Math.max(1, Math.round(b * Math.pow(m, x)));
    }
    return 5 * x * x + 50 * x + 100;
  }
  function totalFor(Lv, mode, base, mult) {
    var s = 0;
    for (var n = 0; n < Lv; n++) s += stepXp(n, mode, base, mult);
    return s;
  }
  // `target` lets the live refresh build into a detached node and lift out
  // only the parts that changed (see paintLiveParts).
  function render(target) {
    const root = target instanceof Element ? target : document.getElementById('leveling-root');
    if (!root) return;
    const L = data();
    root.replaceChildren();
    if (!L) {
      root.append(el('p', 'muted', 'Leveling data unavailable. Enable Leveling & Ranks in Settings.'));
      return;
    }
    const mode = L.curveMode === 'exponential' ? 'exponential' : 'quadratic';

    /* ── Engine header: on/off where it belongs, and the earning recipe in one
       line so the rules are readable without opening a single field. ── */
    const hero = el('div', 'panel lvl-hero2');
    const top = el('div', 'lvl-engine-top');
    var brandName = 'QuantLab';
    try { brandName = (window.state && window.state.overview && window.state.overview.brand && window.state.overview.brand.name) || brandName; } catch (e) {}
    const titleBox = el('div', 'lvl-h2-title');
    titleBox.append(el('span', 'lvl-kicker', 'Rank engine'), el('h2', null, brandName + ' ranks'));
    top.append(titleBox);
    const engine = el('button', 'lvl-engine' + (L.enabled ? ' on' : ''));
    engine.type = 'button';
    engine.setAttribute('role', 'switch');
    engine.setAttribute('aria-checked', String(!!L.enabled));
    engine.append(el('span', 'lvl-engine-track', ''), el('span', 'lvl-engine-word', L.enabled ? 'Earning' : 'Paused'));
    engine.firstChild.append(el('i'));
    engine.title = L.enabled ? 'XP is being earned — tap to pause' : 'XP is paused — tap to turn it on';
    engine.addEventListener('click', async function () {
      const next = !engine.classList.contains('on');
      engine.disabled = true;
      engine.classList.toggle('on', next);
      engine.setAttribute('aria-checked', String(next));
      engine.lastChild.textContent = next ? 'Earning' : 'Paused';
      try {
        const res = await writeLeveling({ enabled: next });
        applyResult(res);
        if (typeof toast === 'function') toast(next ? 'Leveling is on — members earn XP again.' : 'Leveling paused — nobody earns XP until you turn it back on.', 'good');
        render();
      } catch (e) {
        engine.classList.toggle('on', !next);
        engine.setAttribute('aria-checked', String(!next));
        engine.lastChild.textContent = !next ? 'Earning' : 'Paused';
        if (typeof toast === 'function') toast('Could not change it — ' + ((e.data && (e.data.detail || e.data.error)) || e.message), 'bad');
      } finally { engine.disabled = false; }
    });
    top.append(engine);
    hero.append(top);
    const recipe = el('div', 'lvl-recipe');
    function ing(icon, text) { const s = el('span', 'lvl-ing'); s.append(el('b', null, icon), document.createTextNode(text)); return s; }
    recipe.append(
      ing('✦', (L.xpMin || 15) + '–' + (L.xpMax || 25) + ' XP a message'),
      ing('⏱', 'once every ' + secWord(L.cooldownSec != null ? L.cooldownSec : 60)),
      ing('☀', (Number(L.weekendBoost) || 1) > 1 ? 'weekends ×' + Number(L.weekendBoost) : 'no weekend boost'),
      ing('♛', (L.roleRewards || []).length + ' rank role' + ((L.roleRewards || []).length === 1 ? '' : 's'))
    );
    hero.append(recipe);
    if (!L.tracked) {
      const empty = el('div', 'lvl-empty');
      empty.append(el('p', null, 'No XP tracked yet'));
      empty.append(el('p', 'hint', 'Leaderboard stays empty until members earn XP after this reset.'));
      hero.append(empty);
    } else {
      const stats = el('div', 'lvl-stat-row');
      function chip(v, lab) {
        const c = el('div', 'lvl-chip');
        c.append(el('strong', null, v));
        c.append(el('span', null, lab));
        return c;
      }
      stats.append(chip(fmt(L.userCount), 'Ranked'));
      stats.append(chip(fmt(L.totalEvents), 'Grants'));
      stats.append(chip((L.xpMin || 15) + '-' + (L.xpMax || 25), 'XP / msg'));
      stats.append(chip((L.cooldownSec || 60) + 's', 'Cooldown'));
      hero.append(stats);
    }
    root.append(hero);

    const split = el('div', 'grid lvl-split');

    const board = el('div', 'panel lvl-lb-panel');
    board.append(el('h2', null, 'Leaderboard'));
    if (L.tracked && (L.leaderboard || []).length) {
      const rows = (L.leaderboard || []).slice(0, 10);
      function progressPct(u) {
        const need = Math.max(1, Number(u.need) || 1);
        const into = Math.max(0, Number(u.into) || 0);
        return Math.max(0, Math.min(100, Math.round((into / need) * 100)));
      }
      const top3 = rows.slice(0, 3);
      const rest = rows.slice(3, 10);

      const podium = el('div', 'lvl-podium');
      const order = [1, 0, 2];
      const tierCls = ['gold', 'silver', 'bronze'];
      order.forEach(function (idx) {
        const u = top3[idx];
        if (!u) return;
        const rank = idx + 1;
        const card = el('div', 'lvl-podium-card ' + tierCls[idx] + (rank === 1 ? ' first' : ''));
        card.append(el('span', 'lvl-podium-rank', String(rank)));
        const av = el('div', 'lvl-podium-av');
        if (u.avatarUrl) {
          const img = document.createElement('img');
          img.src = u.avatarUrl;
          img.alt = '';
          img.decoding = 'async';
          img.referrerPolicy = 'no-referrer';
          av.appendChild(img);
        } else {
          av.textContent = String(u.name || '?').slice(0, 2).toUpperCase();
        }
        card.append(av);
        const nm = el('div', 'lvl-podium-name', u.name || u.id);
        if (u.name && u.name !== u.id) nm.title = u.id;
        card.append(nm);
        card.append(el('div', 'lvl-podium-xp', fmt(u.xp)));
        card.append(el('div', 'lvl-podium-xp-label', 'XP'));
        card.append(el('div', 'lvl-podium-lv', 'Lv ' + u.level));
        const bar = el('div', 'lvl-podium-bar');
        const fill = el('div', 'lvl-podium-bar-fill');
        fill.style.width = Math.max(4, progressPct(u)) + '%';
        fill.title = progressPct(u) + '% to next level';
        bar.append(fill);
        card.append(bar);
        podium.append(card);
      });
      board.append(podium);

      if (rest.length) {
        const list = el('div', 'lvl-board-rest');
        rest.forEach(function (u, i) {
          const row = el('div', 'lvl-board-row');
          row.append(el('span', 'lvl-board-pos', String(i + 4)));
          const mid = el('div', 'lvl-board-mid');
          const nm = el('div', 'lvl-board-name', u.name || u.id);
          if (u.name && u.name !== u.id) nm.title = u.id;
          mid.append(nm);
          mid.append(el('div', 'lvl-board-sub', 'Lv ' + u.level));
          row.append(mid);
          const right = el('div', 'lvl-board-right');
          const bar = el('div', 'lvl-board-bar');
          const fill = el('div', 'lvl-board-bar-fill');
          fill.style.width = Math.max(4, progressPct(u)) + '%';
        fill.title = progressPct(u) + '% to next level';
          bar.append(fill);
          right.append(bar);
          right.append(el('span', 'lvl-board-xp', fmt(u.xp)));
          row.append(right);
          list.append(row);
        });
        board.append(list);
      }
    } else {
      board.append(el('p', 'hint', 'No ranked members yet.'));
    }
    split.append(board);

    const curve = el('div', 'panel');
    curve.append(el('h2', null, 'XP curve'));
    const curveGrid = el('div', 'lvl-nums');
    const iBase = num(L.curveBase != null ? L.curveBase : 100, { min: 10, max: 50000, step: 10 });
    const iMult = num(L.curveMult != null ? L.curveMult : 1.5, { min: 1, max: 3, step: 0.01 });
    curveGrid.append(field('Base XP', iBase, 'Cost of level 0→1 when exponential is active'));
    curveGrid.append(field('Level multiplier', iMult, 'Each next step × this (1 = flat)'));
    curve.append(curveGrid);
    // A bar per level up to 30 — how much each step costs — so the shape of
    // the curve is visible while you tune it, plus the three numbers people
    // actually ask about.
    const chart = el('div', 'lvl-curve-chart');
    const preview = el('div', 'lvl-curve-table');
    // How many messages a level takes, at the average XP per message.
    const avgXp = ((Number(L.xpMin) || 15) + (Number(L.xpMax) || 25)) / 2;
    function paintPreview() {
      const b = Number(iBase.value) || 100;
      const m = Number(iMult.value) || 1;
      const steps = [];
      for (let lv = 1; lv <= 30; lv++) steps.push(stepXp(lv - 1, 'exponential', b, m));
      const max = Math.max.apply(null, steps) || 1;
      chart.replaceChildren.apply(chart, steps.map(function (s, i) {
        const bar = el('span', 'lvl-curve-bar' + ((i + 1) % 10 === 0 ? ' mark' : ''));
        bar.style.height = Math.max(3, Math.round((s / max) * 100)) + '%';
        bar.title = 'Level ' + (i + 1) + ': ' + fmt(s) + ' XP (~' + fmt(Math.ceil(s / avgXp)) + ' messages)';
        return bar;
      }));
      preview.replaceChildren();
      [5, 15, 30].forEach(function (lv) {
        const r = el('div', 'row');
        const total = totalFor(lv, 'exponential', b, m);
        r.append(el('span', 'k', 'Level ' + lv));
        r.append(el('span', 'v', fmt(total) + ' XP · ~' + fmt(Math.ceil(total / avgXp)) + ' messages'));
        preview.append(r);
      });
    }
    curve.append(chart);
    paintPreview();
    iBase.addEventListener('input', paintPreview);
    iMult.addEventListener('input', paintPreview);
    curve.append(preview);
    const curveActions = el('div', 'actions');
    curveActions.append(makeSaveBtn('Save curve', function () {
      return { curveMode: 'exponential', curveBase: Number(iBase.value) || 100, curveMult: Number(iMult.value) || 1.5 };
    }));
    curve.append(curveActions);
    split.append(curve);
    root.append(split);








    // ═══ Daily Leaderboard Automation ═══
    // Built here, placed further down with the other automations.
    let autoCard = null;
    (function () {
      const dl = (L && L.dailyLeaderboard) || {};
      const card = el('div', 'panel lvl-card lvl-auto-card');
      const onWrap = toggle('Automation', !!dl.enabled);
      const onChk = onWrap._input;
      cardHead(card, '🏆', 'Daily leaderboard post', 'Today\'s top earners, posted once a day on Eastern Time (America/New_York).', onWrap);

      function fromHour24(h, m) {
        h = ((Number(h) || 0) % 24 + 24) % 24;
        m = Math.max(0, Math.min(59, Number(m) || 0));
        var ampm = h >= 12 ? 'PM' : 'AM';
        var h12 = h % 12; if (h12 === 0) h12 = 12;
        return { h12: h12, minute: m, ampm: ampm };
      }
      function toHour24(h12, minute, ampm) {
        h12 = Math.max(1, Math.min(12, parseInt(h12, 10) || 12));
        minute = Math.max(0, Math.min(59, parseInt(minute, 10) || 0));
        var h = h12 % 12;
        if (String(ampm).toUpperCase() === 'PM') h += 12;
        return { hour: h, minute: minute };
      }

      var init = fromHour24(dl.hour != null ? dl.hour : 20, dl.minute != null ? dl.minute : 0);
      const st = {
        enabled: !!dl.enabled, h12: init.h12, minute: init.minute, ampm: init.ampm,
        channelId: dl.channelId || '', roleId: dl.roleId || '', limit: dl.limit || 10,
        title: dl.title || 'Daily XP Leaderboard',
        description: dl.description || "Today's top contributors", footer: dl.footer || '',
      };

      const nextP = el('p', 'lvl-auto-next');
      function paintNext() {
        if (!st.enabled) {
          nextP.replaceChildren(el('span', 'pill off', 'Off'), document.createTextNode(' Turn it on and save to schedule the next post.'));
          return;
        }
        var label = st.h12 + ':' + String(st.minute).padStart(2, '0') + ' ' + st.ampm + ' ET';
        const strong = el('strong', null, label);
        nextP.replaceChildren(el('span', 'pill live', 'Scheduled'), document.createTextNode(' Posts every day at '), strong);
      }
      onChk.addEventListener('change', function () { st.enabled = onChk.checked; paintNext(); });
      paintNext();
      card.append(nextP);

      card.append(el('h3', null, 'Post time (Eastern)'));
      const timeRow = el('div', 'lvl-time-row');
      var hourOpts = [], minOpts = [];
      for (var hi = 1; hi <= 12; hi++) hourOpts.push({ value: String(hi), label: String(hi) });
      for (var mi = 0; mi < 60; mi++) minOpts.push({ value: String(mi), label: String(mi).padStart(2, '0') });
      var ampmOpts = [{ value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }];
      function makeTimeSelect(label, val, opts, onChange) {
        var f = el('div', 'field lvl-time-field');
        f.append(el('span', null, label));
        var s = document.createElement('select');
        s.className = 'lvl-input lvl-time-sel';
        opts.forEach(function (o) {
          var op = document.createElement('option');
          op.value = o.value;
          op.textContent = o.label;
          if (String(o.value) === String(val)) op.selected = true;
          s.appendChild(op);
        });
        s.addEventListener('change', function () { onChange(s.value); });
        f.append(s);
        return f;
      }
      timeRow.className = (timeRow.className || '') + ' lvl-time-row';
      timeRow.append(makeTimeSelect('Hour', st.h12, hourOpts, function (v) { st.h12 = parseInt(v, 10) || 12; paintNext(); }));
      timeRow.append(makeTimeSelect('Minute', st.minute, minOpts, function (v) { st.minute = parseInt(v, 10) || 0; paintNext(); }));
      timeRow.append(makeTimeSelect('AM/PM', st.ampm, ampmOpts, function (v) { st.ampm = v; paintNext(); }));
      card.append(timeRow);
      card.append(el('p', 'hint', 'America/New_York · posts at the start of the selected minute'));

      card.append(el('h3', null, 'Channel & ping'));
      const pick = (typeof window.pickOne === 'function') ? window.pickOne
        : (typeof pickOne === 'function' ? pickOne : null);
      if (pick) {
        card.append(pick('Channel', 'channel', st.channelId, function (v) { st.channelId = v || ''; }, { blank: 'Select channel…' }));
        card.append(pick('Ping role', 'role', st.roleId, function (v) { st.roleId = v || ''; }, { blank: 'No role ping' }));
      }

      function payload() {
        var hm = toHour24(st.h12, st.minute, st.ampm);
        return {
          enabled: !!st.enabled, hour: hm.hour, minute: hm.minute, timeZone: 'America/New_York',
          channelId: st.channelId || null, roleId: st.roleId || null, limit: st.limit,
          title: st.title, description: st.description, footer: st.footer || null,
        };
      }
      function errMsg(e, res) {
        if (res && (res.detail || res.error)) return res.detail || res.error;
        if (e && e.data && (e.data.detail || e.data.error)) return e.data.detail || e.data.error;
        if (e && e.message) return e.message;
        return 'Request failed';
      }

      const actions = el('div', 'actions');
      const testBtn = el('button', 'btn small', 'Test post');
      testBtn.type = 'button';
      testBtn.addEventListener('click', async function () {
        if (!st.channelId) { if (typeof toast === 'function') toast('Pick a channel first', 'bad'); return; }
        testBtn.disabled = true;
        try {
          var res = await writeLeveling({ dailyLeaderboard: payload(), testDailyLeaderboard: true });
          if (res && res.ok) { if (typeof toast === 'function') toast('Test post sent', 'good'); }
          else if (typeof toast === 'function') toast(errMsg(null, res), 'bad');
        } catch (e) {
          if (typeof toast === 'function') toast(errMsg(e), 'bad');
        } finally { testBtn.disabled = false; }
      });
      const saveBtn = el('button', 'btn', 'Save schedule');
      saveBtn.type = 'button';
      saveBtn.addEventListener('click', async function () {
        saveBtn.disabled = true;
        try {
          st.enabled = !!onChk.checked;
          var res = await writeLeveling({ dailyLeaderboard: payload() });
          applyResult(res);
          if (typeof toast === 'function') toast('Schedule saved', 'good');
          paintNext();
        } catch (e) {
          if (typeof toast === 'function') toast(errMsg(e), 'bad');
        } finally { saveBtn.disabled = false; }
      });
      actions.append(testBtn, saveBtn);
      card.append(actions);
      autoCard = card;
      try {
        if (typeof enhanceSelects === 'function') {
          var pending = card.querySelectorAll('select:not([data-cselect])');
          if (pending.length) enhanceSelects(card);
        }
      } catch (e) {}
    })();

    /* ── Earning rules ─────────────────────────────────────────────────────
       XP per message, how often it counts, the weekend boost and where it
       counts — with a pace readout that turns the numbers into "how long
       to Level 5", which is the question people are really asking. */
    const rules = el('div', 'panel lvl-card lvl-rules');
    cardHead(rules, '⚡', 'Earning rules', 'The first message in each cooldown window earns a random amount between min and max.');
    const iMin = num(L.xpMin, { min: 1, max: 100 });
    const iMax = num(L.xpMax, { min: 1, max: 200 });
    const range = el('div', 'lvl-range');
    const rMin = el('label', 'lvl-range-end');
    rMin.append(el('small', null, 'Min'), iMin);
    const rMax = el('label', 'lvl-range-end');
    rMax.append(el('small', null, 'Max'), iMax);
    const rBar = el('div', 'lvl-range-bar');
    const rFill = el('i');
    rBar.append(rFill);
    const rAvg = el('span', 'lvl-range-avg');
    range.append(rMin, rBar, rMax, rAvg);
    rules.append(field('XP per message', range));

    // Declared before the pickers: they report their first value while being
    // built, and the pace readout must exist to take it.
    let cdPick = null;
    let boostPick = null;
    const pace = el('div', 'lvl-pace');
    cdPick = presetChips([[0, 'Every msg'], [30, '30s'], [60, '1m'], [120, '2m'], [300, '5m']],
      L.cooldownSec != null ? L.cooldownSec : 60, { min: 0, max: 3600, label: 'Cooldown in seconds', onChange: function () { paintPace(); } });
    rules.append(field('Counts once every', cdPick, 'Messages inside the cooldown earn nothing — it stops spam from farming XP.'));
    boostPick = presetChips([[1, 'Off'], [1.25, '×1.25'], [1.5, '×1.5'], [2, '×2']],
      L.weekendBoost != null ? L.weekendBoost : 1, { min: 1, max: 5, step: 0.05, label: 'Weekend multiplier', onChange: function () { paintPace(); } });
    rules.append(field('Weekend boost', boostPick, 'Saturday and Sunday XP is multiplied by this.'));
    rules.append(pace);
    function paintPace() {
      if (!iMin || !iMax || !cdPick || !boostPick) return;
      const lo = Math.max(1, Number(iMin.value) || 1);
      const hi = Math.max(lo, Number(iMax.value) || lo);
      const avg = (lo + hi) / 2;
      // Scaled to the numbers in play, so 15–25 reads as a band, not a dot.
      const scale = Math.max(50, hi * 1.5);
      rFill.style.left = Math.min(100, (lo / scale) * 100) + '%';
      rFill.style.width = Math.max(3, ((hi - lo) / scale) * 100) + '%';
      rAvg.textContent = '≈ ' + fmt(Math.round(avg)) + ' avg';
      const cd = Math.max(1, Number(cdPick._value()) || 1);
      const perHour = Math.round(avg * Math.min(3600 / cd, 120));
      const b = Number(iBase.value) || 100;
      const m = Number(iMult.value) || 1;
      const to5 = totalFor(5, 'exponential', b, m);
      const to15 = totalFor(15, 'exponential', b, m);
      const h5 = to5 / Math.max(1, perHour);
      const h15 = to15 / Math.max(1, perHour);
      const hrs = function (h) { return h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : (h < 48 ? (Math.round(h * 10) / 10) + ' h' : Math.round(h / 24) + ' days'); };
      pace.replaceChildren(
        paceStat(fmt(perHour), 'XP an hour, chatting non-stop'),
        paceStat(hrs(h5), 'of steady chat to Level 5'),
        paceStat(hrs(h15), 'to Level 15')
      );
    }
    function paceStat(n, l) { const s = el('div', 'lvl-pace-stat'); s.append(el('b', null, n), el('span', null, l)); return s; }
    iMin.addEventListener('input', function () { if (Number(iMin.value) > Number(iMax.value)) iMax.value = iMin.value; paintPace(); });
    iMax.addEventListener('input', function () { if (Number(iMax.value) < Number(iMin.value)) iMin.value = iMax.value; paintPace(); });
    iBase.addEventListener('input', paintPace);
    iMult.addEventListener('input', paintPace);
    paintPace();

    // The channel list is an allow-list, not an exclusion: picking a channel
    // stops XP everywhere else. Under "Exclusions" it read as the reverse.
    const where = el('div', 'lvl-where');
    where.append(el('h3', null, 'Where XP counts'));
    const chNo = chipPicker(L.channelOpts || [], L.xpChannelIds || [], 'Add an XP channel…', chName);
    const roleNo = chipPicker(L.roleOpts || [], L.noXpRoleIds, 'Add a no-XP role…', roleName);
    const excl = el('div', 'lvl-channel-grid');
    excl.append(field('Only in these channels', chNo, 'Empty = every channel earns XP.'));
    excl.append(field('Never for these roles', roleNo, 'Bots, muted members, alts — anyone who should not climb.'));
    where.append(excl);
    rules.append(where);

    const rulesAct = el('div', 'actions');
    rulesAct.append(makeSaveBtn('Save earning rules', function () {
      return {
        xpMin: Number(iMin.value),
        xpMax: Number(iMax.value),
        cooldownSec: Number(cdPick._value()) || 0,
        weekendBoost: Number(boostPick._value()) || 1,
        xpChannelIds: chNo._ids(),
        noXpChannelIds: L.noXpChannelIds || [],
        noXpRoleIds: roleNo._ids(),
      };
    }));
    rules.append(rulesAct);

    /* ── Journal XP ───────────────────────────────────────────────────── */
    const journal = el('div', 'panel lvl-card lvl-journal');
    cardHead(journal, '📓', 'Journal XP', 'A forum where posts with an image earn a bigger, slower reward. Text posts there earn normal chat XP.');
    const iJournal = selectOne((L.channelOpts || []).slice(), L.journalForumChannelId || '', 'No journal forum');
    journal.append(field('Journal forum', iJournal));
    const iJMin = num(L.journalXpMin != null ? L.journalXpMin : 30, { min: 1, max: 500 });
    const iJMax = num(L.journalXpMax != null ? L.journalXpMax : 50, { min: 1, max: 1000 });
    iJMin.addEventListener('change', function () { if (Number(iJMin.value) > Number(iJMax.value)) iJMax.value = iJMin.value; });
    iJMax.addEventListener('change', function () { if (Number(iJMax.value) < Number(iJMin.value)) iJMin.value = iJMax.value; });
    const jRange = el('div', 'lvl-range lvl-range-simple');
    const jl = el('label', 'lvl-range-end'); jl.append(el('small', null, 'Min'), iJMin);
    const jh = el('label', 'lvl-range-end'); jh.append(el('small', null, 'Max'), iJMax);
    jRange.append(jl, el('span', 'lvl-range-to', 'to'), jh);
    journal.append(field('XP per journal post', jRange));
    const jCd = presetChips([[3600, '1h'], [21600, '6h'], [43200, '12h'], [86400, '1 day']],
      L.journalCooldownSec != null ? L.journalCooldownSec : 21600, { min: 0, max: 604800, label: 'Journal cooldown in seconds' });
    journal.append(field('One journal reward every', jCd));
    const jImg = toggle('Only posts with an image get journal XP', L.journalImageOnly !== false);
    const jOwn = toggle('Only the journal’s owner earns in it', L.journalOwnerOnly !== false);
    journal.append(jImg, jOwn);
    const jAct = el('div', 'actions');
    jAct.append(makeSaveBtn('Save journal XP', function () {
      return {
        journalForumChannelId: iJournal.value || null,
        journalXpMin: Number(iJMin.value) || 30,
        journalXpMax: Number(iJMax.value) || 50,
        journalCooldownSec: Number(jCd._value()) || 0,
        journalImageOnly: !!(jImg._input && jImg._input.checked),
        journalOwnerOnly: !!(jOwn._input && jOwn._input.checked),
      };
    }));
    journal.append(jAct);

    const earnGrid = el('div', 'grid lvl-earn-grid');
    earnGrid.append(rules, journal);
    root.append(earnGrid);

    /* ── Rank ladder ──────────────────────────────────────────────────────
       Role rewards as rungs, lowest first: the level, the role, and what it
       costs to get there — in XP and in messages. */
    const ranks = el('div', 'panel lvl-card lvl-ladder-card');
    const avgMsg = function () { return ((Number(iMin.value) || 15) + (Number(iMax.value) || 25)) / 2; };
    cardHead(ranks, '♛', 'Rank ladder', 'Each level hands out a role. Only the highest rank is kept — the one before it is removed.');
    const ladder = el('ol', 'lvl-ladder');
    const rewardDraft = (L.roleRewards || []).map(function (r) {
      return { level: r.level, roleId: r.roleId, label: r.label || r.roleName || '' };
    });
    function paintRewards() {
      ladder.replaceChildren();
      const b = Number(iBase.value) || 100;
      const m = Number(iMult.value) || 1;
      const order = rewardDraft.map(function (r, i) { return i; }).sort(function (a, c) { return (Number(rewardDraft[a].level) || 0) - (Number(rewardDraft[c].level) || 0); });
      if (!order.length) ladder.append(el('li', 'lvl-rung-empty', 'No ranks yet — add the first rung below.'));
      order.forEach(function (idx, pos) {
        const r = rewardDraft[idx];
        const rung = el('li', 'lvl-rung');
        rung.style.setProperty('--rung', String(order.length > 1 ? pos / (order.length - 1) : 1));
        const badge = el('label', 'lvl-rung-lv');
        badge.append(el('small', null, 'Lv'));
        const iLevel = num(r.level, { min: 0, max: 500 });
        iLevel.setAttribute('aria-label', 'Level');
        iLevel.addEventListener('change', function () { rewardDraft[idx].level = Number(iLevel.value) || 0; paintRewards(); });
        badge.append(iLevel);
        const iRole = selectOne(L.roleOpts || [], r.roleId, 'Pick a role…');
        iRole.setAttribute('aria-label', 'Role');
        iRole.addEventListener('change', function () {
          rewardDraft[idx].roleId = iRole.value;
          const opt = (L.roleOpts || []).find(function (o) { return o.id === iRole.value; });
          if (opt) rewardDraft[idx].label = opt.name;
        });
        const lv = Math.max(0, Number(r.level) || 0);
        const need = totalFor(lv, mode, b, m);
        const cost = el('span', 'lvl-rung-cost');
        cost.append(el('b', null, fmt(need) + ' XP'), el('small', null, '~' + fmt(Math.ceil(need / avgMsg())) + ' messages'));
        const rm = el('button', 'lvl-rung-x', '×');
        rm.type = 'button';
        rm.title = 'Remove this rank';
        rm.addEventListener('click', function () { rewardDraft.splice(idx, 1); paintRewards(); });
        rung.append(badge, iRole, cost, rm);
        ladder.append(rung);
      });
      try { if (typeof enhanceSelects === 'function') enhanceSelects(ladder); } catch (e) {}
    }
    paintRewards();
    iBase.addEventListener('input', paintRewards);
    iMult.addEventListener('change', paintRewards);
    ranks.append(ladder);
    const rankActions = el('div', 'actions');
    const addReward = el('button', 'btn small ghost', '+ Add a rung');
    addReward.type = 'button';
    addReward.addEventListener('click', function () {
      const top = rewardDraft.reduce(function (mx, r) { return Math.max(mx, Number(r.level) || 0); }, 0);
      rewardDraft.push({ level: rewardDraft.length ? top + 5 : 1, roleId: '', label: '' });
      paintRewards();
    });
    rankActions.append(addReward, makeSaveBtn('Save ranks', function () {
      return { roleRewards: rewardDraft.filter(function (r) { return r.roleId; }) };
    }));
    ranks.append(rankActions);

    /* ── Channel unlocks ──────────────────────────────────────────────── */
    const unlocks = el('div', 'panel lvl-card lvl-unlock-card');
    cardHead(unlocks, '🔓', 'Channel unlocks', 'Which rank roles open which channels. A map for staff — the gates themselves live in Discord.');
    const unlockRows = el('div', 'lvl-unlocks');
    const unlockDraft = (L.channelUnlocks || []).map(function (u) {
      return { channelId: u.channelId || '', channelName: u.channelName || u.resolvedChannelName || '', roleIds: (u.roleIds || []).slice(), note: u.note || '' };
    });
    function paintUnlocks() {
      unlockRows.replaceChildren();
      if (!unlockDraft.length) unlockRows.append(el('p', 'hint lvl-unlock-empty', 'No unlocks mapped yet.'));
      unlockDraft.forEach(function (u, idx) {
        const card = el('div', 'lvl-unlock');
        const iCh = selectOne(L.channelOpts || [], u.channelId, 'Pick a channel…');
        iCh.setAttribute('aria-label', 'Channel');
        iCh.addEventListener('change', function () {
          unlockDraft[idx].channelId = iCh.value;
          const opt = (L.channelOpts || []).find(function (o) { return o.id === iCh.value; });
          if (opt) unlockDraft[idx].channelName = opt.name;
        });
        const roles = chipPicker(L.roleOpts || [], u.roleIds, 'Add a role that opens it…', roleName, function (ids) { unlockDraft[idx].roleIds = ids; });
        const top = el('div', 'lvl-unlock-top');
        top.append(el('span', 'lvl-unlock-ic', '#'), iCh);
        const rm = el('button', 'lvl-rung-x', '×');
        rm.type = 'button';
        rm.title = 'Remove this unlock';
        rm.addEventListener('click', function () { unlockDraft.splice(idx, 1); paintUnlocks(); });
        top.append(rm);
        card.append(top, roles);
        unlockRows.append(card);
      });
      try { if (typeof enhanceSelects === 'function') enhanceSelects(unlockRows); } catch (e) {}
    }
    paintUnlocks();
    unlocks.append(unlockRows);
    const unlockActions = el('div', 'actions');
    const addUnlock = el('button', 'btn small ghost', '+ Add an unlock');
    addUnlock.type = 'button';
    addUnlock.addEventListener('click', function () {
      unlockDraft.push({ channelId: '', channelName: '', roleIds: [], note: '' });
      paintUnlocks();
    });
    unlockActions.append(addUnlock, makeSaveBtn('Save unlocks', function () {
      return { channelUnlocks: unlockDraft.filter(function (u) { return u.channelId || u.channelName; }) };
    }));
    unlocks.append(unlockActions);

    const rankGrid = el('div', 'grid lvl-rank-grid');
    rankGrid.append(ranks, unlocks);
    root.append(rankGrid);

    /* ── Automation + activity ────────────────────────────────────────── */
    const lower = el('div', 'grid lvl-lower-grid');
    if (autoCard) lower.append(autoCard);
    const ev = el('div', 'panel lvl-card lvl-feed-card');
    cardHead(ev, '✦', 'Live XP feed', 'The latest grants, newest first.');
    const feed = el('div', 'lvl-feed');
    const events = (L.tracked && L.recentEvents) || [];
    if (!events.length) {
      feed.append(el('p', 'hint', 'Nothing yet — grants show up here as members chat.'));
    } else {
      events.slice(0, 12).forEach(function (e) {
        const row = el('div', 'lvl-feed-row' + (e.source === 'journal' ? ' is-journal' : ''));
        const who = String(e.name || e.userId || '?');
        row.append(el('span', 'lvl-feed-av', who.slice(0, 1).toUpperCase()));
        const mid = el('span', 'lvl-feed-mid');
        mid.append(el('b', null, who), el('small', null, (e.source === 'journal' ? 'Journal post' : 'Chat') + (e.level != null ? ' · Lv ' + e.level : '')));
        row.append(mid, el('span', 'lvl-feed-xp' + (e.xp < 0 ? ' neg' : ''), (e.xp > 0 ? '+' : '') + e.xp + ' XP'));
        feed.append(row);
      });
    }
    ev.append(feed);
    lower.append(ev);
    root.append(lower);

    /* ── Reset ─────────────────────────────────────────────────────────── */
    const danger = el('div', 'panel lvl-danger');
    const dText = el('div', 'lvl-danger-t');
    dText.append(el('b', null, 'Reset settings to defaults'), el('span', 'hint', 'Roles, rates, curve and unlocks go back to the defaults. Every member keeps their XP and level.'));
    const reset = el('button', 'btn small danger', 'Reset settings');
    reset.type = 'button';
    reset.addEventListener('click', async function () {
      if (typeof askConfirm === 'function') {
        const ok = await askConfirm({
          title: 'Reset leveling settings?',
          message: 'Restores default roles, rates, curve, and unlocks. Member XP and levels are kept.',
          confirmLabel: 'Reset', danger: true,
        });
        if (!ok) return;
      } else if (!confirm('Reset leveling to defaults?')) return;
      reset.disabled = true;
      try {
        const res = await writeLeveling({ op: 'reset' });
        try { applyResult(res); render(); } catch (pe) {}
        if (typeof toast === 'function') toast('Reset to defaults.', 'good');
      } catch (e) {
        if (typeof toast === 'function') toast('Reset failed — ' + ((e.data && e.data.detail) || e.message), 'bad');
      } finally { reset.disabled = false; }
    });
    danger.append(dText, reset);
    root.append(danger);

    function chipPicker(opts, selectedIds, blankLabel, nameOf, onChange) {
      const wrap = el('div', 'lvl-chip-picker');
      const draft = (selectedIds || []).map(String).filter(Boolean);
      const chips = el('div', 'lvl-chip-row');
      const sel = document.createElement('select');
      sel.className = 'lvl-input';
      function paint() {
        chips.replaceChildren();
        draft.forEach(function (id, idx) {
          const chip = el('span', 'lvl-excl-chip');
          chip.append(el('span', null, nameOf(id)));
          const x = el('button', 'lvl-excl-x', '×');
          x.type = 'button';
          x.title = 'Remove';
          x.addEventListener('click', function () {
            draft.splice(idx, 1);
            paint();
            fillSelect();
          });
          chip.append(x);
          chips.append(chip);
        });
        if (!draft.length) chips.append(el('span', 'hint', 'None selected'));
        if (onChange) onChange(draft.slice());
      }
      function fillSelect() {
        sel.replaceChildren();
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = blankLabel;
        sel.append(blank);
        const taken = new Set(draft);
        const available = (opts || []).filter(function (o) {
          const id = String(o.id || o.value || '');
          return id && !taken.has(id);
        });
        const hasCat = available.some(function (o) { return o && o.category; });
        if (hasCat) {
          const order = [];
          const map = {};
          available.forEach(function (o) {
            const g = o.category ? String(o.category) : 'No category';
            if (!map[g]) { map[g] = []; order.push(g); }
            map[g].push(o);
          });
          order.forEach(function (g) {
            const og = document.createElement('optgroup');
            og.label = g;
            map[g].forEach(function (o) {
              const op = document.createElement('option');
              op.value = String(o.id || o.value || '');
              op.textContent = o.name || o.label || op.value;
              og.appendChild(op);
            });
            sel.appendChild(og);
          });
        } else {
          available.forEach(function (o) {
            const op = document.createElement('option');
            op.value = String(o.id || o.value || '');
            op.textContent = o.name || o.label || op.value;
            sel.append(op);
          });
        }
      }
      sel.addEventListener('change', function () {
        const v = sel.value;
        if (!v || draft.indexOf(v) >= 0) return;
        draft.push(v);
        paint();
        fillSelect();
        sel.value = '';
      });
      fillSelect();
      paint();
      wrap.append(sel);
      wrap.append(chips);
      wrap._ids = function () { return draft.slice(); };
      return wrap;
    }

    function chName(id) {
      const o = (L.channelOpts || []).find(function (c) { return String(c.id) === String(id); });
      return o ? ('#' + o.name + (o.category ? (' · ' + o.category) : '')) : id;
    }
    function roleName(id) {
      const o = (L.roleOpts || []).find(function (c) { return String(c.id) === String(id); });
      return o ? o.name : id;
    }

    try { if (typeof enhanceSelects === 'function') enhanceSelects(root); } catch (e) {}
  }
  
  function ensureChipStyles() {
    if (document.getElementById('lvl-excl-chip-css')) return;
    var s = document.createElement('style');
    s.id = 'lvl-excl-chip-css';
    s.textContent = [
      '.lvl-chip-picker{display:flex;flex-direction:column;gap:.55rem}',
      '.lvl-chip-row{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;min-height:1.75rem}',
      '.lvl-excl-chip{display:inline-flex;align-items:center;gap:.35rem;padding:.28rem .55rem;border-radius:999px;background:rgba(139,92,246,.14);border:1px solid rgba(139,92,246,.35);color:var(--ink,#F3F4F6);font-size:.82rem}',
      '.lvl-excl-x{border:0;background:transparent;color:inherit;cursor:pointer;font-size:1rem;line-height:1;padding:0 .15rem;opacity:.75}',
      '.lvl-excl-x:hover{opacity:1}',
    ].join('');
    document.head.appendChild(s);
  }

  function ensurePodiumStyles() {
    if (document.getElementById('lvl-podium-css-link')) return;
    var link = document.createElement('link');
    link.id = 'lvl-podium-css-link';
    link.rel = 'stylesheet';
    link.href = '/leveling-podium.css';
    document.head.appendChild(link);
  }
  // ── Live leaderboard poll (while Leveling section is open) ────────────────
  var _lbPollTimer = null;
  var _lbPollBusy = false;
  var _lbLastSig = '';

  function leaderboardSig(L) {
    if (!L || !L.leaderboard) return '';
    return (L.leaderboard || []).slice(0, 10).map(function (u) {
      return [u.id, u.xp, u.level, u.into, u.need].join(':');
    }).join('|') + '#' + (L.userCount || 0) + '#' + (L.totalEvents || 0);
  }

  function levelingSectionActive() {
    return !!document.querySelector('.section[data-section="leveling"][data-active]');
  }

  /**
   * Swaps in a fresh leaderboard and stat row, nothing else.
   *
   * This used to fetch the whole overview every 8s, overwrite state.overview
   * with it and re-render the entire tab — wiping half-typed settings and
   * closing any open dropdown. The live stream already keeps
   * state.overview.features.levels current, so this only reads it, and only
   * the two read-only parts are replaced.
   */
  function paintLiveParts() {
    var root = document.getElementById('leveling-root');
    if (!root) return;
    var tmp = document.createElement('div');
    render(tmp);
    var parts = ['.lvl-lb-panel', '.lvl-stat-row', '.lvl-empty'];
    var sameShape = parts.every(function (s) { return !!root.querySelector(s) === !!tmp.querySelector(s); });
    if (sameShape && root.querySelector('.lvl-lb-panel')) {
      parts.forEach(function (s) {
        var cur = root.querySelector(s);
        var next = tmp.querySelector(s);
        if (cur && next) cur.replaceWith(next);
      });
      return;
    }
    // Tracked/untracked flipped: the layout itself differs, so only a full
    // render is correct — and never while somebody is typing in the tab.
    var ae = document.activeElement;
    var busy = ae && ae.closest && ae.closest('#leveling-root') && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName);
    if (busy) { _lbLastSig = '#retry'; return; } // differs from any real sig: retried next check
    render();
  }

  function refreshLevelsFromServer() {
    if (_lbPollBusy) return;
    if (!levelingSectionActive()) return;
    var L = data();
    var sig = leaderboardSig(L);
    if (sig === _lbLastSig) return;
    var first = _lbLastSig === '';
    _lbLastSig = sig;
    if (first) return; // render() on open already painted this
    _lbPollBusy = true;
    try {
      paintLiveParts();
    } catch (err) {
      console.warn('[leveling] live paint', err && err.message ? err.message : err);
    } finally {
      _lbPollBusy = false;
    }
  }

  function startLivePoll() {
    if (_lbPollTimer) return;
    _lbLastSig = leaderboardSig(data());
    // A local check, no network: the stream does the fetching.
    _lbPollTimer = setInterval(refreshLevelsFromServer, 3000);
  }

  function stopLivePoll() {
    if (_lbPollTimer) {
      clearInterval(_lbPollTimer);
      _lbPollTimer = null;
    }
  }

  function boot() {

    ensurePodiumStyles();
    ensureChipStyles();
    function tryRender() {
      if (!document.getElementById('leveling-root') || !window.state || !window.state.overview) return;
      render();
    }
    document.addEventListener('panel-overview', tryRender);
    // Fires for every data-active change anywhere in the page, so it acts
    // only when the Leveling tab itself opens or closes. It used to re-render
    // the whole tab on each one.
    var wasActive = levelingSectionActive();
    const obs = new MutationObserver(function () {
      var active = levelingSectionActive();
      if (active === wasActive) return;
      wasActive = active;
      if (active) {
        tryRender();
        startLivePoll();
      } else {
        stopLivePoll();
      }
    });
    if (document.body) obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-active'] });
    window.renderLeveling = render;
    const prev = window.showSection;
    if (typeof prev === 'function') {
      window.showSection = function (name) {
        const r = prev.apply(this, arguments);
        if (name === 'leveling') {
          // The observer above paints on open; this only starts the check.
          startLivePoll();
        } else {
          stopLivePoll();
        }
        return r;
      };
    }
    if (levelingSectionActive()) startLivePoll();
    setTimeout(tryRender, 600);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
