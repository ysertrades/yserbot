'use strict';

/* Control panel front-end. No framework, no build step.
   Every value shown here comes from Discord or from typed input, so nothing is
   ever assigned as HTML — el() builds nodes and sets textContent. */

const $ = sel => document.querySelector(sel);
const root = document.documentElement;

const LOGIN_ERRORS = {
  bad_state:    'That login link expired. Try again.',
  no_access:    'That account does not manage a server this bot is in.',
  login_failed: 'Discord rejected the login. Try again.',
};

const WRITE_ERRORS = {
  bad_channel:     'Pick a text channel that still exists.',
  no_sources:      'Keep at least one news source.',
  bad_price:       'Price must be a whole number.',
  bad_color:       'Colour needs to be a 6-digit hex code.',
  bad_csrf:        'Your session expired. Reload the page.',
  forbidden:       'You cannot change that server.',
  body_too_large:  'That is too much text.',
};

const state = {
  csrf: null, guildId: null, guilds: [], overview: null,
  templates: [], tpl: null, copy: {},   // Studio
  tplName: null, draft: null,           // Composer
};

/* ── dom helpers ───────────────────────────────────────────────────────── */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(label, value, { dim = false } = {}) {
  const r = el('div', 'row');
  r.append(el('span', 'k', label));
  r.append(value instanceof Node ? value : el('span', `v${dim ? ' dim' : ''}`, value));
  return r;
}

const pill = (on, onText = 'On', offText = 'Off') =>
  el('span', `pill ${on ? 'on' : 'off'}`, on ? onText : offText);

function chips(items) {
  const wrap = el('div', 'chips');
  if (!items.length) { wrap.append(el('span', null, 'none')); return wrap; }
  for (const it of items) {
    const isObj = typeof it === 'object';
    const span = el('span', isObj && it.known === false ? 'unknown' : null, isObj ? it.label : it);
    if (isObj && it.known === false) span.title = 'This source is no longer available';
    wrap.append(span);
  }
  return wrap;
}

const num = n => Number(n || 0).toLocaleString();

function duration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

let toastTimer;
function toast(message, kind = '') {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ── network ───────────────────────────────────────────────────────────── */

async function get(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) {
    const err = new Error(`${path} → ${res.status}`);
    err.status = res.status;
    err.body = await res.json().catch(() => ({}));
    throw err;
  }
  return res.json();
}

async function post(op, body) {
  const res = await fetch(`/api/guild/${state.guildId}/${op}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    toast(WRITE_ERRORS[data.error] || 'That change did not save.', 'bad');
    return null;
  }
  if (data.unchanged) { toast('Nothing to change.'); return data; }
  toast('Saved — logged to your mod channel.', 'good');
  if (data.overview) { state.overview = data.overview; renderOverview(); }
  return data;
}

/* ── the lattice ───────────────────────────────────────────────────────── */

// Same construction as the banner watermark: the wordmark repeated on rows
// that slide sideways, so the repeats fall on a diagonal rather than a grid.
function drawWeave() {
  const c = $('#weave');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  c.width = w * dpr; c.height = h * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = 'rgba(232,235,241,0.035)';
  const text = 'YSER FLOW';
  const pitch = ctx.measureText(text).width + 74;
  for (let i = 0, y = -20; y < h + 20; y += 46, i++) {
    const start = ((i * 43) % pitch) - pitch;
    ctx.globalAlpha = i % 2 === 0 ? 1 : 0.72;
    for (let x = start; x < w + pitch; x += pitch) ctx.fillText(text, x, y);
  }
}

/* ── screens ───────────────────────────────────────────────────────────── */

function showLogin() {
  const code = new URLSearchParams(location.search).get('error');
  if (code) {
    const p = $('#login-error');
    p.textContent = LOGIN_ERRORS[code] || 'Login failed.';
    p.hidden = false;
  }
  root.dataset.state = 'login';
}

function showSetup(missing) {
  $('#setup-missing').replaceChildren(...missing.map(k => el('li', null, k)));
  root.dataset.state = 'setup';
}

function renderIdentity(user) {
  const wrap = $('#bar-right');
  wrap.replaceChildren();
  if (user.avatar) {
    const img = el('img');
    img.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
    img.alt = '';
    wrap.append(img);
  }
  wrap.append(el('span', 'who', user.name));
  const out = el('a', 'btn small', 'Sign out');
  out.href = '/auth/logout';
  wrap.append(out);
}

function renderGuildPicker() {
  $('#guilds').replaceChildren(...state.guilds.map(g => {
    const b = el('button');
    b.type = 'button';
    if (g.icon) { const i = el('img'); i.src = g.icon; i.alt = ''; b.append(i); }
    b.append(el('span', null, g.name));
    if (g.id === state.guildId) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => selectGuild(g.id));
    return b;
  }));
}

/* ── overview ──────────────────────────────────────────────────────────── */

function tile(value, label, kind = '') {
  const t = el('div', `tile ${kind}`);
  t.append(el('div', 'n', value), el('div', 'l', label));
  return t;
}

function renderOverview() {
  const d = state.overview;
  if (!d) return;

  $('#crest').replaceChildren(...(d.guild.icon
    ? [Object.assign(el('img'), { src: d.guild.icon, alt: '' })]
    : [el('span', null, d.guild.name.slice(0, 1).toUpperCase())]));
  $('#server-name').textContent = d.guild.name;
  $('#server-meta').textContent = `${num(d.guild.members)} members · ${num(d.guild.channels)} channels`;

  $('#tiles').replaceChildren(
    tile(d.newsfeed.enabled ? 'LIVE' : 'OFF', 'News feed', d.newsfeed.enabled ? 'live' : 'idle'),
    tile(d.econcal.enabled ? 'LIVE' : 'OFF', 'Calendar', d.econcal.enabled ? 'live' : 'idle'),
    tile(num(d.counts.activeGiveaways), 'Giveaways', d.counts.activeGiveaways ? 'live' : 'idle'),
    tile(num(d.counts.embedTemplates), 'Messages'),
    tile(num(d.counts.shopItems), 'Shop items'),
    tile(num(d.counts.moderationCases), 'Mod cases'),
  );

  $('#card-systems').replaceChildren(
    row('News feed', pill(d.newsfeed.enabled, 'Running', 'Stopped')),
    row('Feed channel', d.newsfeed.channel ? `#${d.newsfeed.channel}` : 'not set', { dim: !d.newsfeed.channel }),
    row('Sources', chips(d.newsfeed.sources)),
    row('Calendar', pill(d.econcal.enabled, 'Running', 'Stopped')),
    row('Calendar channel', d.econcal.channel ? `#${d.econcal.channel}` : 'not set', { dim: !d.econcal.channel }),
    row('Mod log', d.modlog.channel ? `#${d.modlog.channel}` : 'not set', { dim: !d.modlog.channel }),
  );

  $('#card-counts').replaceChildren(
    row('Shop items', num(d.counts.shopItems)),
    row('Embed templates', num(d.counts.embedTemplates)),
    row('Moderation cases', num(d.counts.moderationCases)),
    row('Word filter', pill(d.automod.badWords)),
    row('Link filter', pill(d.automod.linkFilter)),
    row('Custom words', num(d.automod.customWords)),
  );

  renderFeedForms();
  renderModerationForm();
  renderShop();
  renderComposer();
  renderGiveaways();
  renderSettings();
  renderGroupForm('#form-casino', 'casino');
  renderGroupForm('#form-lottery', 'lottery');
  renderGroupForm('#form-cards', 'cards');
  renderGroupForm('#form-verify', 'verify');
  renderCoins();
  renderSchedules();
  renderAutoreplies();
  renderLevels();
  renderLevelRoles();
}

