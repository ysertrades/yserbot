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

const state = { csrf: null, guildId: null, guilds: [], overview: null, templates: [], tpl: null, copy: {} };

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
    tile(num(d.counts.shopItems), 'Shop items'),
    tile(num(d.counts.embedTemplates), 'Templates'),
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
    row('Channel', d.newsfeed.channel ? `#${d.newsfeed.channel}` : 'not set', { dim: !d.newsfeed.channel }),
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
    row('Channel', d.econcal.channel ? `#${d.econcal.channel}` : 'not set', { dim: !d.econcal.channel }),
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
