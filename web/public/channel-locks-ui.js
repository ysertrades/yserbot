'use strict';
/**
 * Channel locks — #channel-locks-root in Moderation.
 * Reads state.overview.mod (lexical `state` from app.js, not window.state).
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
    const fromMod = ov && ov.mod && Array.isArray(ov.mod.channels) ? ov.mod.channels : null;
    if (fromMod && fromMod.length) return fromMod;
    const L = ov && ov.features && ov.features.levels;
    if (L && Array.isArray(L.channelOpts) && L.channelOpts.length) return L.channelOpts;
    return [];
  }


  /** Match other panel pickers: #name, normalize odd separators for alignment */
  function channelLabel(c) {
    var raw = String((c && c.name) || (c && c.id) || '?');
    // Discord channel names often use ・ or · between emoji and text
    raw = raw.replace(/[\u30fb\u00b7\u2022\u2219]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (raw.charAt(0) === '#') return raw;
    return '#' + raw;
  }

  function wireCselect(root) {
    try {
      if (typeof enhanceSelects === 'function') enhanceSelects(root);
    } catch (e) {}
  }

  function injectStyles() {
    if (document.getElementById('channel-locks-css')) return;
    const s = document.createElement('style');
    s.id = 'channel-locks-css';
    s.textContent = [
      '#channel-locks-root .lock-form{display:flex;flex-direction:column;gap:.75rem}',
      '#channel-locks-root .lock-row{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}',
      '@media(max-width:640px){#channel-locks-root .lock-row{grid-template-columns:1fr}}',
      '#channel-locks-root .lock-row .field{display:flex;flex-direction:column;gap:.35rem;min-width:0}',
      '#channel-locks-root .lock-row .field>span{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;opacity:.7}',
      '#channel-locks-root select.lock-sel{width:100%;max-width:100%;box-sizing:border-box}',
      '#channel-locks-root .cselect{width:100%;max-width:100%}',
      '#channel-locks-root .cselect-trigger{width:100%;box-sizing:border-box}',
      '#channel-locks-root .cselect-value{font-variant-emoji:emoji;letter-spacing:0.01em}',
      '.cselect-menu .cselect-option{display:flex;align-items:center;gap:0.35rem;text-align:left;font-variant-emoji:emoji;line-height:1.35}',
      '#channel-locks-root .lock-actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}',
      '#channel-locks-root .lock-list{display:flex;flex-direction:column;gap:.5rem;margin-top:.35rem}',
      '#channel-locks-root .lock-card{display:flex;align-items:center;gap:.65rem;padding:.65rem .8rem;',
      '  border:1px solid var(--rule,rgba(255,255,255,.08));border-radius:10px;',
      '  background:var(--sunken,rgba(0,0,0,.25));min-width:0}',
      '#channel-locks-root .lock-card .lock-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:.15rem}',
      '#channel-locks-root .lock-card .lock-name{font-weight:600;font-size:.92rem;overflow:hidden;',
      '  text-overflow:ellipsis;white-space:nowrap}',
      '#channel-locks-root .lock-card .lock-sub{font-size:.75rem;opacity:.65;overflow:hidden;',
      '  text-overflow:ellipsis;white-space:nowrap}',
      '#channel-locks-root .lock-card .btn{flex-shrink:0}',
      '#channel-locks-root .lock-badge{font-size:.65rem;font-weight:700;letter-spacing:.04em;',
      '  padding:.15rem .45rem;border-radius:999px;background:rgba(251,191,36,.15);color:#fbbf24;flex-shrink:0}',
    ].join('');
    document.head.appendChild(s);
  }

  function render() {
    const root = document.getElementById('channel-locks-root');
    if (!root) return;
    injectStyles();

    const st = getState();
    const ov = st && st.overview;
    const m = (ov && ov.mod) || {};
    const locked = Array.isArray(m.lockedChannels) ? m.lockedChannels : [];
    const modes = [
      { id: 'media', label: 'Chat + media' },
      { id: 'full', label: 'Full lockdown' },
    ];

    root.replaceChildren();

    const head = el('div', 'queue-head');
    head.append(el('h2', null, 'Channel locks'));
    head.append(el('span', 'tag', locked.length ? String(locked.length) + ' locked' : 'Clear'));
    root.append(head);
    root.append(el('p', 'muted',
      '🔒 in Discord locks chat + media (reactions stay if allowed). 🔓 unlocks. List stays live.'));

    if (!ov) {
      root.append(el('p', 'hint', 'Loading server data…'));
      return;
    }

    const form = el('div', 'lock-form');
    const row = el('div', 'lock-row');

    const f1 = el('div', 'field');
    f1.append(el('span', null, 'Channel'));
    const chSel = document.createElement('select');
    chSel.className = 'lvl-input lock-sel';
    /* use panel cselect — do not set data-cselect */
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select channel…';
    chSel.append(blank);
    const opts = channelOptions();
    const _prevCh = chSel.value;
    for (let i = 0; i < opts.length; i++) {
      const c = opts[i];
      if (!c || !c.id) continue;
      const o = document.createElement('option');
      o.value = String(c.id);
      o.textContent = channelLabel(c);
      chSel.append(o);
    }
    if (_prevCh && Array.from(chSel.options).some(function (o) { return o.value === _prevCh; })) {
      chSel.value = _prevCh;
    }
    if (!opts.length) {
      const o = document.createElement('option');
      o.value = '';
      o.disabled = true;
      o.textContent = 'No channels available';
      chSel.append(o);
    }
    f1.append(chSel);

    const f2 = el('div', 'field');
    f2.append(el('span', null, 'Lock mode'));
    const modeSel = document.createElement('select');
    modeSel.className = 'lvl-input lock-sel';
    /* use panel cselect — do not set data-cselect */
    for (let i = 0; i < modes.length; i++) {
      const md = modes[i];
      const o = document.createElement('option');
      o.value = md.id;
      o.textContent = md.label;
      if (md.id === 'media') o.selected = true;
      modeSel.append(o);
    }
    f2.append(modeSel);

    row.append(f1, f2);
    form.append(row);

    const acts = el('div', 'lock-actions');
    const lockBtn = el('button', 'btn primary small', 'Lock channel');
    lockBtn.type = 'button';
    const unlockBtn = el('button', 'btn small', 'Unlock');
    unlockBtn.type = 'button';
    acts.append(lockBtn, unlockBtn);
    form.append(acts);
    root.append(form);
    wireCselect(form);

    async function run(op, forcedId) {
      let channelId = forcedId || chSel.value;
      if (!channelId && op === 'unlock' && locked.length === 1) {
        channelId = locked[0].channelId;
      }
      if (!channelId) {
        if (typeof toast === 'function') {
          toast(op === 'unlock' ? 'Pick a locked channel, or use Unlock on a row.' : 'Pick a channel first.', 'bad');
        }
        return;
      }
      lockBtn.disabled = unlockBtn.disabled = true;
      try {
        const body = { op: op, channelId: String(channelId) };
        if (op === 'lock') body.mode = modeSel.value || 'media';

        let out = null;
        if (typeof post === 'function') {
          out = await post('channellock', body, { quiet: true });
        } else {
          const s = getState();
          const headers = { 'content-type': 'application/json', 'x-csrf-token': (s && s.csrf) || '' };
          try { if (typeof authHeaders === 'function') Object.assign(headers, authHeaders()); } catch (e) {}
          const res = await fetch('/api/guild/' + (s && s.guildId) + '/channellock', {
            method: 'POST', credentials: 'same-origin', headers: headers, body: JSON.stringify(body),
          });
          out = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error((out && (out.detail || out.error)) || 'Request failed');
        }

        if (!out) return;

        if (out.error) {
          if (typeof toast === 'function') toast(String(out.detail || out.error), 'bad');
          return;
        }

        const s2 = getState();
        if (s2 && s2.overview) {
          if (!s2.overview.mod) s2.overview.mod = {};
          if (Array.isArray(out.lockedChannels)) {
            s2.overview.mod.lockedChannels = out.lockedChannels;
          } else if (out.overview && out.overview.mod && Array.isArray(out.overview.mod.lockedChannels)) {
            s2.overview.mod.lockedChannels = out.overview.mod.lockedChannels;
            if (Array.isArray(out.overview.mod.channels)) {
              s2.overview.mod.channels = out.overview.mod.channels;
            }
          }
        }
        render();
        if (typeof toast === 'function') {
          toast(op === 'lock' ? 'Channel locked.' : 'Channel unlocked.', 'good');
        }
      } catch (e) {
        const msg = (e && e.message) || 'Lock failed';
        if (typeof toast === 'function') {
          if (/reading ['"]?map['"]?/i.test(msg)) {
            toast(op === 'lock' ? 'Channel locked.' : 'Channel unlocked.', 'good');
            render();
          } else {
            toast(msg, 'bad');
          }
        }
      } finally {
        lockBtn.disabled = unlockBtn.disabled = false;
      }
    }

    lockBtn.addEventListener('click', function () { run('lock'); });
    unlockBtn.addEventListener('click', function () { run('unlock'); });

    const list = el('div', 'lock-list');
    if (!locked.length) {
      list.append(el('p', 'hint', 'No channels locked right now.'));
    } else {
      for (let i = 0; i < locked.length; i++) {
        const L = locked[i];
        const card = el('div', 'lock-card');
        const meta = el('div', 'lock-meta');
        meta.append(el('div', 'lock-name', channelLabel({ name: L.channelName, id: L.channelId })));
        const bits = [];
        bits.push(L.modeLabel || L.mode || 'lock');
        if (L.lockedByTag) bits.push(L.lockedByTag);
        if (L.timestamp) {
          try { bits.push(new Date(L.timestamp).toLocaleString()); } catch (e) {}
        }
        meta.append(el('div', 'lock-sub', bits.join(' · ')));
        card.append(meta);
        card.append(el('span', 'lock-badge', String(L.modeLabel || L.mode || 'LOCK').toUpperCase()));
        const ub = el('button', 'btn small', 'Unlock');
        ub.type = 'button';
        (function (id) {
          ub.addEventListener('click', function () { run('unlock', id); });
        })(L.channelId);
        card.append(ub);
        list.append(card);
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
      if (typeof get === 'function') data = await get('/api/guild/' + st.guildId);
      else {
        const res = await fetch('/api/guild/' + st.guildId, { credentials: 'same-origin' });
        data = await res.json();
      }
      if (!data || !data.mod) return;
      if (!st.overview) st.overview = data;
      else {
        if (!st.overview.mod) st.overview.mod = {};
        if (Array.isArray(data.mod.lockedChannels)) st.overview.mod.lockedChannels = data.mod.lockedChannels;
        if (Array.isArray(data.mod.channels)) st.overview.mod.channels = data.mod.channels;
      }
      render();
    } catch (e) {}
  }
  function startLive() {
    stopLive();
    liveTimer = setInterval(pullLocksLive, 10000);
  }
  function stopLive() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }
  function onModerationVisible() {
    render();
    startLive();
  }

  function boot() {
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

    const prev = window.showSection;
    if (typeof prev === 'function') {
      window.showSection = function (name) {
        const r = prev.apply(this, arguments);
        if (name === 'moderation') setTimeout(onModerationVisible, 40);
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