function renderBoard(data) {
  const list = $('#board');
  if (!data.entries.length) { list.replaceChildren(el('li', 'muted', 'No balances yet.')); return; }
  list.replaceChildren(...data.entries.map((e, i) => {
    const li = el('li');
    li.append(el('span', 'rank', `${i + 1}`));
    if (e.avatar) { const img = el('img'); img.src = e.avatar; img.alt = ''; li.append(img); }
    li.append(el('span', 'name', e.name), el('span', 'bal', num(e.balance)));
    return li;
  }));
}

function renderHealth(h) {
  const c = h.renderCache;
  $('#card-health').replaceChildren(
    row('Uptime', duration(h.uptimeMs)),
    row('Gateway ping', `${h.ping} ms`),
    row('Servers', num(h.guilds)),
    row('Memory', `${h.memoryMb} MB`),
    row('Cached renders', `${num(c.hits)} / ${num(c.hits + c.misses)}`),
    row('Blocking avoided', `${num(c.blockingMsAvoided)} ms`),
  );
}

/* ── forms ─────────────────────────────────────────────────────────────── */

function toggle(label, checked, onChange) {
  const l = el('label', 'toggle');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  l.append(el('span', null, label), input);
  return l;
}

function textField(label, value, onInput, { placeholder = '' } = {}) {
  const l = el('label', 'field');
  l.append(el('span', null, label));
  const input = el('input');
  input.type = 'text';
  input.value = value ?? '';
  input.placeholder = placeholder;
  input.addEventListener('input', () => onInput(input.value));
  l.append(input);
  return l;
}

function actions(onSave) {
  const wrap = el('div', 'actions');
  const save = el('button', 'btn primary small', 'Save changes');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    await onSave();
    save.disabled = false;
  });
  wrap.append(save);
  return wrap;
}

function renderFeedForms() {
  const d = state.overview;

  const nf = { enabled: d.newsfeed.enabled, filterTopics: d.newsfeed.topics.slice() };
  $('#form-newsfeed').replaceChildren(
    toggle('Feed running', nf.enabled, v => { nf.enabled = v; }),
    textField('Topics (comma separated, blank for all)', nf.filterTopics.join(', '),
      v => { nf.filterTopics = v.split(',').map(s => s.trim()).filter(Boolean); },
      { placeholder: 'forex, crypto' }),
    pickOne('Channel', 'channel', d.newsfeed.channelId, v => { nf.channelId = v; }),
    row('Sources', chips(d.newsfeed.sources)),
    actions(() => post('newsfeed', nf)),
  );

  const ec = {
    enabled: d.econcal.enabled,
    impactFilter: d.econcal.impact.slice(),
    currencyFilter: d.econcal.currencies.slice(),
  };
  $('#form-econcal').replaceChildren(
    toggle('Calendar running', ec.enabled, v => { ec.enabled = v; }),
    textField('Impact (high, medium, low — blank for all)', ec.impactFilter.join(', '),
      v => { ec.impactFilter = v.split(',').map(s => s.trim()).filter(Boolean); },
      { placeholder: 'high' }),
    textField('Currencies (blank for all)', ec.currencyFilter.join(', '),
      v => { ec.currencyFilter = v.split(',').map(s => s.trim()).filter(Boolean); },
      { placeholder: 'USD, EUR' }),
    pickOne('Channel', 'channel', d.econcal.channelId, v => { ec.channelId = v; }),
    actions(() => post('econcal', ec)),
  );
}

