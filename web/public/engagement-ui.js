'use strict';
/**
 * Engagement / Trading Rank panel UI.
 * Safe: does not touch boot / main() — only runs after data-state=panel.
 */

(function () {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function rankTrading() {
    try {
      return (window.state && state.overview && state.overview.features && state.overview.features.levels
        && state.overview.features.levels.trading) || null;
    } catch (e) { return null; }
  }

  function channelOpts(t) {
    const fromEngine = (t && t.channelOpts) || [];
    if (fromEngine.length) {
      return fromEngine.map(c => ({
        value: c.id,
        label: (c.kind === 'forum' ? 'Forum · ' : '#') + c.name,
        kind: c.kind || 'text',
      }));
    }
    return [];
  }

  function multiSelect(label, values, opts, onChange) {
    const box = el('div', 'field');
    box.append(el('label', null, label));
    const sel = document.createElement('select');
    sel.multiple = true;
    sel.size = Math.min(6, Math.max(3, opts.length || 3));
    const chosen = new Set(values || []);
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (chosen.has(o.value)) opt.selected = true;
      sel.append(opt);
    }
    const hint = el('p', 'hint', chosen.size
      ? [...chosen].map(id => (opts.find(o => o.value === id) || {}).label || id).join(' · ')
      : 'None selected — pick channels that count for XP');
    sel.addEventListener('change', () => {
      const ids = [...sel.selectedOptions].map(o => o.value);
      onChange(ids);
      hint.textContent = ids.length
        ? ids.map(id => (opts.find(o => o.value === id) || {}).label || id).join(' · ')
        : 'None selected — pick channels that count for XP';
    });
    box.append(sel, hint);
    return box;
  }

  function textField(label, value, onInput, placeholder) {
    const box = el('div', 'field');
    box.append(el('label', null, label));
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value == null ? '' : String(value);
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener('input', () => onInput(input.value));
    box.append(input);
    return box;
  }

  function modeButtons(draft) {
    const box = el('div', 'field');
    box.append(el('label', null, 'What earns XP'));
    const row = el('div', 'rank-mode-row');
    const hint = el('p', 'hint', '');
    function paint(v) {
      draft.mode = v;
      row.querySelectorAll('button').forEach(b => b.classList.toggle('primary', b.dataset.mode === v));
      hint.textContent = v === 'trading'
        ? 'Charts, journal posts, and QuantLab shares only. Chat spam earns nothing.'
        : 'Any message can earn XP (legacy — easier to farm).';
    }
    for (const [v, lab] of [['trading', 'Trading signals'], ['legacy', 'Any message']]) {
      const b = el('button', 'btn small' + (draft.mode === v ? ' primary' : ''), lab);
      b.type = 'button';
      b.dataset.mode = v;
      b.addEventListener('click', () => paint(v));
      row.append(b);
    }
    paint(draft.mode || 'trading');
    box.append(row, hint);
    return box;
  }

  function signalLegend(t) {
    const legend = el('div', 'rank-legend');
    legend.append(el('div', 'rank-legend-title', 'XP per signal (trading mode)'));
    const labels = {
      chart: 'Chart image', setup: 'Setup write-up', journal: 'Journal post',
      share: 'Trade share', journal_create: 'New journal thread', voice: 'Voice minute',
    };
    let rows = [];
    if (Array.isArray(t && t.signals)) {
      rows = t.signals.map(s => ({ key: s.type, min: s.baseMin, max: s.baseMax }));
    } else {
      rows = [
        { key: 'chart', min: 28, max: 40 },
        { key: 'setup', min: 22, max: 35 },
        { key: 'journal', min: 18, max: 28 },
        { key: 'share', min: 45, max: 60 },
      ];
    }
    for (const r of rows) {
      if (r.key === 'legacy') continue;
      legend.append(el('div', 'rank-legend-row',
        (labels[r.key] || r.key) + '  ·  ' + (r.min != null ? r.min : '—') + '–' + (r.max != null ? r.max : '—') + ' XP'));
    }
    return legend;
  }

  function saveBtn(draft) {
    const wrap = el('div', 'actions');
    const btn = el('button', 'btn primary', 'Save rank settings');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        if (typeof post !== 'function') throw new Error('post missing');
        const out = await post('leveltrading', {
          mode: draft.mode,
          dailyXpCap: draft.dailyXpCap,
          earnChannels: draft.earnChannels,
          forumChannels: draft.forumChannels,
          tradeShareChannels: draft.tradeShareChannels,
        });
        if (out && state.overview && state.overview.features && state.overview.features.levels && out.trading) {
          state.overview.features.levels.trading = out.trading;
        }
        renderEngagement();
      } catch (e) {
        console.warn('[engagement-ui] save', e);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save rank settings';
      }
    });
    wrap.append(btn);
    return wrap;
  }

  function renderEngagement() {
    try {
      const setup = document.getElementById('rank-setup');
      const board = document.getElementById('rank-board');
      if (!setup && !board) return;

      if (!window.state || !state.overview) {
        if (setup) setup.replaceChildren(el('p', 'muted', 'Loading server…'));
        return;
      }

      const t = rankTrading();
      const lv = state.overview.features && state.overview.features.levels;

      if (setup) {
        const draft = {
          mode: (t && t.mode) || 'trading',
          dailyXpCap: (t && t.dailyXpCap != null) ? t.dailyXpCap : 400,
          earnChannels: [].concat((t && t.sources && t.sources.earnChannels) || []),
          forumChannels: [].concat((t && t.sources && t.sources.forumChannels) || []),
          tradeShareChannels: [].concat((t && t.sources && t.sources.tradeShareChannels) || []),
        };
        const opts = channelOpts(t);
        const forums = opts.filter(o => o.kind === 'forum');
        const texts = opts.filter(o => o.kind !== 'forum');
        const nodes = [];

        nodes.push(modeButtons(draft));
        nodes.push(el('div', 'rank-section-label', 'Channels that count'));

        if (texts.length) {
          nodes.push(multiSelect('Chart & setup channels', draft.earnChannels, texts, ids => { draft.earnChannels = ids; }));
          nodes.push(multiSelect('QuantLab trade-share channels', draft.tradeShareChannels, texts, ids => { draft.tradeShareChannels = ids; }));
        } else {
          nodes.push(el('p', 'hint', 'No channels loaded yet. Wait a moment, then open Engagement again.'));
        }
        if (forums.length) {
          nodes.push(multiSelect('Journal forums (thread owner only)', draft.forumChannels, forums, ids => { draft.forumChannels = ids; }));
        }

        nodes.push(textField('Daily XP cap per member', String(draft.dailyXpCap), v => {
          draft.dailyXpCap = Math.max(0, Number(v) || 0);
        }, '400'));

        nodes.push(signalLegend(t));

        if (t && t.stats) {
          const strip = el('div', 'rank-stats');
          strip.append(el('span', null, (t.stats.tracked || 0) + ' ranked'));
          strip.append(el('span', null, (t.stats.todayXp || 0) + ' XP today'));
          strip.append(el('span', null, (t.stats.todayGrants || 0) + ' grants'));
          nodes.push(strip);
        }

        nodes.push(saveBtn(draft));
        setup.replaceChildren(...nodes);
      }

      if (board) {
        const tag = document.getElementById('rank-board-tag');
        const list = (t && t.leaderboard) || (lv && lv.leaderboard) || [];
        if (tag) tag.textContent = list.length ? String(list.length) : '0';
        if (!list.length) {
          board.replaceChildren(el('p', 'muted', 'Nobody ranked yet. Post a chart or journal entry in a tracked channel.'));
        } else {
          const table = el('div', 'rank-board-list');
          const numFn = (typeof num === 'function') ? num : (n => String(n));
          list.slice(0, 15).forEach((u, i) => {
            const row = el('div', 'rank-board-row');
            const left = el('div', 'rank-board-left');
            left.append(el('span', 'rank-board-pos', String(i + 1)));
            left.append(el('span', 'rank-board-name', u.name || u.id));
            left.append(el('span', 'rank-board-lvl', 'Lv ' + (u.level || 0)));
            row.append(left);
            row.append(el('span', 'rank-board-xp', numFn(u.totalXp || u.xp || 0) + ' XP'));
            table.append(row);
          });
          board.replaceChildren(table);
        }
      }
    } catch (e) {
      console.warn('[engagement-ui] render', e);
    }
  }

  window.renderEngagement = renderEngagement;

  function installHooks() {
    try {
      if (typeof window.showSection === 'function' && !window.showSection.__engagementWrapped) {
        const prevShow = window.showSection;
        const wrapped = function (name) {
          const r = prevShow.apply(this, arguments);
          if (name === 'engagement') {
            try { renderEngagement(); } catch (e) {}
            try { if (typeof renderLevels === 'function') renderLevels(); } catch (e) {}
          }
          return r;
        };
        wrapped.__engagementWrapped = true;
        window.showSection = wrapped;
      }
    } catch (e) {}
  }

  // Never run during boot — only after panel is signed in
  let tries = 0;
  const tick = setInterval(function () {
    tries++;
    installHooks();
    var ready = document.documentElement.dataset.state === 'panel';
    if (ready && window.state && state.overview) {
      try { renderEngagement(); } catch (e) {}
      clearInterval(tick);
    }
    if (tries > 60) clearInterval(tick);
  }, 400);
})();
