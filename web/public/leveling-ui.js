'use strict';
/**
 * QuantLab Leveling tab — contribution XP analytics & config.
 * Matches control-panel field / panel / actions patterns.
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

  async function writeLeveling(body) {
    const runner =
      (typeof window !== 'undefined' && typeof window.post === 'function' && window.post) ||
      (typeof post === 'function' && post.length >= 2 ? post : null);
    if (!runner) {
      const guildId = (typeof state !== 'undefined' && state?.guildId) || null;
      const csrf = (typeof state !== 'undefined' && state?.csrf) || '';
      if (!guildId) throw new Error('no_guild');
      const headers = { 'content-type': 'application/json', 'x-csrf-token': csrf };
      try { if (typeof authHeaders === 'function') Object.assign(headers, authHeaders()); } catch {}
      const res = await fetch(`/api/guild/${guildId}/leveling`, {
        method: 'POST', credentials: 'same-origin', headers,
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || `http_${res.status}`);
        err.data = data;
        throw err;
      }
      return data;
    }
    return runner('leveling', body, { quiet: true });
  }

  function field(label, control) {
    const f = el('div', 'field');
    f.append(el('span', null, label));
    f.append(control);
    return f;
  }

  function numInput(value, { min = 0, max = 99999, step = 1 } = {}) {
    const i = document.createElement('input');
    i.type = 'number';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.value = value == null || Number.isNaN(Number(value)) ? min : Number(value);
    return i;
  }

  function multiSelect(label, values, opts, kindFilter) {
    const sel = document.createElement('select');
    sel.multiple = true;
    const list = kindFilter
      ? opts.filter(o => o.kind === kindFilter || kindFilter === 'any')
      : opts;
    sel.size = Math.min(6, Math.max(3, list.length || 3));
    const chosen = new Set(values || []);
    for (const o of list) {
      const opt = document.createElement('option');
      opt.value = o.id || o.value;
      opt.textContent = (o.kind === 'forum' ? 'Forum · ' : '#') + (o.name || o.label);
      if (chosen.has(opt.value)) opt.selected = true;
      sel.append(opt);
    }
    const box = field(label, sel);
    box._sel = sel;
    return box;
  }

  function weightCard(key, label, w, hint) {
    const card = el('div', 'lvl-weight-card');
    const head = el('div', 'field-head');
    head.append(el('span', null, label));
    if (hint) head.append(el('span', 'count', hint));
    card.append(head);

    const min = Number(w?.xpMin ?? 0);
    const max = Number(w?.xpMax ?? 0);
    const cdSec = Math.round((w?.cooldownMs || 0) / 1000);

    const grid = el('div', 'lvl-weight-grid');
    const iMin = numInput(Math.min(min, max || min), { min: 0, max: 500 });
    const iMax = numInput(Math.max(min, max), { min: 0, max: 500 });
    const iCd = numInput(cdSec, { min: 0, max: 86400 });

    iMin.dataset.k = key; iMin.dataset.f = 'xpMin';
    iMax.dataset.k = key; iMax.dataset.f = 'xpMax';
    iCd.dataset.k = key; iCd.dataset.f = 'cooldownSec';

    iMin.addEventListener('change', () => {
      if (Number(iMin.value) > Number(iMax.value)) iMax.value = iMin.value;
    });
    iMax.addEventListener('change', () => {
      if (Number(iMax.value) < Number(iMin.value)) iMin.value = iMax.value;
    });

    grid.append(field('Min XP', iMin));
    grid.append(field('Max XP', iMax));
    grid.append(field('Cooldown (sec)', iCd));
    card.append(grid);
    return card;
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
      meta.textContent = xpKey === 'streak' ? ((u.journalStreak || 0) + 'd')
        : xpKey === 'charts' ? ((u.chartCount || 0) + ' charts')
        : xpKey === 'verified' ? ((u.verifiedCount || 0) + ' verified')
        : xpKey === 'help' ? ((u.commentXp || 0) + ' help XP')
        : ((u.xp || 0) + ' XP · L' + (u.level || 1));
      li.append(meta);
      list.append(li);
    });
    if (!list.childNodes.length) list.append(el('li', 'muted', 'No data yet'));
    panel.append(list);
    return panel;
  }

  const WEIGHT_HINTS = {
    chat: 'Near-zero floor — anti-spam',
    ontopic: 'Trade vocab or ticker signal',
    chart: 'Image in trading channel',
    idea: 'Structured setup write-up',
    quantlab_verified: 'Trade id / QuantLab card',
    quantlab_unverified: 'QuantLab markers, no id',
    journal: 'Owner posts in own thread',
    comment: 'Help in someone else’s journal',
  };

  function render() {
    const root = document.getElementById('leveling-root');
    if (!root) return;
    const L = levels();
    root.replaceChildren();
    if (!L) {
      root.append(el('p', 'muted', 'Leveling data unavailable. Enable Leveling & Ranks in Settings.'));
      return;
    }

    const head = el('div', 'panel');
    head.append(el('h2', null, 'Contribution engine'));
    head.append(el('p', 'muted', 'Detection first, then weight. Chat is a floor. Verified QuantLab shares, charts, structured ideas, and owned journal posts move the rank curve.'));
    const toggles = el('div', 'lvl-status-row');
    toggles.append(el('span', L.enabled ? 'pill on' : 'pill off', L.enabled ? 'Engine on' : 'Engine off'));
    toggles.append(el('span', 'tag', (L.totalEvents || 0) + ' events'));
    toggles.append(el('span', 'tag', (L.events7d || 0) + ' this week'));
    toggles.append(el('span', 'tag', (L.journalThreadCount || 0) + ' journal threads'));
    head.append(toggles);
    root.append(head);

    const comp = el('div', 'panel');
    comp.append(el('h2', null, '7-day XP composition'));
    comp.append(el('p', 'hint', 'What the community is actually earning — quality vs chatter.'));
    comp.append(compositionBars(L.composition7d));
    root.append(comp);

    const grid = el('div', 'grid');
    grid.append(lbTable('Overall (all-time)', L.leaderboard, 'xp'));
    grid.append(lbTable('This month', L.leaderboardMonth, 'xp'));
    grid.append(lbTable('Charts', L.topCharts, 'charts'));
    grid.append(lbTable('Journal streaks', L.topJournal, 'streak'));
    grid.append(lbTable('Verified QuantLab', L.topVerified, 'verified'));
    grid.append(lbTable('Helpers', L.topHelpers, 'help'));
    root.append(grid);

    const cfg = el('div', 'panel');
    cfg.append(el('h2', null, 'Live config'));
    cfg.append(el('p', 'hint', 'Curve, ceiling, and channel routing. Saves write a config version for the audit trail.'));

    const en = el('label', 'field');
    const enChk = document.createElement('input');
    enChk.type = 'checkbox';
    enChk.checked = !!L.enabled;
    en.append(enChk, document.createTextNode(' Engine enabled'));
    cfg.append(en);

    const nums = el('div', 'lvl-nums');
    function curveField(label, val, key, opts) {
      const i = numInput(val, opts);
      i.dataset.cfg = key;
      return field(label, i);
    }
    nums.append(curveField('Base XP (level 1)', L.baseXp, 'baseXp', { min: 10, max: 100000 }));
    nums.append(curveField('Growth multiplier', L.multiplier, 'multiplier', { min: 1.01, max: 5, step: 0.01 }));
    nums.append(curveField('Daily XP ceiling', L.dailyXpCeiling, 'dailyXpCeiling', { min: 100, max: 50000 }));
    nums.append(curveField('Trade max age (days)', L.tradeMaxAgeDays, 'tradeMaxAgeDays', { min: 1, max: 365 }));
    cfg.append(nums);

    cfg.append(el('h2', null, 'Channels'));
    cfg.append(el('p', 'hint', 'Where each contribution type is allowed to earn. Empty = learn from activity (general / forum heuristics).'));
    const opts = channelOpts();
    const chGeneral = multiSelect('General chat', L.channels?.general, opts, 'any');
    const chTrading = multiSelect('Trading / charts', L.channels?.trading, opts, 'any');
    const chIdeas = multiSelect('Trade ideas', L.channels?.tradeIdeas, opts, 'any');
    const chJournal = multiSelect('Journals forum', L.channels?.journalsForum, opts, 'forum');
    const chGrid = el('div', 'lvl-channel-grid');
    chGrid.append(chGeneral, chTrading, chIdeas, chJournal);
    cfg.append(chGrid);

    cfg.append(el('h2', null, 'Category weights'));
    cfg.append(el('p', 'hint', 'Min and max XP per grant. Cooldown is seconds between grants of that type for the same member. Symbols: any valid ticker ($ES, NASDAQ:AAPL, NQ) — no closed allowlist.'));

    const wBox = el('div', 'lvl-weights');
    for (const c of (L.categories || [])) {
      const w = (L.weights || {})[c.key] || c;
      wBox.append(weightCard(c.key, c.label, w, WEIGHT_HINTS[c.key] || ''));
    }
    cfg.append(wBox);

    const actions = el('div', 'actions');
    const save = el('button', 'btn primary', 'Save changes');
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
        for (const [k, w] of Object.entries(weights)) {
          let a = Number(w.xpMin) || 0, b = Number(w.xpMax) || 0;
          if (a > b) { const t = a; a = b; b = t; }
          w.xpMin = a; w.xpMax = b;
        }
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
        const res = await writeLeveling(body);
        if (!res) throw new Error('empty_response');
        if (res.error) throw Object.assign(new Error(res.error), { data: res });
        if (res.overview) state.overview = res.overview;
        if (res.levels) {
          if (!state.overview) state.overview = {};
          if (!state.overview.features) state.overview.features = {};
          state.overview.features.levels = res.levels;
        }
        render();
        if (typeof toast === 'function') toast('Changes saved — weights & channels live.', 'good');
        save.textContent = 'Saved';
        setTimeout(() => { save.textContent = 'Save changes'; }, 1600);
      } catch (e) {
        console.error('[leveling save]', e, e?.data);
        const detail = e?.data?.detail || e?.data?.error || e?.message || 'unknown';
        if (typeof toast === 'function') toast('Could not save — ' + detail, 'bad');
      } finally {
        save.disabled = false;
      }
    });
    actions.append(save);
    cfg.append(actions);
    root.append(cfg);

    const ranks = el('div', 'panel');
    ranks.append(el('h2', null, 'Rank ladder'));
    ranks.append(el('p', 'hint', 'Unlock thresholds. Role mapping is optional in a later pass.'));
    const rl = el('div', 'rows');
    for (const r of (L.rankLadder || [])) {
      const row = el('div', 'row');
      row.append(el('span', 'k', 'Lv ' + r.level + ' · ' + r.label));
      row.append(el('span', 'v dim', r.unlock || ''));
      rl.append(row);
    }
    ranks.append(rl);
    root.append(ranks);

    const ev = el('div', 'panel');
    ev.append(el('h2', null, 'Recent XP events'));
    const evList = el('div', 'rows');
    for (const e of (L.recentEvents || []).slice(0, 20)) {
      const row = el('div', 'row');
      row.append(el('span', 'k', (e.category || '?') + ' · ' + String(e.userId || '').slice(0, 8)));
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
    const obs = new MutationObserver(() => {
      const sec = document.querySelector('.section[data-section="leveling"][data-active]');
      if (sec) tryRender();
    });
    if (document.body) obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-active', 'data-state', 'data-section'] });
    window.renderLeveling = render;
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