function renderModerationForm() {
  const d = state.overview;
  const m = {
    badWords: d.automod.badWords,
    linkFilter: d.automod.linkFilter,
    mentionSpamProtection: d.automod.mentionSpam,
    modLog: { ...d.modlog },
  };
  delete m.modLog.channel;

  $('#form-moderation').replaceChildren(
    toggle('Word filter', m.badWords, v => { m.badWords = v; }),
    toggle('Link filter', m.linkFilter, v => { m.linkFilter = v; }),
    toggle('Mention spam protection', m.mentionSpamProtection, v => { m.mentionSpamProtection = v; }),
    el('h2', null, 'Log these events'),
    toggle('Member joins and leaves', m.modLog.members, v => { m.modLog.members = v; }),
    toggle('Message edits and deletes', m.modLog.messages, v => { m.modLog.messages = v; }),
    toggle('Role changes', m.modLog.roles, v => { m.modLog.roles = v; }),
    toggle('Purges', m.modLog.purges, v => { m.modLog.purges = v; }),
    row('Log channel', d.modlog.channel ? `#${d.modlog.channel}` : 'not set', { dim: !d.modlog.channel }),
    actions(() => post('moderation', m)),
  );
}

function renderShop() {
  const list = $('#shop-list');
  const items = state.overview.shop || [];
  if (!items.length) { list.replaceChildren(el('p', 'muted', 'No shop items yet.')); return; }

  list.replaceChildren(...items.map(item => {
    const draft = { id: item.id, name: item.name, description: item.description, price: item.price };
    const d = el('details', 'item');
    const s = el('summary');
    s.append(
      el('span', 'emoji', item.emoji || '📦'),
      el('span', 'nm', item.name),
      el('span', 'pr', num(item.price)),
    );
    const body = el('div', 'body');
    body.append(
      textField('Name', item.name, v => { draft.name = v; }),
      textField('Description', item.description, v => { draft.description = v; }),
      textField('Price', String(item.price), v => { draft.price = Number(v); }),
      actions(() => post('shop', draft)),
    );
    d.append(s, body);
    return d;
  }));
}

/* ── composer ──────────────────────────────────────────────────────────────
   Embeds and buttons in one editor. They are two files on disk and two
   commands in Discord, but a message is both, so it is edited as both. */

function select(label, value, options, onChange, { blank = null } = {}) {
  const l = el('label', 'field');
  l.append(el('span', null, label));
  const s = el('select');
  if (blank !== null) { const o = el('option', null, blank); o.value = ''; s.append(o); }
  for (const opt of options) {
    const o = el('option', null, opt.label);
    o.value = opt.value;
    s.append(o);
  }
  s.value = value ?? '';
  s.addEventListener('change', () => onChange(s.value));
  l.append(s);
  return l;
}

/* Pickers. Nothing in this panel should ever ask for a raw snowflake — you
   cannot check one by eye, and a wrong digit fails silently at use time. */

const channelList = () => state.overview?.settings?.channels || [];
const roleList = () => state.overview?.settings?.roles || [];

function pickOne(label, kind, value, onChange, { blank = 'Not set' } = {}) {
  const items = kind === 'role' ? roleList() : channelList();
  return select(label, value || '',
    items.map(i => ({ value: i.id, label: kind === 'role' ? i.name : `#${i.name}` })),
    v => onChange(v || null), { blank });
}

/**
 * Multi-select as toggleable chips rather than a <select multiple>, which is
 * close to unusable on a phone — ctrl-click has no touch equivalent.
 */
function pickMany(label, kind, values, onChange) {
  const items = kind === 'role' ? roleList() : channelList();
  const chosen = new Set(values || []);
  const wrap = el('div', 'field');
  wrap.append(el('span', null, label));

  const box = el('div', 'chipset');
  if (!items.length) box.append(el('span', 'muted', kind === 'role' ? 'No roles found.' : 'No channels found.'));
  for (const i of items) {
    const b = el('button', 'chip-toggle', kind === 'role' ? i.name : `#${i.name}`);
    b.type = 'button';
    if (chosen.has(i.id)) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => {
      if (chosen.has(i.id)) { chosen.delete(i.id); b.removeAttribute('aria-pressed'); }
      else { chosen.add(i.id); b.setAttribute('aria-pressed', 'true'); }
      onChange([...chosen]);
    });
    box.append(b);
  }
  wrap.append(box);
  return wrap;
}

/** Member picker — a searchable datalist, since a server can have thousands. */
function pickMember(label, value, onChange) {
  const members = state.overview?.features?.members || [];
  const wrap = el('label', 'field');
  wrap.append(el('span', null, `${label} (${members.length} loaded)`));
  const input = el('input');
  input.type = 'text';
  input.setAttribute('list', 'member-options');
  input.placeholder = 'Start typing a name';
  input.addEventListener('input', () => {
    const hit = members.find(m => m.name === input.value);
    onChange(hit ? hit.id : null);
    input.classList.toggle('bad', !!input.value && !hit);
  });
  wrap.append(input);

  let dl = document.getElementById('member-options');
  if (!dl) { dl = el('datalist'); dl.id = 'member-options'; document.body.append(dl); }
  dl.replaceChildren(...members.map(m => { const o = el('option'); o.value = m.name; return o; }));
  return wrap;
}

function areaField(label, value, onInput, rows = 4) {
  const l = el('label', 'field');
  l.append(el('span', null, label));
  const t = el('textarea');
  t.rows = rows;
  t.value = value ?? '';
  t.addEventListener('input', () => onInput(t.value));
  l.append(t);
  return l;
}

