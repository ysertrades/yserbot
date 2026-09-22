'use strict';
/**
 * QuantLab Leveling tab — contribution XP analytics & config (spec §07).
 * Loads after app.js; safe if section missing.
 */
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function levels() {
    try { return state?.overview?.features?.levels || null; } catch { return null; }
  }
  function channelOpts() {
    const t = levels();
    return (t && t.channelOpts) || [];
  }
  function post(body) {
    if (typeof api === 'function') return api('leveling', body);
    if (typeof postGuild === 'function') return postGuild('leveling', body);
    return Promise.reject(new Error('no api'));
  }

  function multiSelect(label, values, opts, kindFilter) {
    const box = el('div', 'field');
    box.append(el('label', null, label));
    const sel = document.createElement('select');
    sel.multiple = true;
    const list = kindFilter ? opts.filter(o => o.kind === kindFilter || kindFilter === 'any') : opts;
    sel.size = Math.min(7, Math.max(3, list.length || 3));
    const chosen = new Set(values || []);
    for (const o of list) {
      const opt = document.createElement('option');
      opt.value = o.id || o.value;
      opt.textContent = (o.kind === 'forum' ? 'Forum · ' : '#') + (o.name || o.label);
      if (chosen.has(opt.value)) opt.selected = true;
      sel.append(opt);
    }
    box.append(sel);
    box._sel = sel;
    return box;
  }

  function weightRow(key, label, w) {
    const row = el('div', 'lvl-weight-row');
    row.append(el('span', 'lvl-weight-key', label));
    const min = document.createElement('input');
    min.type = 'number'; min.min = 0; min.max = 500; min.value = w?.xpMin ?? 0;
    min.dataset.k = key; min.dataset.f = 'xpMin';
    const max = document.createElement('input');
    max.type = 'number'; max.min = 0; max.max = 500; max.value = w?.xpMax ?? 0;
    max.dataset.k = key; max.dataset.f = 'xpMax';
    const cd = document.createElement('input');
    cd.type = 'number'; cd.min = 0; cd.max = 86400; cd.value = Math.round((w?.cooldownMs || 0) / 1000);
    cd.dataset.k = key; cd.dataset.f = 'cooldownSec';
    row.append(el('span', 'hint', 'min'), min, el('span', 'hint', 'max'), max, el('span', 'hint', 'cd s'), cd);
    return row;
  }

  function compositionBars(comp) {
    const wrap = el('div', 'lvl-compose');
    const entries = Object.entries(comp || {});
    const total = entries.reduce((s, [, v]) => s + (v || 0), 0) || 1;
    const labels = {
      chat: 'Chat', ontopic: 'On-topic', chart: 'Charts', idea: 'Ideas',
      quantlab_verified: 'QL verified', quantlab_unverified: 'QL unverified',
      journal: 'Journal', comment: 'Help',
    };
    for (const [k, v] of entries.sort((a, b) => b[1] - a[1])) {
      if (!v) continue;
      const row = el('div', 'lvl-compose-row');
      row.append(el('span', 'lvl-compose-label', labels[k] || k));
      const track = el('div', 'lvl-compose-track');
      const fill = el('div', 'lvl-compose-fill');
      fill.style.width = Math.max(2, Math.round((v / total) * 100)) + '%';
      track.append(fill);
      row.append(track);
      row.append(el('span', 'lvl-compose-val', String(v)));
      wrap.append(row);
    }
    if (!wrap.childNodes.length) wrap.append(el('p', 'muted', 'No XP events in the last 7 days yet.'));
    return wrap;
  }

  function lbTable(title, rows, xpKey) {
    const panel = el('article', 'panel');
    panel.append(el('h2', null, title));
    const list = el('ol', 'board lvl-board');
    (rows || []).slice(0, 10).forEach((u, i) => {
      const li = el('li');
      li.append(el('span', 'rank', String(i + 1)));
      li.append(el('span', 'name', u.id));
      const meta = el('span', 'bal');
      meta.textContent = xpKey === 'streak' ? (u.journalStreak + 'd')
        : xpKey === 'charts' ? (u.chartCount + ' charts')
        : xpKey === 'verified' ? (u.verifiedCount + ' verified')
        : xpKey === 'help' ? (u.commentXp + ' help XP')
        : (u.xp + ' XP · L' + u.level);
      li.append(meta);
      list.append(li);
    });
    if (!list.childNodes.length) list.append(el('li', 'muted', 'No data yet'));
    panel.append(list);
    return panel;
  }

  function render() {
    const root = document.getElementById('leveling-root');
    if (!root) return;
    const L = levels();
    root.replaceChildren();
    if (!L) {
      root.append(el('p', 'muted', 'Leveling data unavailable. Enable Leveling & Ranks in Settings.'));
      return;
    }

    // Header status
    const head = el('div', 'panel');
    head.append(el('h2', null, 'Contribution engine'));
    head.append(el('p', 'muted', 'XP is awarded after classification — chat is near-zero; verified QuantLab shares, charts, structured ideas, and owned journal posts carry the curve.'));
    const toggles = el('div', 'lvl-status-row');
    toggles.append(el('span', L.enabled ? 'pill on' : 'pill off', L.enabled ? 'ENGINE ON' : 'ENGINE OFF'));
    toggles.append(el('span', 'tag', (L.totalEvents || 0) + ' events'));
    toggles.append(el('span', 'tag', (L.events7d || 0) + ' this week'));
    toggles.append(el('span', 'tag', (L.journalThreadCount || 0) + ' journal threads'));
    head.append(toggles);
    root.append(head);

    // Composition
    const comp = el('div', 'panel');
    comp.append(el('h2', null, '7-day XP composition'));
    comp.append(el('p', 'hint', 'Stacked view of what the community is actually earning — quality vs chatter.'));
    comp.append(compositionBars(L.composition7d));
    root.append(comp);

    // Leaderboards grid
    const grid = el('div', 'grid');
    grid.append(lbTable('Overall (all-time)', L.leaderboard, 'xp'));
    grid.append(lbTable('This month', L.leaderboardMonth, 'xp'));
    grid.append(lbTable('Charts', L.topCharts, 'charts'));
    grid.append(lbTable('Journal streaks', L.topJournal, 'streak'));
    grid.append(lbTable('Verified QuantLab', L.topVerified, 'verified'));
    grid.append(lbTable('Helpers', L.topHelpers, 'help'));
    root.append(grid);

    // Config
    const cfg = el('div', 'panel');
    cfg.append(el('h2', null, 'Live config'));
    cfg.append(el('p', 'muted', 'Weights and channels write a config version so retunes show on the timeline.'));

    const en = el('label', 'field');
    const enChk = document.createElement('input');
    enChk.type = 'checkbox'; enChk.checked = !!L.enabled;
    en.append(enChk, document.createTextNode(' Engine enabled'));
    cfg.append(en);

    const nums = el('div', 'lvl-nums');
    function numField(label, val, key) {
      const f = el('label', 'field');
      f.append(el('span', null, label));
      const i = document.createElement('input');
      i.type = 'number'; i.value = val; i.dataset.cfg = key;
      f.append(i);
      return f;
    }
    nums.append(numField('Base XP (level 1)', L.baseXp, 'baseXp'));
    nums.append(numField('Growth multiplier', L.multiplier, 'multiplier'));
    nums.append(numField('Daily XP ceiling', L.dailyXpCeiling, 'dailyXpCeiling'));
    nums.append(numField('Trade max age (days)', L.tradeMaxAgeDays, 'tradeMaxAgeDays'));
    cfg.append(nums);

    const opts = channelOpts();
    const chGeneral = multiSelect('General chat channels', L.channels?.general, opts, 'any');
    const chTrading = multiSelect('Trading / chart channels', L.channels?.trading, opts, 'any');
    const chIdeas = multiSelect('Trade-ideas channels', L.channels?.tradeIdeas, opts, 'any');
    const chJournal = multiSelect('Journals forum', L.channels?.journalsForum, opts, 'forum');
    cfg.append(chGeneral, chTrading, chIdeas, chJournal);

    cfg.append(el('h2', null, 'Category weights'));
    cfg.append(el('p', 'hint', 'min / max XP · cooldown seconds. Symbols: any valid ticker form ($ES, NASDAQ:AAPL, NQ) — no closed allowlist.'));
    const wBox = el('div', 'lvl-weights');
    for (const c of (L.categories || [])) {
      wBox.append(weightRow(c.key, c.label, (L.weights || {})[c.key] || c));
    }
    cfg.append(wBox);

    const actions = el('div', 'actions');
    const save = el('button', 'btn primary', 'Save leveling');
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const weights = {};
        wBox.querySelectorAll('input').forEach(inp => {
          const k = inp.dataset.k, f = inp.dataset.f;
          if (!k) return;
          if (!weights[k]) weights[k] = {};
          if (f === 'cooldownSec') weights[k].cooldownMs = Math.round(Number(inp.value) || 0) * 1000;
          else weights[k][f] = Number(inp.value);
        });
        const selected = (box) => [...box._sel.selectedOptions].map(o => o.value);
        const body = {
          enabled: enChk.checked,
          baseXp: Number(nums.querySelector('[data-cfg=baseXp]')?.value),
          multiplier: Number(nums.querySelector('[data-cfg=multiplier]')?.value),
          dailyXpCeiling: Number(nums.querySelector('[data-cfg=dailyXpCeiling]')?.value),
          tradeMaxAgeDays: Number(nums.querySelector('[data-cfg=tradeMaxAgeDays]')?.value),
          channels: {
            general: selected(chGeneral),
            trading: selected(chTrading),
            tradeIdeas: selected(chIdeas),
            journalsForum: selected(chJournal),
          },
          weights,
        };
        const res = await post(body);
        if (res?.overview) state.overview = res.overview;
        else if (res?.levels && state.overview?.features) state.overview.features.levels = res.levels;
        render();
        if (typeof toast === 'function') toast('Leveling saved', 'good');
      } catch (e) {
        console.error(e);
        if (typeof toast === 'function') toast('Save failed', 'bad');
      } finally {
        save.disabled = false;
      }
    });
    actions.append(save);
    cfg.append(actions);
    root.append(cfg);

    // Rank ladder
    const ranks = el('div', 'panel');
    ranks.append(el('h2', null, 'Rank ladder'));
    const rl = el('div', 'lvl-ranks');
    for (const r of (L.rankLadder || [])) {
      const row = el('div', 'lvl-rank-row');
      row.append(el('span', 'tag', 'Lv ' + r.level));
      row.append(el('strong', null, r.label));
      row.append(el('span', 'hint', r.unlock || ''));
      rl.append(row);
    }
    ranks.append(rl);
    root.append(ranks);

    // Recent events
    const ev = el('div', 'panel');
    ev.append(el('h2', null, 'Recent XP events'));
    const evList = el('div', 'rows');
    for (const e of (L.recentEvents || []).slice(0, 20)) {
      const row = el('div', 'row');
      row.append(el('span', 'k', (e.category || '?') + ' · ' + (e.userId || '').slice(0, 6)));
      row.append(el('span', 'v', (e.xp > 0 ? '+' : '') + e.xp + ' XP'));
      evList.append(row);
    }
    if (!evList.childNodes.length) evList.append(el('p', 'muted', 'No events logged yet.'));
    ev.append(evList);
    root.append(ev);
  }

  function boot() {
    const tryRender = () => {
      if (!document.getElementById('leveling-root')) return;
      if (!window.state?.overview) return;
      render();
    };
    document.addEventListener('panel-overview', tryRender);
    // Poll lightly until overview exists, then render on section show
    const obs = new MutationObserver(() => {
      const sec = document.querySelector('.section[data-section="leveling"][data-active]');
      if (sec) tryRender();
    });
    if (document.body) obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-active', 'data-state', 'data-section'] });
    window.renderLeveling = render;
    // Hook showSection if present
    const prev = window.showSection;
    if (typeof prev === 'function') {
      window.showSection = function (name) {
        const r = prev.apply(this, arguments);
        if (name === 'leveling') setTimeout(render, 30);
        return r;
      };
    }
    setTimeout(tryRender, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
