'use strict';
/**
 * Channel locks desk — mounts at #channel-locks-root in Moderation.
 * Uses overview.mod.lockedChannels + post('channellock', …).
 * Does not touch app.js boot path.
 */
(function () {
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function channelOptions() {
    const L = window.state?.overview?.features?.levels;
    if (L?.channelOpts?.length) return L.channelOpts;
    return [];
  }

  function render() {
    const root = document.getElementById('channel-locks-root');
    if (!root || !window.state?.overview) return;
    const m = state.overview.mod || {};
    const locked = Array.isArray(m.lockedChannels) ? m.lockedChannels : [];
    const modes = Array.isArray(m.lockModes) && m.lockModes.length
      ? m.lockModes
      : [
          { id: 'chat', label: 'Chat only', blurb: 'Block Send Messages' },
          { id: 'media', label: 'Media', blurb: 'Block attachments & embeds' },
          { id: 'full', label: 'Full lock', blurb: 'View only for everyone' },
        ];

    root.replaceChildren();
    root.append(el('h2', null, 'Channel locks'));
    root.append(el('p', 'muted', 'Lock a channel from the panel or type 🔒 / 🔓 in Discord (admins). Live list stays in sync.'));

    const form = el('div', 'form lock-form');
    const chSel = document.createElement('select');
    chSel.className = 'lvl-input';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select channel…';
    chSel.append(blank);
    for (const c of channelOptions()) {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = '#' + (c.name || c.id);
      chSel.append(o);
    }
    const modeSel = document.createElement('select');
    modeSel.className = 'lvl-input';
    for (const md of modes) {
      const o = document.createElement('option');
      o.value = md.id;
      o.textContent = md.label + (md.blurb ? ' — ' + md.blurb : '');
      modeSel.append(o);
    }
    const lockBtn = el('button', 'btn primary small', 'Lock');
    lockBtn.type = 'button';
    const unlockBtn = el('button', 'btn small', 'Unlock');
    unlockBtn.type = 'button';

    async function run(op) {
      const channelId = chSel.value;
      if (!channelId) {
        if (typeof toast === 'function') toast('Pick a channel first.', 'bad');
        return;
      }
      lockBtn.disabled = unlockBtn.disabled = true;
      try {
        const body = { op, channelId };
        if (op === 'lock') body.mode = modeSel.value || 'chat';
        let out;
        if (typeof post === 'function') {
          out = await post('channellock', body);
        } else {
          const headers = { 'content-type': 'application/json', 'x-csrf-token': state.csrf || '' };
          try { if (typeof authHeaders === 'function') Object.assign(headers, authHeaders()); } catch {}
          const res = await fetch('/api/guild/' + state.guildId + '/channellock', {
            method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body),
          });
          out = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(out.detail || out.error || 'failed');
        }
        if (out && out.lockedChannels && state.overview.mod) {
          state.overview.mod.lockedChannels = out.lockedChannels;
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
    f1.append(el('span', null, 'Channel'), chSel);
    const f2 = el('div', 'field');
    f2.append(el('span', null, 'Lock mode'), modeSel);
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
      for (const L of locked) {
        const row = el('div', 'gaw');
        const top = el('div', 'gaw-top');
        top.append(el('span', 'nm', '#' + (L.channelName || L.channelId || '?')));
        top.append(el('span', 'kind sev-warn', (L.modeLabel || L.mode || 'lock').toUpperCase()));
        row.append(top);
        const bits = [];
        if (L.lockedByTag) bits.push('by ' + L.lockedByTag);
        if (L.timestamp) {
          try { bits.push(new Date(L.timestamp).toLocaleString()); } catch {}
        }
        if (bits.length) row.append(el('p', 'hint', bits.join(' · ')));
        const ub = el('button', 'btn small', 'Unlock');
        ub.type = 'button';
        ub.addEventListener('click', async function () {
          chSel.value = L.channelId;
          await run('unlock');
        });
        row.append(ub);
        list.append(row);
      }
    }
    root.append(list);
  }

  let liveTimer = null;
  async function pullLocksLive() {
    if (!document.querySelector('.section[data-section="moderation"][data-active]')) return;
    if (!state?.guildId) return;
    try {
      const data = await (typeof get === 'function'
        ? get('/api/guild/' + state.guildId)
        : fetch('/api/guild/' + state.guildId, { credentials: 'same-origin' }).then(function (r) { return r.json(); }));
      if (!data) return;
      state.overview = data;
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
  function boot() {
    document.addEventListener('panel-overview', render);
    const obs = new MutationObserver(function () {
      if (document.querySelector('.section[data-section="moderation"][data-active]')) {
        render();
        startLive();
      } else {
        stopLive();
      }
    });
    if (document.body) obs.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-active'] });
    const prev = window.showSection;
    if (typeof prev === 'function') {
      window.showSection = function (name) {
        const r = prev.apply(this, arguments);
        if (name === 'moderation') {
          setTimeout(render, 40);
          startLive();
        } else {
          stopLive();
        }
        return r;
      };
    }
    setTimeout(function () {
      render();
      if (document.querySelector('.section[data-section="moderation"][data-active]')) startLive();
    }, 800);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