function renderComposerIndex() {
  const wrap = $('#tpl-index');
  const list = state.overview?.composer || [];
  if (!list.length) { wrap.replaceChildren(el('p', 'muted', 'No messages yet.')); return; }
  wrap.replaceChildren(...list.map(t => {
    const b = el('button', 'tpl-entry');
    b.type = 'button';
    b.append(el('span', 'nm', t.name));
    const meta = el('span', 'mt');
    meta.textContent = `${t.embeds.length}▦ ${t.buttons.length}⬤ ${t.posts.length}↗`;
    meta.title = `${t.embeds.length} embeds · ${t.buttons.length} buttons · ${t.posts.length} posted`;
    b.append(meta);
    if (t.name === state.tplName) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => { state.tplName = t.name; state.draft = null; renderComposer(); });
    return b;
  }));
}

function newDraft(name = '') {
  return {
    name,
    embeds: [{ title: '', description: '', color: '#5865F2', footer: '', thumbnail: '', image: '', fields: [], timestamp: false }],
    buttons: [], posts: [],
  };
}

function renderComposer() {
  renderComposerIndex();
  const body = $('#composer-body');
  const list = state.overview?.composer || [];
  const meta = state.overview?.composerMeta;

  const tpl = state.draft || list.find(t => t.name === state.tplName);
  if (!tpl) {
    body.replaceChildren(el('p', 'muted', 'Pick a message on the left, or create a new one.'));
    return;
  }

  // Everything below edits this local copy; nothing is written until Save.
  const draft = state.draft || JSON.parse(JSON.stringify(tpl));
  state.draft = draft;

  const parts = [];

  /* -- name + embeds --------------------------------------------------- */
  const head = el('div', 'panel');
  head.append(el('h2', null, 'Message'));
  head.append(textField('Name (how you refer to it)', draft.name, v => { draft.name = v; }));

  draft.embeds.forEach((e, i) => {
    const box = el('details', 'embed-box');
    if (i === 0) box.open = true;
    const sum = el('summary');
    sum.append(el('span', 'swatch'), el('span', 'nm', e.title || `Embed ${i + 1}`));
    sum.querySelector('.swatch').style.background = e.color || '#5865F2';
    const inner = el('div', 'body');
    inner.append(
      textField('Title', e.title, v => { e.title = v; }),
      areaField('Description', e.description, v => { e.description = v; }, 5),
      textField('Colour (hex)', e.color, v => { e.color = v; }),
      textField('Footer', e.footer, v => { e.footer = v; }),
      select('Image', e.image || '', [
        ...(meta?.dynamicImages || []).map(d => ({ value: d, label: `Generated · ${d.slice(8)}` })),
      ], v => { e.image = v; }, { blank: 'None or paste a URL below' }),
      textField('Image URL (overrides the picker)', e.image && !e.image.startsWith('dynamic:') ? e.image : '', v => { if (v) e.image = v; }),
      textField('Thumbnail URL', e.thumbnail, v => { e.thumbnail = v; }),
      toggle('Show a timestamp', !!e.timestamp, v => { e.timestamp = v; }),
    );

    // Fields
    const fieldWrap = el('div', 'subfields');
    fieldWrap.append(el('h2', null, 'Fields'));
    e.fields = e.fields || [];
    e.fields.forEach((f, fi) => {
      const rowEl = el('div', 'subfield');
      rowEl.append(
        textField('Name', f.name, v => { f.name = v; }),
        textField('Value', f.value, v => { f.value = v; }),
        toggle('Inline', !!f.inline, v => { f.inline = v; }),
      );
      const del = el('button', 'btn small danger', 'Remove field');
      del.type = 'button';
      del.addEventListener('click', () => { e.fields.splice(fi, 1); renderComposer(); });
      rowEl.append(del);
      fieldWrap.append(rowEl);
    });
    const addField = el('button', 'btn small', 'Add field');
    addField.type = 'button';
    addField.addEventListener('click', () => { e.fields.push({ name: '', value: '', inline: false }); renderComposer(); });
    fieldWrap.append(addField);
    inner.append(fieldWrap);

    if (draft.embeds.length > 1) {
      const rm = el('button', 'btn small danger', 'Remove this embed');
      rm.type = 'button';
      rm.addEventListener('click', () => { draft.embeds.splice(i, 1); renderComposer(); });
      inner.append(rm);
    }

    box.append(sum, inner);
    head.append(box);
  });

  const addEmbed = el('button', 'btn small', 'Add embed');
  addEmbed.type = 'button';
  addEmbed.disabled = draft.embeds.length >= (meta?.limits?.embeds || 10);
  addEmbed.addEventListener('click', () => {
    draft.embeds.push({ title: '', description: '', color: '#5865F2', footer: '', thumbnail: '', image: '', fields: [], timestamp: false });
    renderComposer();
  });

  const saveRow = el('div', 'actions');
  const saveBtn = el('button', 'btn primary small', 'Save message');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const res = await post('template', { name: draft.name, embeds: draft.embeds });
    saveBtn.disabled = false;
    if (res?.ok) { state.tplName = draft.name; state.draft = null; renderComposer(); }
  });
  saveRow.append(addEmbed, saveBtn);

  if (!state.draft?.isNew && list.some(t => t.name === draft.name)) {
    const del = el('button', 'btn small danger', 'Delete message');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete "${draft.name}" and its buttons?`)) return;
      const res = await post('templatedelete', { name: draft.name });
      if (res?.ok) { state.tplName = null; state.draft = null; renderComposer(); }
    });
    saveRow.append(del);
  }
  head.append(saveRow);
  parts.push(head);

  /* -- buttons ---------------------------------------------------------- */
  const btnPanel = el('div', 'panel');
  btnPanel.append(el('h2', null, 'Buttons on this message'));
  const saved = list.find(t => t.name === draft.name);
  const savedButtons = saved?.buttons || [];

  if (!saved) {
    btnPanel.append(el('p', 'hint', 'Save the message first, then you can attach buttons to it.'));
  } else {
    if (!savedButtons.length) btnPanel.append(el('p', 'muted', 'No buttons yet.'));
    for (const b of savedButtons) {
      const d = el('details', 'item');
      const s = el('summary');
      s.append(
        el('span', `bstyle ${b.style.toLowerCase()}`, b.style),
        el('span', 'nm', b.label || b.id),
        el('span', 'pr', `${b.uses} uses`),
      );
      const inner = el('div', 'body');
      const draftBtn = { ...b, embedName: draft.name };
      inner.append(
        textField('Label', b.label, v => { draftBtn.label = v; }),
        textField('Emoji', b.emoji, v => { draftBtn.emoji = v; }),
        select('Style', b.style, (meta?.styles || []).map(x => ({ value: x, label: x })), v => { draftBtn.style = v; }),
        select('Does what', b.type, (meta?.types || []).map(x => ({ value: x, label: x })), v => { draftBtn.type = v; }),
        pickOne('Role it grants', 'role', b.roleId, v => { draftBtn.roleId = v; }, { blank: 'Not a role button' }),
        textField('URL (for link buttons)', b.url, v => { draftBtn.url = v; }),
      );
      const rowA = el('div', 'actions');
      const save = el('button', 'btn primary small', 'Save button');
      save.type = 'button';
      save.addEventListener('click', () => post('button', draftBtn));
      const rm = el('button', 'btn small danger', 'Remove');
      rm.type = 'button';
      rm.addEventListener('click', () => post('buttondelete', { id: b.id }));
      rowA.append(save, rm);
      inner.append(rowA);
      d.append(s, inner);
      btnPanel.append(d);
    }

    const add = el('details', 'item');
    const addSum = el('summary');
    addSum.append(el('span', 'nm', '+ Add a button'));
    const addBody = el('div', 'body');
    const nb = { embedName: draft.name, id: '', label: '', style: 'Primary', type: 'custom', emoji: '', roleId: '', url: '' };
    addBody.append(
      textField('Button id (letters, numbers, dashes)', '', v => { nb.id = v; }),
      textField('Label', '', v => { nb.label = v; }),
      textField('Emoji', '', v => { nb.emoji = v; }),
      select('Style', 'Primary', (meta?.styles || []).map(x => ({ value: x, label: x })), v => { nb.style = v; }),
      select('Does what', 'custom', (meta?.types || []).map(x => ({ value: x, label: x })), v => { nb.type = v; }),
      pickOne('Role it grants', 'role', '', v => { nb.roleId = v; }, { blank: 'Not a role button' }),
      textField('URL (link buttons)', '', v => { nb.url = v; }),
      actions(() => post('button', nb)),
    );
    add.append(addSum, addBody);
    btnPanel.append(add);
  }
  parts.push(btnPanel);

  /* -- send + live posts ------------------------------------------------ */
  if (saved) {
    const sendPanel = el('div', 'panel');
    sendPanel.append(el('h2', null, 'Send and update'));
    const target = { name: draft.name, channelId: '', content: '' };
    const channels = state.overview?.settings?.channels || [];
    sendPanel.append(
      select('Channel', '', channels.map(c => ({ value: c.id, label: `#${c.name}` })), v => { target.channelId = v; }, { blank: 'Pick a channel' }),
      textField('Text above the embed (optional)', '', v => { target.content = v; }),
    );
    const sendRow = el('div', 'actions');
    const sendBtn = el('button', 'btn primary small', 'Send to channel');
    sendBtn.type = 'button';
    sendBtn.addEventListener('click', async () => {
      if (!target.channelId) { toast('Pick a channel first.', 'bad'); return; }
      sendBtn.disabled = true;
      await post('send', target);
      sendBtn.disabled = false;
    });
    sendRow.append(sendBtn);
    sendPanel.append(sendRow);

    if (saved.posts.length) {
      sendPanel.append(el('h2', null, 'Already posted'));
      for (const p of saved.posts) {
        const line = el('div', 'post-row');
        const ch = channels.find(c => c.id === p.channelId);
        line.append(el('span', 'k', `#${ch?.name || p.channelId} · ${new Date(p.sentAt).toLocaleString()}`));
        const up = el('button', 'btn small', 'Push update');
        up.type = 'button';
        up.title = 'Re-render this template into the message that is already posted';
        up.addEventListener('click', () => post('updatepost', { channelId: p.channelId, messageId: p.messageId, name: draft.name }));
        line.append(up);
        sendPanel.append(line);
      }
    }
    parts.push(sendPanel);
  }

  body.replaceChildren(...parts);
}

