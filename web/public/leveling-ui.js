'use strict';
/**
 * Quantlab HQ Leveling — MEE6 panel.
 * Per-section save · curve · role ladder · channel unlocks.
 */
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

  /** Always use fetch so API error bodies are never dropped (window.post returns null on !ok). */
  async function writeLeveling(body) {
    const guildId = state?.guildId;
    if (!guildId) throw Object.assign(new Error('no_guild'), { data: { error: 'no_guild' } });
    const headers = { 'content-type': 'application/json', 'x-csrf-token': state?.csrf || '' };
    try { if (typeof authHeaders === 'function') Object.assign(headers, authHeaders()); } catch {}
    let res;
    try {
      res = await fetch(`/api/guild/${guildId}/leveling`, {
        method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body || {}),
      });
    } catch (net) {
      throw Object.assign(new Error('network'), { data: { error: 'network', detail: String(net.message || net) } });
    }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = out.detail || out.error || ('http_' + res.status);
      throw Object.assign(new Error(msg), { data: out });
    }
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

  function num(value, opts = {}) {
    const i = document.createElement('input');
    i.type = 'number';
    i.className = 'lvl-input';
    if (opts.min != null) i.min = String(opts.min);
    if (opts.max != null) i.max = String(opts.max);
    if (opts.step != null) i.step = String(opts.step);
    i.value = value == null || Number.isNaN(Number(value)) ? (opts.min ?? 0) : Number(value);
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
    for (const opt of options || []) {
      const o = document.createElement('option');
      o.value = opt.id || opt.value;
      o.textContent = opt.name || opt.label || o.value;
      if (String(o.value) === String(value || '')) o.selected = true;
      s.append(o);
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

  function toggle(label, checked, hint) {
    const row = el('div', 'toggle');
    row.append(el('span', 'toggle-text', label));
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    row.append(input);
    const wrap = el('div', 'lvl-toggle-block');
    wrap.append(row);
    if (hint) wrap.append(el('p', 'hint', hint));
    wrap._input = input;
    return wrap;
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function selectedValues(sel) {
    return [...(sel?.selectedOptions || [])].map(o => o.value).filter(Boolean);
  }

  function makeSaveBtn(label, buildBody) {
    const btn = el('button', 'btn primary small', label || 'Save');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const prev = btn.textContent;
      try {
        const body = buildBody();
        const res = await writeLeveling(body);
        try { applyResult(res); render(); } catch (pe) { console.warn('[leveling] paint', pe); }
        if (typeof toast === 'function') toast('Saved.', 'good');
        btn.textContent = 'Saved';
        setTimeout(() => { btn.textContent = prev; }, 1200);
      } catch (e) {
        console.error('[leveling save]', e);
        const why = e?.data?.detail || e?.data?.error || e.message || 'failed';
        if (typeof toast === 'function') toast('Could not save — ' + why, 'bad');
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  function render() {
    const root = document.getElementById('leveling-root');
    if (!root) return;
    const L = data();
    root.replaceChildren();
    if (!L) {
      root.append(el('p', 'muted', 'Leveling data unavailable. Enable Leveling & Ranks in Settings.');
      return;
    }

    const hero = el('div', 'panel');
    const top = el('div', 'lvl-hero-top');
    top.append(el('h2', null, 'Quantlab ranks'));
    top.append(el('span', L.enabled ? 'pill on' : 'pill off', L.enabled ? 'Live' : 'Paused'));
    hero.append(top);
    hero.append(el('p', 'muted', 'Chat XP · configurable curve · roles stack. Premium is Whop only.'));

    if (!L.tracked) {
      const empty = el('div', 'lvl-empty');
      empty.append(el('p', null, 'No XP tracked yet'));
      empty.append(el('p', 'hint', 'Leaderboard stays empty until members earn XP after this reset.'));
      hero.append(empty);
    } else {
      const stats = el('div', 'lvl-stat-row');
      const chip = (v, lab) => {
        const c = el('div', 'lvl-chip');
        c.append(el('strong', null, v));
        c.append(el('span', null, lab));
        return c;
      };
      stats.append(chip(fmt(L.userCount), 'Ranked'));
      stats.append(chip(fmt(L.totalEvents), 'Grants'));
      stats.append(chip((L.xpMin || 15) + '–' + (L.xpMax || 25), 'XP / msg'));
      stats.append(chip((L.cooldownSec || 60) + 's', 'Cooldown'));
      hero.append(stats);
    }
    root.append(hero);

    if (L.tracked && (L.leaderboard || []).length) {
      const board = el('div', 'panel');
      board.append(el('h2', null, 'Leaderboard'));
      const list = el('ol', 'board lvl-board');
      (L.leaderboard || []).forEach((u, i) => {
        const li = el('li');
        li.append(el('span', 'rank', String(i + 1)));
        const name = el('span', 'name', u.name || u.id);
        if (u.name && u.name !== u.id) name.title = u.id;
        li.append(name);
        li.append(el('span', 'bal', fmt(u.xp) + ' XP · L' + u.level));
        list.append(li);
      });
      board.append(list);
      root.append(board);
    }

    const curve = el('div', 'panel');
    curve.append(el('h2', null, 'Level curve'));
    curve.append(el('p', 'hint', 'Base XP is what level 0→1 costs. Multiplier scales each next step (×1 = flat, ×1.5 = 50% more each level).'));
    const curveGrid = el('div', 'lvl-nums');
    const iBase = num(L.curveBase ?? 100, { min: 10, max: 50000, step: 10 });
    const iMult = num(L.curveMult ?? 1.5, { min: 1, max: 3, step: 0.01 });
    curveGrid.append(field('Base XP', iBase, 'XP to finish level 0'));
    curveGrid.append(field('Level multiplier', iMult, 'Next level cost × this'));
    curve.append(curveGrid);

    const preview = el('div', 'lvl-curve-table');
    function stepXp(n, base, mult) {
      const b = Math.max(10, Number(base) || 100);
      const m = Math.max(1, Number(mult) || 1);
      if (m === 1) return Math.round(b);
      return Math.max(1, Math.round(b * Math.pow(m, n)));
    }
    function totalFor(Lv, base, mult) {
      let s = 0;
      for (let n = 0; n < Lv; n++) s += stepXp(n, base, mult);
      return s;
    }
    function paintPreview() {
      preview.replaceChildren();
      const b = Number(iBase.value) || 100;
      const m = Number(iMult.value) || 1;
      for (const lv of [1, 5, 15, 30, 50]) {
        const r = el('div', 'row');
        r.append(el('span', 'k', 'Level ' + lv));
        r.append(el('span', 'v', fmt(totalFor(lv, b, m)) + ' XP total · ' + fmt(stepXp(lv - 1, b, m)) + ' / step'));
        preview.append(r);
      }
    }
    paintPreview();
    iBase.addEventListener('input', () => { paintPreview(); paintRewards(); });
    iMult.addEventListener('input', () => { paintPreview(); paintRewards(); });
    curve.append(preview);

    const curveActions = el('div', 'actions');
    curveActions.append(makeSaveBtn('Save curve', () => ({
      curveBase: Number(iBase.value) || 100,
      curveMult: Number(iMult.value) || 1,
    })));
    curve.append(curveActions);
    root.append(curve);

    const ranks = el('div', 'panel');
    ranks.append(el('h2', null, 'Role rewards'));
    ranks.append(el('p', 'hint', 'Level → role. Cumulative — lower roles stay. Total XP uses the curve above.'));
    const rewardRows = el('div', 'lvl-edit-list');
    const rewardDraft = (L.roleRewards || []).map(r => ({
      level: r.level, roleId: r.roleId, label: r.label || r.roleName || '',
    }));
    function paintRewards() {
      rewardRows.replaceChildren();
      const b = Number(iBase.value) || 100;
      const m = Number(iMult.value) || 1;
      rewardDraft.forEach((r, idx) => {
        const card = el('div', 'lvl-edit-card');
        const grid = el('div', 'lvl-edit-grid');
        const iLevel = num(r.level, { min: 0, max: 500 });
        iLevel.addEventListener('change', () => { rewardDraft[idx].level = Number(iLevel.value) || 0; paintRewards(); });
        const iRole = selectOne(L.roleOpts || [], r.roleId, 'Pick role…');
        iRole.addEventListener('change', () => {
          rewardDraft[idx].roleId = iRole.value;
          const opt = (L.roleOpts || []).find(o => o.id === iRole.value);
          if (opt) rewardDraft[idx].label = opt.name;
        });
        const lv = Math.max(0, Number(r.level) || 0);
        const xpHint = el('span', 'lvl-xp-need', fmt(totalFor(lv, b, m)) + ' XP to reach');
        grid.append(field('Level', iLevel));
        grid.append(field('Role', iRole));
        const meta = el('div', 'lvl-edit-meta');
        meta.append(xpHint);
        const rm = el('button', 'btn small', 'Remove');
        rm.type = 'button';
        rm.addEventListener('click', () => { rewardDraft.splice(idx, 1); paintRewards(); });
        meta.append(rm);
        card.append(grid);
        card.append(meta);
        rewardRows.append(card);
      });
    }
    paintRewards();
    ranks.append(rewardRows);
    const addReward = el('button', 'btn small', 'Add rank');
    addReward.type = 'button';
    addReward.addEventListener('click', () => { rewardDraft.push({ level: 0, roleId: '', label: '' }); paintRewards(); });
    ranks.append(addReward);
    const rankActions = el('div', 'actions');
    rankActions.append(makeSaveBtn('Save roles', () => ({
      roleRewards: rewardDraft.filter(r => r.roleId),
    })));
    ranks.append(rankActions);
    root.append(ranks);

    const unlocks = el('div', 'panel');
    unlocks.append(el('h2', null, 'Channel unlocks'));
    unlocks.append(el('p', 'hint', 'Which roles open which channels (gates live on Discord — this is your map).'));
    const unlockRows = el('div', 'lvl-edit-list');
    const unlockDraft = (L.channelUnlocks || []).map(u => ({
      channelId: u.channelId || '',
      channelName: u.channelName || u.resolvedChannelName || '',
      roleIds: [...(u.roleIds || [])],
      note: u.note || '',
    }));
    function paintUnlocks() {
      unlockRows.replaceChildren();
      unlockDraft.forEach((u, idx) => {
        const card = el('div', 'lvl-edit-card');
        const grid = el('div', 'lvl-edit-grid');
        const iCh = selectOne(L.channelOpts || [], u.channelId, 'Pick channel…');
        iCh.addEventListener('change', () => {
          unlockDraft[idx].channelId = iCh.value;
          const opt = (L.channelOpts || []).find(o => o.id === iCh.value);
          if (opt) unlockDraft[idx].channelName = opt.name;
        });
        const iRoles = multi(L.roleOpts || [], u.roleIds);
        iRoles.addEventListener('change', () => { unlockDraft[idx].roleIds = selectedValues(iRoles); });
        grid.append(field('Channel', iCh));
        grid.append(field('Roles that unlock', iRoles));
        const rm = el('button', 'btn small', 'Remove');
        rm.type = 'button';
        rm.addEventListener('click', () => { unlockDraft.splice(idx, 1); paintUnlocks(); });
        card.append(grid);
        card.append(rm);
        unlockRows.append(card);
      });
    }
    paintUnlocks();
    unlocks.append(unlockRows);
    const addUnlock = el('button', 'btn small', 'Add unlock');
    addUnlock.type = 'button';
    addUnlock.addEventListener('click', () => { unlockDraft.push({ channelId: '', channelName: '', roleIds: [], note: '' }); paintUnlocks(); });
    unlocks.append(addUnlock);
    const unlockActions = el('div', 'actions');
    unlockActions.append(makeSaveBtn('Save unlocks', () => ({
      channelUnlocks: unlockDraft.filter(u => u.channelId || u.channelName),
    })));
    unlocks.append(unlockActions);
    root.append(unlocks);

    const cfg = el('div', 'panel');
    cfg.append(el('h2', null, 'XP settings'));
    cfg.append(el('p', 'hint', 'First qualifying message in each cooldown window earns XP.'));
    const en = toggle('Engine enabled', L.enabled);
    cfg.append(en);
    const rateGrid = el('div', 'lvl-nums');
    const iMin = num(L.xpMin, { min: 1, max: 100 });
    const iMax = num(L.xpMax, { min: 1, max: 200 });
    const iCd = num(L.cooldownSec, { min: 0, max: 3600 });
    iMin.addEventListener('change', () => { if (Number(iMin.value) > Number(iMax.value)) iMax.value = iMin.value; });
    iMax.addEventListener('change', () => { if (Number(iMax.value) < Number(iMin.value)) iMin.value = iMax.value; });
    rateGrid.append(field('Min XP / msg', iMin));
    rateGrid.append(field('Max XP / msg', iMax));
    rateGrid.append(field('Cooldown (sec)', iCd));
    const iWeekend = num(L.weekendBoost ?? 1, { min: 1, max: 5, step: 0.1 });
    rateGrid.append(field('Weekend boost', iWeekend, '1 = off'));
    cfg.append(rateGrid);

    cfg.append(el('h2', null, 'Exclusions'));
    const chNo = multi(L.channelOpts || [], L.noXpChannelIds);
    const roleNo = multi(L.roleOpts || [], L.noXpRoleIds);
    const excl = el('div', 'lvl-channel-grid');
    excl.append(field('No-XP channels', chNo));
    excl.append(field('No-XP roles', roleNo));
    cfg.append(excl);

    const actions = el('div', 'actions');
    actions.append(makeSaveBtn('Save XP settings', () => ({
      enabled: !!en._input?.checked,
      xpMin: Number(iMin.value),
      xpMax: Number(iMax.value),
      cooldownSec: Number(iCd.value),
      weekendBoost: Number(iWeekend.value) || 1,
      noXpChannelIds: selectedValues(chNo),
      noXpRoleIds: selectedValues(roleNo),
    })));

    const reset = el('button', 'btn', 'Reset all XP');
    reset.type = 'button';
    reset.addEventListener('click', async () => {
      if (typeof askConfirm === 'function') {
        const ok = await askConfirm({
          title: 'Reset all XP?',
          message: 'Every member XP and the leaderboard are cleared. Roles already assigned are not removed.',
          confirmLabel: 'Reset XP', danger: true,
        });
        if (!ok) return;
      } else if (!confirm('Reset all XP?')) return;
      reset.disabled = true;
      try {
        const res = await writeLeveling({ op: 'reset' });
        try { applyResult(res); render(); } catch (pe) { console.warn('[leveling] paint', pe); }
        if (typeof toast === 'function') toast('Leaderboard cleared — tracking starts fresh.', 'good');
      } catch (e) {
        if (typeof toast === 'function') toast('Reset failed — ' + (e?.data?.detail || e.message), 'bad');
      } finally { reset.disabled = false; }
    });
    actions.append(reset);
    cfg.append(actions);
    root.append(cfg);

    if (L.tracked && (L.recentEvents || []).length) {
      const ev = el('div', 'panel');
      ev.append(el('h2', null, 'Recent XP'));
      const list = el('div', 'rows');
      for (const e of L.recentEvents.slice(0, 12)) {
        const row = el('div', 'row');
        row.append(el('span', 'k', e.name || e.userId || '?'));
        row.append(el('span', 'v', (e.xp > 0 ? '+' : '') + e.xp + ' · L' + (e.level ?? '—')));
        list.append(row);
      }
      ev.append(list);
      root.append(ev);
    }
  }

  function boot() {
    const tryRender = () => {
      if (!document.getElementById('leveling-root') || !window.state?.overview) return;
      render();
    };
    document.addEventListener('panel-overview', tryRender);
    const obs = new MutationObserver(() => {
      if (document.querySelector('.section[data-section="leveling"][data-active]')) tryRender();
    });
    if (document.body) obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-active'] });
    window.renderLeveling = render;
    const prev = window.showSection;
    if (typeof prev === 'function') {
      window.showSection = function (name) {
        const r = prev.apply(this, arguments);
        if (name === 'leveling') setTimeout(render, 30);
        return r;
      };
    }
    setTimeout(tryRender, 600);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
