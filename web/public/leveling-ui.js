'use strict';
/**
 * Quantlab HQ Leveling — MEE6-style panel.
 * Empty until tracking starts; display names; panel field language.
 */
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function L() {
    try { return state?.overview?.features?.levels || null; } catch { return null; }
  }

  async function writeLeveling(body) {
    const runner =
      (typeof window !== 'undefined' && typeof window.post === 'function' && window.post) ||
      (typeof post === 'function' && post.length >= 2 ? post : null);
    if (!runner) {
      const guildId = state?.guildId;
      if (!guildId) throw new Error('no_guild');
      const headers = { 'content-type': 'application/json', 'x-csrf-token': state?.csrf || '' };
      try { if (typeof authHeaders === 'function') Object.assign(headers, authHeaders()); } catch {}
      const res = await fetch(`/api/guild/${guildId}/leveling`, {
        method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body || {}),
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

  function field(label, control, hint) {
    const f = el('div', 'field');
    f.append(el('span', null, label));
    f.append(control);
    if (hint) f.append(el('p', 'hint', hint));
    return f;
  }

  function numInput(value, opts = {}) {
    const i = document.createElement('input');
    i.type = 'number';
    if (opts.min != null) i.min = String(opts.min);
    if (opts.max != null) i.max = String(opts.max);
    if (opts.step != null) i.step = String(opts.step);
    i.value = value == null || Number.isNaN(Number(value)) ? (opts.min ?? 0) : Number(value);
    return i;
  }

  function multiSelect(label, selectedIds, options) {
    const sel = document.createElement('select');
    sel.multiple = true;
    const list = options || [];
    sel.size = Math.min(6, Math.max(3, list.length || 3));
    const chosen = new Set(selectedIds || []);
    for (const o of list) {
      const opt = document.createElement('option');
      opt.value = o.id || o.value;
      opt.textContent = o.name || o.label || opt.value;
      if (chosen.has(opt.value)) opt.selected = true;
      sel.append(opt);
    }
    const box = field(label, sel);
    box._sel = sel;
    return box;
  }

  function toggleRow(label, checked, hint) {
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

  function statChip(value, label) {
    const c = el('div', 'lvl-chip');
    c.append(el('strong', null, value));
    c.append(el('span', null, label));
    return c;
  }

  function render() {
    const root = document.getElementById('leveling-root');
    if (!root) return;
    const data = L();
    root.replaceChildren();

    if (!data) {
      root.append(el('p', 'muted', 'Leveling data unavailable. Enable Leveling & Ranks in Settings.'));
      return;
    }

    const hero = el('div', 'panel lvl-hero');
    const heroTop = el('div', 'lvl-hero-top');
    heroTop.append(el('h2', null, 'Quantlab ranks'));
    heroTop.append(el('span', data.enabled ? 'pill on' : 'pill off', data.enabled ? 'Live' : 'Paused'));
    hero.append(heroTop);
    hero.append(el('p', 'muted', 'Message XP · 15–25 per chat · 60s cooldown · cumulative role unlocks. Premium stays on Whop — never from XP.'));

    if (!data.tracked) {
      const empty = el('div', 'lvl-empty');
      empty.append(el('p', null, 'Tracking has not started yet.'));
      empty.append(el('p', 'hint', 'As members chat in allowed channels, XP and the leaderboard appear here. No placeholder ranks.'));
      hero.append(empty);
    } else {
      const stats = el('div', 'lvl-stat-row');
      stats.append(statChip(fmt(data.userCount), 'Members ranked'));
      stats.append(statChip(fmt(data.totalEvents), 'XP grants'));
      stats.append(statChip((data.xpMin || 15) + '–' + (data.xpMax || 25), 'XP / message'));
      stats.append(statChip((data.cooldownSec || 60) + 's', 'Cooldown'));
      hero.append(stats);
    }
    root.append(hero);

    if (data.tracked && (data.leaderboard || []).length) {
      const board = el('div', 'panel');
      board.append(el('h2', null, 'Leaderboard'));
      board.append(el('p', 'hint', 'Total XP · level from the Quantlab curve.'));
      const list = el('ol', 'board lvl-board');
      (data.leaderboard || []).forEach((u, i) => {
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

    const ranks = el('div', 'panel');
    ranks.append(el('h2', null, 'Role rewards'));
    ranks.append(el('p', 'hint', 'Assigned at level, cumulative — lower ranks stay. Channel gates already live on Discord.'));
    const ladder = el('div', 'lvl-ladder');
    for (const r of (data.roleRewards || [])) {
      const card = el('div', 'lvl-rank-card');
      const left = el('div', 'lvl-rank-left');
      left.append(el('span', 'tag', 'Lv ' + r.level));
      left.append(el('strong', null, r.roleName || r.label));
      card.append(left);
      const right = el('div', 'lvl-rank-right');
      right.append(el('span', 'lvl-xp-need', fmt(r.totalXp) + ' XP'));
      card.append(right);
      ladder.append(card);
    }
    ranks.append(ladder);

    if ((data.channelUnlocks || []).length) {
      ranks.append(el('h2', null, 'Channel unlocks'));
      ranks.append(el('p', 'hint', 'Permission gates on the server — XP only awards the roles that open them.'));
      const unlocks = el('div', 'rows');
      for (const u of data.channelUnlocks) {
        const row = el('div', 'row');
        row.append(el('span', 'k', u.name));
        row.append(el('span', 'v dim', (u.roles || []).join(' · ') + (u.note ? ' · ' + u.note : '')));
        unlocks.append(row);
      }
      ranks.append(unlocks);
    }
    root.append(ranks);

    const curve = el('div', 'panel');
    curve.append(el('h2', null, 'Level curve'));
    curve.append(el('p', 'hint', data.formula || 'xp_to_next(n) = 5n² + 50n + 100'));
    const table = el('div', 'lvl-curve-table');
    for (const row of (data.curveTable || [])) {
      const r = el('div', 'row');
      r.append(el('span', 'k', 'Level ' + row.level));
      r.append(el('span', 'v', fmt(row.totalXp) + ' XP total'));
      table.append(r);
    }
    curve.append(table);
    root.append(curve);

    const cfg = el('div', 'panel');
    cfg.append(el('h2', null, 'XP settings'));
    cfg.append(el('p', 'hint', 'MEE6-style rates. First qualifying message in each cooldown window earns XP.'));

    const en = toggleRow('Engine enabled', data.enabled);
    cfg.append(en);

    const rateGrid = el('div', 'lvl-nums');
    const iMin = numInput(data.xpMin, { min: 1, max: 100 });
    const iMax = numInput(data.xpMax, { min: 1, max: 200 });
    const iCd = numInput(data.cooldownSec, { min: 0, max: 3600 });
    const iLen = numInput(data.minMessageLength, { min: 0, max: 50 });
    iMin.addEventListener('change', () => { if (Number(iMin.value) > Number(iMax.value)) iMax.value = iMin.value; });
    iMax.addEventListener('change', () => { if (Number(iMax.value) < Number(iMin.value)) iMin.value = iMax.value; });
    rateGrid.append(field('Min XP', iMin));
    rateGrid.append(field('Max XP', iMax));
    rateGrid.append(field('Cooldown (sec)', iCd));
    rateGrid.append(field('Min message length', iLen, '0 = any length'));
    cfg.append(rateGrid);

    const emoji = toggleRow('Ignore emoji-only messages', data.ignoreEmojiOnly !== false, 'Pure emoji / sticker spam earns nothing.');
    cfg.append(emoji);

    const iWeekend = numInput(data.weekendBoost ?? 1, { min: 1, max: 5, step: 0.1 });
    cfg.append(field('Weekend boost', iWeekend, '1 = off · 2 = double XP Sat/Sun (UTC)'));

    cfg.append(el('h2', null, 'Exclusions'));
    cfg.append(el('p', 'hint', 'No-XP channels and roles never earn. Use for bot-commands, logs, mute.'));
    const chNo = multiSelect('No-XP channels', data.noXpChannelIds, data.channelOpts || []);
    const roleNo = multiSelect('No-XP roles', data.noXpRoleIds, data.roleOpts || []);
    const excl = el('div', 'lvl-channel-grid');
    excl.append(chNo, roleNo);
    cfg.append(excl);

    const actions = el('div', 'actions');
    const save = el('button', 'btn primary', 'Save changes');
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const selected = (box) => [...(box._sel?.selectedOptions || [])].map(o => o.value);
        const body = {
          enabled: !!en._input?.checked,
          xpMin: Number(iMin.value),
          xpMax: Number(iMax.value),
          cooldownSec: Number(iCd.value),
          minMessageLength: Number(iLen.value),
          ignoreEmojiOnly: !!emoji._input?.checked,
          weekendBoost: Number(iWeekend.value) || 1,
          noXpChannelIds: selected(chNo),
          noXpRoleIds: selected(roleNo),
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
        if (typeof toast === 'function') toast('Changes saved — XP rates live.', 'good');
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

    if (data.tracked && (data.recentEvents || []).length) {
      const ev = el('div', 'panel');
      ev.append(el('h2', null, 'Recent XP'));
      const list = el('div', 'rows');
      for (const e of data.recentEvents.slice(0, 15)) {
        const row = el('div', 'row');
        row.append(el('span', 'k', (e.name || e.userId || '?') + (e.mult ? ' · ×' + e.mult : '')));
        row.append(el('span', 'v', (e.xp > 0 ? '+' : '') + e.xp + ' XP · L' + (e.level ?? '—')));
        list.append(row);
      }
      ev.append(list);
      root.append(ev);
    }
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