/* ── giveaways ─────────────────────────────────────────────────────────── */

function timeLeft(ts) {
  if (!ts) return 'no end time';
  const ms = ts - Date.now();
  if (ms <= 0) return 'ending now';
  return `${duration(ms)} left`;
}

function renderGiveaways() {
  const g = state.overview?.giveaways || { active: [], ended: [] };

  const activeWrap = $('#gaw-active');
  if (!g.active.length) activeWrap.replaceChildren(el('p', 'muted', 'Nothing running.'));
  else activeWrap.replaceChildren(...g.active.map(x => {
    const d = el('div', 'gaw');
    const top = el('div', 'gaw-top');
    top.append(
      el('span', `kind ${x.kind}`, x.kind === 'coins' ? 'COINS' : 'PRIZE'),
      el('span', 'nm', x.title || 'Giveaway'),
    );
    d.append(top);
    d.append(el('p', 'hint', `${num(x.entrants)} entered · ${x.winners} winner${x.winners === 1 ? '' : 's'} · ${timeLeft(x.endsAt)}`));
    const act = el('div', 'actions');
    const end = el('button', 'btn small danger', 'End now');
    end.type = 'button';
    end.addEventListener('click', async () => {
      if (!confirm('End this giveaway and draw winners now?')) return;
      end.disabled = true;
      await post('giveawayend', { messageId: x.messageId, kind: x.kind });
      end.disabled = false;
    });
    act.append(end);
    d.append(act);
    return d;
  }));

  const endedWrap = $('#gaw-ended');
  if (!g.ended.length) endedWrap.replaceChildren(el('p', 'muted', 'Nothing finished yet.'));
  else endedWrap.replaceChildren(...g.ended.map(x => {
    const d = el('div', 'gaw');
    const top = el('div', 'gaw-top');
    top.append(
      el('span', `kind ${x.kind}`, x.kind === 'coins' ? 'COINS' : 'PRIZE'),
      el('span', 'nm', x.title || 'Giveaway'),
      el('span', 'idtag', x.shortId),
    );
    d.append(top);
    d.append(el('p', 'hint', `${num(x.entrants)} entered · ${x.winners} winner${x.winners === 1 ? '' : 's'}`));
    if (x.kind === 'coins') {
      const act = el('div', 'actions');
      const rr = el('button', 'btn small', 'Reroll');
      rr.type = 'button';
      rr.title = 'Draw new winners and pay them';
      rr.addEventListener('click', async () => {
        if (!confirm('Draw new winners? They get paid again.')) return;
        rr.disabled = true;
        await post('giveawayreroll', { shortId: x.shortId, kind: 'coins' });
        rr.disabled = false;
      });
      act.append(rr);
      d.append(act);
    }
    return d;
  }));
}

