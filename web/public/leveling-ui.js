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
  function render() {
    const root = document.getElementById('leveling-root');
    if (!root) return;
    const L = data();
    root.replaceChildren();
    if (!L) {
      root.append(el('p', 'muted', 'Leveling data unavailable. Enable Leveling & Ranks in Settings.'));
      return;
    }
    const hero = el('div', 'panel');
    hero.append(el('h2', null, 'Quantlab ranks'));
    hero.append(el('span', L.enabled ? 'pill on' : 'pill off', L.enabled ? 'Live' : 'Paused'));
    root.append(hero);
    root.append(el('p', 'hint', 'Full leveling UI loading. If this stays empty after refresh, restore leveling-ui.js from git history.'));
  }
  function boot() {
    document.addEventListener('panel-overview', render);
    setTimeout(render, 600);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
