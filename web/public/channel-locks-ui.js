'use strict';
/**
 * Channel locks desk — mounts at #channel-locks-root in Moderation.
 * Uses overview.mod.lockedChannels + post('channellock', …).
 * Does not touch app.js boot path.
 *
 * IMPORTANT: app.js declares `const state` (global lexical, NOT window.state).
 * Always read `state` directly — never window.state.
 */
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function getState() {
    try { return typeof state !== 'undefined' ? state : null; } catch (e) { return null; }
  }

  function channelOptions() {
    const st = getState();
    const ov = st && st.overview;
    // Prefer mod.channels (always filled by moderation.read)
    const fromMod = ov && ov.mod && Array.isArray(ov.mod.channels) ? ov.mod.channels : null;
    if (fromMod && fromMod.length) return fromMod;
    const L = ov && ov.features && ov.features.levels;
    if (L && Array.isArray(L.channelOpts) && L.channelOpts.length) return L.channelOpts;
    return [];
  }

  function render() {
    const root = document.getElementById('channel-locks-root');
    if (!root) return;

    const st = getState();
    const ov = st && st.overview;
    const m = (ov && ov.mod) || {};
    const locked = Array.isArray(m.lockedChannels) ? m.lockedChannels : [];
    const fallbackModes = [
      { id: 'media', label: 'Chat + media' },
      { id: 'full', label: 'Full lockdown' },
    ];
    let modes = Array.isArray(m.lockModes) && m.lockModes.length ? m.lockModes : fallbackModes;
    modes = modes
      .filter(function (md) { return md && (md.id === 'media' || md.id === 'full'); })
      .map(function (md) {
        return {
          id: md.id,
          label: md.id === 'full' ? 'Full lockdown' : 'Chat + media',
        };
      });
    if (!modes.length) modes = fallbackModes;

    root.replaceChildren();

    const head = el('div', 'queue-head');
    head.append(el('h2', null, 'Channel locks'));
    head.append(el('span', 'tag', locked.length ? String(locked.length) + ' locked' : 'Clear'));
    root.append(head);
    root.append(el('p', 'muted',
      '🔒 in Discord locks chat + media (reactions stay if the channel already allows them). 🔓 unlocks. Panel stays live.'));

    if (!ov) {
      root.append(el('p', 'hint', 'Loading server data…'));
      return;
    }

    const form = el('div', 'form lock-form');
    const chSel = document.createElement('select');
    chSel.className = 'lvl-input';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select channel…';
    chSel.append(blank);
    const opts = channelOptions();
    for (const c of opts) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = '#' + (c.name || c.id);
      chSel.append(o);
    }
    if (!opts.length) {
      const o = document.createElement('option');
      o.value = '';
      o.disabled = true;
      o.textContent = 'No channels listed — switch guild or refresh';
      chSel.append(o);
    }

    const modeSel = document.createElement('select');
    modeSel.className = 'lvl-input';
    for (const md of modes) {
      const o = document.createElement('option');
      o.value = md.id;
      o.textContent = md.label;
      if (md.id === 'media') o.selected = true;
      modeSel.append(o);
    }

    const lockBtn = el('button', 'btn primary small', 'Lock channel');
    lockBtn.type = 'button';
    const unlockBtn = el('button', 'btn small', 'Unlock');
    unlockBtn.type = 'button';

    async function run(op) {
      let channelId = chSel.value;
      if (!channelId && op === 'unlock' && locked.length === 1) {
        channelId = locked[0].channelId;
      }
      if (!channelId) {
        if (typeof toast === 'function') toast(op === 'unlock' ? 'Pick a locked channel (or use Unlock on a row).' : 'Pick a channel first.', 'bad');
        return;
      }
      lockBtn.disabled = unlockBtn.disabled = true;
      try {
        const body = { op: op, channelId: channelId };
        if (op === 'lock') body.mode = modeSel.value || 'media';
        let out = null;
        if (typeof post === 'function') {
          out = await post('channellock', body);
          if (!out) return; // post already toasted
        } else {
          const s = getState();
          const headers = { 'content-type': 'application/json', 'x-csrf-token': (s && s.csrf) || '' };
          try { if (typeof authHeaders === 'function') Object.assign(headers, authHeaders()); } catch (e) {}
          const res = await fetch('/api/guild/' + (s && s.guildId) + '/channellock', {
            method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify(body),
          });
          out = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(out.detail || out.error || 'failed');
        }
        if (out && Array.isArray(out.lockedChannels)) {
          const s2 = getState();
          if (s2 && s2.overview) {
            if (!s2.overview.mod) s2.overview.mod = {};
            s2.overview.mod.lockedChannels = out.lockedChannels;
          }
        } else if (typeof refreshOverview === 'function') {
          await refreshOverview();
        }
        render();
        if (typeof toast === 'function') toast(op === 'lock' ? 'Channel locked.' : 'Channel unlocked.', 'good');
      } catch (e) {
        if (typeof toast === 'function') toast((e && e.message) || 'Lock failed', 'bad');
      } finally {
        lockBtn.disabled = unlockBtn.disabled = false;
      }
    }
    lockBtn.addEventListener('click', function () { run('lock'); });
    unlockBtn.addEventListener('click', function () { run('unlock'); });

    const row1 = el('div', 'lvl-nums');
    const f1 = el('div', 'field');
    f1.append(el('span', null, 'Channel'));
    f1.append(chSel);
    const f2 = el('div', 'field');
    f2.append(el('span', null, 'Lock mode'));
    f2.append(modeSel);
    row1.append(f1, f2);
    form.append(row1);
    const acts = el('div', 'actions');
    acts.append(lockBtn, unlockBtn);
    form.append(acts);
    root.append(form);

    const list = el('div', 'rows');
    if (!locked.length) {
      list.append(el('p', 'hint', 'No channels locked right now.'));
    } else {
      for (let i = 0; i < locked.length; i++) {
        const L = locked[i];
        const row = el('div', 'gaw');
        const top = el('div', 'gaw-top');
        top.append(el('span', 'nm', '#' + (L.channelName || L.channelId || '?')));
        top.append(el('span', 'kind sev-warn', String(L.modeLabel || L.mode || 'lock').toUpperCase()));
        row.append(top);
        const bits = [];
        if (L.lockedByTag) bits.push('by ' + L.lockedByTag);
        if (L.timestamp) {
          try { bits.push(new Date(L.timestamp).toLocaleString()); } catch (e) {}
        }
        if (bits.length) row.append(el('p', 'hint', bits.join(' · ')));
        const ub = el('button', 'btn small', 'Unlock');
        ub.type = 'button';
        (function (id) {
          ub.addEventListener('click', async function () {
            chSel.value = id;
            await run('unlock');
          });
        })(L.channelId);
        row.append(ub);
        list.append(row);
      }
    }
    root.append(list);
  }

  let liveTimer = null;
  async function pullLocksLive() {
    if (!document.querySelector('.section[data-section="moderation"][data-active]')) return;
    const st = getState();
    if (!st || !st.guildId) return;
    try {
      let data;
      if (typeof get === 'function') {
        data = await get('/api/guild/' + st.guildId);
      } else {
        const res = await fetch('/api/guild/' + st.guildId, { credentials: 'same-origin' });
        data = await res.json();
      }
      if (!data) return;
      st.overview = data;
      render();
    } catch (e) { /* keep last good list */ }
  }
  function startLive() {
    stopLive();
    liveTimer = setInterval(pullLocksLive, 8000);
  }
  function stopLive() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }

  function onModerationVisible() {
    render();
    startLive();
  }

  function boot() {
    try {
      const st = getState();
      if (st) {
        let _ov = st.overview;
        Object.defineProperty(st, 'overview', {
          configurable: true,
          enumerable: true,
          get: function () { return _ov; },
          set: function (v) {
            _ov = v;
            try { render(); } catch (e) {}
          },
        });
      }
    } catch (e) {}

    document.addEventListener('panel-overview', render);

    const obs = new MutationObserver(function () {
      if (document.querySelector('.section[data-section="moderation"][data-active]')) {
        onModerationVisible();
      } else {
        stopLive();
      }
    });
    if (document.body) {
      obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-active'] });
    }
    try {
      const rootEl = document.documentElement;
      const secObs = new MutationObserver(function () {
        if (rootEl.dataset.section === 'moderation') onModerationVisible();
        else stopLive();
      });
      secObs.observe(rootEl, { attributes: true, attributeFilter: ['data-section'] });
    } catch (e) {}

    const prev = window.showSection;
    if (typeof prev === 'function') {
      window.showSection = function (name) {
        const r = prev.apply(this, arguments);
        if (name === 'moderation') setTimeout(onModerationVisible, 30);
        else stopLive();
        return r;
      };
    }

    let tries = 0;
    const kick = setInterval(function () {
      tries += 1;
      render();
      if ((getState() && getState().overview) || tries > 40) clearInterval(kick);
    }, 500);

    setTimeout(function () {
      render();
      if (document.querySelector('.section[data-section="moderation"][data-active]')) startLive();
    }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