/* ── settings ──────────────────────────────────────────────────────────── */

function renderSettings() {
  const s = state.overview?.settings;
  if (!s) return;
  const draft = {};
  const form = $('#form-settings');
  const nodes = [];

  for (const f of s.fields) {
    const value = s.values[f.key];
    if (f.type === 'bool') {
      nodes.push(toggle(f.label, !!value, v => { draft[f.key] = v; }));
    } else if (f.type === 'channel') {
      nodes.push(select(f.label, value || '', s.channels.map(c => ({ value: c.id, label: `#${c.name}` })),
        v => { draft[f.key] = v || null; }, { blank: 'Not set' }));
    } else if (f.type === 'role') {
      nodes.push(select(f.label, value || '', s.roles.map(r => ({ value: r.id, label: r.name })),
        v => { draft[f.key] = v || null; }, { blank: 'Not set' }));
    } else if (f.type === 'roles') {
      nodes.push(pickMany(f.label, 'role', value || [], v => { draft[f.key] = v; }));
    } else if (f.type === 'choice') {
      nodes.push(select(f.label, value || f.choices[0], f.choices.map(c => ({ value: c, label: c })),
        v => { draft[f.key] = v; }));
    } else {
      nodes.push(textField(`${f.label}${f.min != null ? ` (${f.min}–${f.max})` : ''}`, value == null ? '' : String(value),
        v => { draft[f.key] = Number(v); }));
    }
  }

  nodes.push(actions(() => post('settings', draft)));
  form.replaceChildren(...nodes);
}

/* ── feature groups ────────────────────────────────────────────────────────
   Casino, lottery, cards and verification are all "a handful of typed
   settings", so one renderer covers them from the field descriptions the
   server sends. Adding the next one is a table entry in web/features.js. */

function renderGroupForm(target, groupName) {
  const g = state.overview?.features?.groups?.[groupName];
  const form = $(target);
  if (!g) { form.replaceChildren(el('p', 'muted', 'Not available.')); return; }

  const draft = { group: groupName };
  const nodes = g.fields.map(f => {
    const v = g.values[f.key];
    if (f.type === 'channel') return pickOne(f.label, 'channel', v, x => { draft[f.key] = x; });
    if (f.type === 'role') return pickOne(f.label, 'role', v, x => { draft[f.key] = x; });
    if (f.type === 'text') return areaField(f.label, v, x => { draft[f.key] = x; }, 4);
    return textField(`${f.label}${f.min != null ? ` (${f.min}–${f.max})` : ''}`,
      v == null ? '' : String(v), x => { draft[f.key] = Number(x); });
  });
  nodes.push(actions(() => post('feature', draft)));
  form.replaceChildren(...nodes);
}

function renderCoins() {
  const form = $('#form-coins');
  const draft = { mode: 'give', amount: 0, userId: null, everyone: false };

  const summary = el('p', 'hint', 'Pick someone, or apply to everyone.');
  const memberField = pickMember('Member', null, v => { draft.userId = v; });

  const everyone = toggle('Apply to every member', false, v => {
    draft.everyone = v;
    memberField.style.display = v ? 'none' : '';
    summary.textContent = v
      ? 'This will change the balance of every non-bot member. Set is unavailable in bulk.'
      : 'Pick someone, or apply to everyone.';
  });

  form.replaceChildren(
    select('What to do', 'give', [
      { value: 'give', label: 'Give coins' },
      { value: 'take', label: 'Take coins' },
      { value: 'set', label: 'Set balance to' },
    ], v => { draft.mode = v; }),
    textField('Amount', '0', v => { draft.amount = Number(v); }),
    memberField,
    everyone,
    summary,
    actions(async () => {
      if (!draft.everyone && !draft.userId) { toast('Pick a member first.', 'bad'); return; }
      const who = draft.everyone ? 'every member' : 'that member';
      if (!confirm(`${draft.mode === 'set' ? 'Set' : draft.mode === 'give' ? 'Give' : 'Take'} ${num(draft.amount)} coins — ${who}?`)) return;
      await post('coins', draft);
    }),
  );
}

/* ── automation ────────────────────────────────────────────────────────── */

function templateOptions() {
  return (state.overview?.composer || []).map(t => ({ value: t.name, label: t.name }));
}

function renderSchedules() {
  const list = $('#sched-list');
  const items = state.overview?.features?.schedules || [];
  if (!items.length) { list.replaceChildren(el('p', 'muted', 'No scheduled posts.')); return; }

  list.replaceChildren(...items.map(s => {
    const draft = { id: s.id, channelId: s.channelId, embedName: s.embedName, frequency: s.frequency };
    const d = el('details', 'item');
    const sum = el('summary');
    sum.append(
      el('span', 'bstyle secondary', s.frequency),
      el('span', 'nm', s.embedName),
      el('span', 'pr', s.channelName ? `#${s.channelName}` : 'channel gone'),
    );
    const body = el('div', 'body');
    body.append(
      select('Message to post', s.embedName, templateOptions(), v => { draft.embedName = v; }),
      pickOne('Channel', 'channel', s.channelId, v => { draft.channelId = v; }),
      select('How often', s.frequency,
        (state.overview.features.frequencies || []).map(f => ({ value: f, label: f })),
        v => { draft.frequency = v; }),
      el('p', 'hint', s.lastRun ? `Last posted ${new Date(s.lastRun).toLocaleString()}` : 'Has not run yet.'),
    );
    const act = el('div', 'actions');
    const save = el('button', 'btn primary small', 'Save');
    save.type = 'button';
    save.addEventListener('click', () => post('schedule', draft));
    const del = el('button', 'btn small danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this scheduled post?')) return;
      await post('schedule', { id: s.id, remove: true });
    });
    act.append(save, del);
    body.append(act);
    d.append(sum, body);
    return d;
  }));
}

function renderAutoreplies() {
  const list = $('#reply-list');
  const items = state.overview?.features?.autoreplies || [];
  const nodes = [];

  if (!items.length) nodes.push(el('p', 'muted', 'No auto-replies yet.'));
  for (const r of items) {
    const draft = { key: r.key, trigger: r.trigger, embedName: r.embedName, exact: r.exact, cooldown: r.cooldown, enabled: r.enabled };
    const d = el('details', 'item');
    const sum = el('summary');
    sum.append(
      el('span', `bstyle ${r.enabled ? 'success' : 'secondary'}`, r.enabled ? 'on' : 'off'),
      el('span', 'nm', r.trigger),
      el('span', 'pr', r.embedName),
    );
    const body = el('div', 'body');
    body.append(
      textField('Trigger phrase', r.trigger, v => { draft.trigger = v; }),
      select('Reply with', r.embedName, templateOptions(), v => { draft.embedName = v; }),
      textField('Cooldown (seconds)', String(r.cooldown), v => { draft.cooldown = Number(v); }),
      toggle('Whole message must match exactly', r.exact, v => { draft.exact = v; }),
      toggle('Enabled', r.enabled, v => { draft.enabled = v; }),
    );
    const act = el('div', 'actions');
    const save = el('button', 'btn primary small', 'Save');
    save.type = 'button';
    save.addEventListener('click', () => post('autoreply', draft));
    const del = el('button', 'btn small danger', 'Remove');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!confirm(`Remove the auto-reply for "${r.trigger}"?`)) return;
      await post('autoreply', { key: r.key, remove: true });
    });
    act.append(save, del);
    body.append(act);
    d.append(sum, body);
    nodes.push(d);
  }

  const add = el('details', 'item');
  const addSum = el('summary');
  addSum.append(el('span', 'nm', '+ Add an auto-reply'));
  const nb = { key: '', trigger: '', embedName: '', cooldown: 5, exact: false, enabled: true };
  const addBody = el('div', 'body');
  addBody.append(
    textField('Trigger phrase', '', v => { nb.key = v.toLowerCase(); nb.trigger = v; }),
    select('Reply with', '', templateOptions(), v => { nb.embedName = v; }, { blank: 'Pick a message' }),
    textField('Cooldown (seconds)', '5', v => { nb.cooldown = Number(v); }),
    toggle('Whole message must match exactly', false, v => { nb.exact = v; }),
    actions(() => post('autoreply', nb)),
  );
  add.append(addSum, addBody);
  nodes.push(add);

  list.replaceChildren(...nodes);
}

/* ── engagement ────────────────────────────────────────────────────────── */

function renderLevels() {
  const lv = state.overview?.features?.levels;
  const form = $('#form-levels');
  if (!lv) { form.replaceChildren(el('p', 'muted', 'Not available.')); return; }

  const draft = {};
  const nodes = lv.fields.map(f => textField(
    `${f.label} (${f.min}–${f.max})`,
    String(lv.values[f.key] ?? f.fallback ?? ''),
    v => { draft[f.key] = Number(v); },
  ));
  nodes.push(el('p', 'hint', `${num(lv.tracked)} members are being tracked.`));
  nodes.push(actions(() => post('levels', draft)));
  form.replaceChildren(...nodes);
}

function renderLevelRoles() {
  const lv = state.overview?.features?.levels;
  const list = $('#levelroles');
  const nodes = [];

  if (!lv?.roles?.length) nodes.push(el('p', 'muted', 'No level rewards set.'));
  for (const r of (lv?.roles || [])) {
    const line = el('div', 'post-row');
    line.append(el('span', 'k', `Level ${r.level} → ${r.roleName || 'role deleted'}`));
    const del = el('button', 'btn small danger', 'Remove');
    del.type = 'button';
    del.addEventListener('click', () => post('levelrole', { level: r.level, remove: true }));
    line.append(del);
    nodes.push(line);
  }

  const add = el('details', 'item');
  const sum = el('summary');
  sum.append(el('span', 'nm', '+ Reward a role at a level'));
  const nb = { level: 5, roleId: null };
  const body = el('div', 'body');
  body.append(
    textField('Level', '5', v => { nb.level = Number(v); }),
    pickOne('Role to grant', 'role', '', v => { nb.roleId = v; }, { blank: 'Pick a role' }),
    actions(() => post('levelrole', nb)),
  );
  add.append(sum, body);
  nodes.push(add);

  list.replaceChildren(...nodes);
}

/* ── studio ────────────────────────────────────────────────────────────── */

let previewTimer = null;
let previewSeq = 0;

function requestPreview() {
  clearTimeout(previewTimer);
  $('#stage-busy').hidden = false;
  // Debounced, because each distinct render blocks the same thread that answers
  // Discord. Typing should cost one render when you stop, not one per key.
  previewTimer = setTimeout(loadPreview, 320);
}

async function loadPreview() {
  const seq = ++previewSeq;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state.copy)) if (v) params.set(k, v);
  const url = `/api/preview/${state.tpl.key}?${params}`;

  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.status === 429) {
      // The server is pacing renders. Wait exactly as long as it asked.
      const { retryAfterMs } = await res.json();
      previewTimer = setTimeout(loadPreview, (retryAfterMs || 250) + 40);
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (seq !== previewSeq) return; // a newer edit already won
    const objectUrl = URL.createObjectURL(blob);
    const img = $('#preview');
    const previous = img.src;
    img.src = objectUrl;
    if (previous.startsWith('blob:')) URL.revokeObjectURL(previous);
    $('#preview-download').href = objectUrl;
    $('#preview-download').download = `${state.tpl.key}_banner.png`;
    $('#preview-status').textContent = res.headers.get('x-render-cached') === 'true' ? 'Live preview · cached' : 'Live preview';
  } catch {
    $('#preview-status').textContent = 'Preview failed — try editing again.';
  } finally {
    if (seq === previewSeq) $('#stage-busy').hidden = true;
  }
}

function renderStudioFields() {
  const wrap = $('#tpl-fields');
  wrap.replaceChildren(...Object.keys(state.tpl.defaults).map(field => {
    const limit = state.tpl.limits[field];
    const l = el('label', 'field');
    const head = el('div', 'field-head');
    const count = el('span', 'count');
    head.append(el('span', null, field[0].toUpperCase() + field.slice(1)), count);
    l.append(head);

    const long = field === 'tagline';
    const input = el(long ? 'textarea' : 'input');
    if (!long) input.type = 'text';
    input.maxLength = limit;
    input.value = state.copy[field] ?? state.tpl.defaults[field];
    const sync = () => { count.textContent = `${input.value.length}/${limit}`; };
    sync();
    input.addEventListener('input', () => {
      // Upper-cased live, because the pixel font has no lower case — the field
      // should say what the image will say.
      const caret = input.selectionStart;
      input.value = input.value.toUpperCase();
      input.setSelectionRange(caret, caret);
      state.copy[field] = input.value;
      sync();
      requestPreview();
    });
    l.append(input);
    return l;
  }));
}

function selectTemplate(key) {
  state.tpl = state.templates.find(t => t.key === key) || state.templates[0];
  state.copy = { ...state.tpl.defaults };
  renderStudioFields();
  loadPreview();
}

async function initStudio() {
  const { templates } = await get('/api/templates');
  state.templates = templates;
  const select = $('#tpl-select');
  select.replaceChildren(...templates.map(t => {
    const o = el('option', null, t.label);
    o.value = t.key;
    return o;
  }));
  select.addEventListener('change', () => selectTemplate(select.value));
  $('#tpl-reset').addEventListener('click', () => selectTemplate(state.tpl.key));
  selectTemplate(templates[0].key);
}

/* ── boot ──────────────────────────────────────────────────────────────── */

function initSections() {
  for (const b of document.querySelectorAll('#sections button')) {
    b.addEventListener('click', () => {
      root.dataset.section = b.dataset.goto;
      for (const other of document.querySelectorAll('#sections button')) {
        other.toggleAttribute('aria-current', other === b);
        if (other === b) other.setAttribute('aria-current', 'true');
      }
      history.replaceState(null, '', `?g=${state.guildId}&s=${b.dataset.goto}`);
    });
  }
}

async function selectGuild(id) {
  state.guildId = id;
  history.replaceState(null, '', `?g=${id}&s=${root.dataset.section}`);
  renderGuildPicker();
  state.overview = await get(`/api/guild/${id}`);
  renderOverview();
}

async function main() {
  drawWeave();
  window.addEventListener('resize', drawWeave);

  let me;
  try {
    me = await get('/api/me');
  } catch (err) {
    if (err.status === 503 && err.body?.missing) return showSetup(err.body.missing);
    return showLogin();
  }

  state.csrf = me.csrf;
  state.guilds = me.guilds;
  renderIdentity(me.user);
  initSections();
  $('#tpl-new').addEventListener('click', () => {
    state.tplName = null;
    state.draft = { ...newDraft(''), isNew: true };
    renderComposer();
  });
  root.dataset.state = 'panel';

  const params = new URLSearchParams(location.search);
  const wanted = params.get('g');
  const section = params.get('s');
  if (section && document.querySelector(`#sections button[data-goto="${section}"]`)) {
    root.dataset.section = section;
    for (const b of document.querySelectorAll('#sections button')) {
      if (b.dataset.goto === section) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    }
  }

  const first = me.guilds.some(g => g.id === wanted) ? wanted : me.guilds[0]?.id;
  if (first) await selectGuild(first);

  // Independent of the guild view, so one slow call never blanks the others.
  get('/api/leaderboard').then(renderBoard).catch(() => {});
  get('/api/health').then(renderHealth).catch(() => {});
  initStudio().catch(() => {});
}

main().catch(err => { console.error(err); showLogin(); });
