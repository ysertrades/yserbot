'use strict';

/* Control panel front-end. No framework, no build step — it renders four
   screens off two endpoints. Everything is read-only in this phase. */

const $ = sel => document.querySelector(sel);
const root = document.documentElement;

const LOGIN_ERRORS = {
  bad_state:    'That login link expired. Try again.',
  no_access:    'That account does not manage a server this bot is in.',
  login_failed: 'Discord rejected the login. Try again.',
};

/* ── helpers ───────────────────────────────────────────────────────────── */

// Everything rendered here comes from Discord (server names, usernames) and is
// attacker-controllable, so nothing is ever assigned as HTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(label, value, { dim = false } = {}) {
  const r = el('div', 'row');
  r.append(el('span', 'k', label));
  if (value instanceof Node) r.append(value);
  else r.append(el('span', `v${dim ? ' dim' : ''}`, value));
  return r;
}

function pill(on, onText = 'On', offText = 'Off') {
  return el('span', `pill ${on ? 'on' : 'off'}`, on ? onText : offText);
}

function chips(items) {
  const wrap = el('div', 'chips');
  if (items.length === 0) { wrap.append(el('span', null, 'none')); return wrap; }
  for (const it of items) {
    const label = typeof it === 'string' ? it : it.label;
    const span = el('span', typeof it === 'object' && it.known === false ? 'unknown' : null, label);
    if (typeof it === 'object' && it.known === false) span.title = 'This source is no longer available';
    wrap.append(span);
  }
  return wrap;
}

const num = n => n.toLocaleString();

function duration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

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

/* ── screens ───────────────────────────────────────────────────────────── */

function showLogin() {
  const params = new URLSearchParams(location.search);
  const code = params.get('error');
  if (code) {
    const p = $('#login-error');
    p.textContent = LOGIN_ERRORS[code] || 'Login failed.';
    p.hidden = false;
  }
  root.dataset.state = 'login';
}

function showSetup(missing) {
  const list = $('#setup-missing');
  list.replaceChildren(...missing.map(k => el('li', null, k)));
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

function renderGuildPicker(guilds, currentId, onPick) {
  const nav = $('#guilds');
  nav.replaceChildren(...guilds.map(g => {
    const b = el('button');
    b.type = 'button';
    if (g.icon) { const i = el('img'); i.src = g.icon; i.alt = ''; b.append(i); }
    b.append(el('span', null, g.name));
    if (g.id === currentId) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => onPick(g.id));
    return b;
  }));
}

function renderGuild(data) {
  $('#card-newsfeed').replaceChildren(
    row('Status', pill(data.newsfeed.enabled, 'Running', 'Stopped')),
    row('Channel', data.newsfeed.channel ? `#${data.newsfeed.channel}` : 'not set', { dim: !data.newsfeed.channel }),
    row('Sources', chips(data.newsfeed.sources)),
    row('Topics', chips(data.newsfeed.topics.length ? data.newsfeed.topics : ['all'])),
  );

  $('#card-econcal').replaceChildren(
    row('Status', pill(data.econcal.enabled, 'Running', 'Stopped')),
    row('Channel', data.econcal.channel ? `#${data.econcal.channel}` : 'not set', { dim: !data.econcal.channel }),
    row('Impact', chips(data.econcal.impact.length ? data.econcal.impact : ['all'])),
    row('Currencies', chips(data.econcal.currencies.length ? data.econcal.currencies : ['all'])),
    row('Weekly summary', pill(data.econcal.weeklyPost)),
  );

  $('#card-mod').replaceChildren(
    row('Log channel', data.modlog.channel ? `#${data.modlog.channel}` : 'not set', { dim: !data.modlog.channel }),
    row('Word filter', pill(data.automod.badWords)),
    row('Link filter', pill(data.automod.linkFilter)),
    row('Mention spam', pill(data.automod.mentionSpam)),
    row('Custom words', num(data.automod.customWords)),
  );

  $('#card-counts').replaceChildren(
    row('Shop items', num(data.counts.shopItems)),
    row('Embed templates', num(data.counts.embedTemplates)),
    row('Moderation cases', num(data.counts.moderationCases)),
    row('Members', num(data.guild.members)),
    row('Channels', num(data.guild.channels)),
  );
}

function renderBoard(data) {
  const list = $('#board');
  if (data.entries.length === 0) {
    list.replaceChildren(el('li', 'muted', 'No balances yet.'));
    return;
  }
  list.replaceChildren(...data.entries.map((e, i) => {
    const li = el('li');
    li.append(el('span', 'rank', `${i + 1}`));
    // Discord normally always gives a URL, but an <img src="null"> renders as
    // a broken-image glyph, which looks like a bug rather than a missing pic.
    if (e.avatar) { const img = el('img'); img.src = e.avatar; img.alt = ''; li.append(img); }
    li.append(el('span', 'name', e.name));
    li.append(el('span', 'bal', num(e.balance)));
    return li;
  }));
}

function renderHealth(h) {
  const cache = h.renderCache;
  $('#card-health').replaceChildren(
    row('Uptime', duration(h.uptimeMs)),
    row('Gateway ping', `${h.ping} ms`),
    row('Servers', num(h.guilds)),
    row('Memory', `${h.memoryMb} MB`),
    row('Renders served from cache', `${num(cache.hits)} / ${num(cache.hits + cache.misses)}`),
    row('Blocking time avoided', `${num(cache.blockingMsAvoided)} ms`),
  );
}

/* ── boot ──────────────────────────────────────────────────────────────── */

async function selectGuild(id, guilds) {
  history.replaceState(null, '', `?g=${id}`);
  renderGuildPicker(guilds, id, next => selectGuild(next, guilds));
  renderGuild(await get(`/api/guild/${id}`));
}

async function main() {
  let me;
  try {
    me = await get('/api/me');
  } catch (err) {
    if (err.status === 401) return showLogin();
    if (err.status === 503 && err.body?.missing) return showSetup(err.body.missing);
    return showLogin();
  }

  renderIdentity(me.user);
  root.dataset.state = 'panel';

  const wanted = new URLSearchParams(location.search).get('g');
  const first = me.guilds.some(g => g.id === wanted) ? wanted : me.guilds[0]?.id;
  if (first) await selectGuild(first, me.guilds);

  // Independent of the guild view — a slow avatar fetch shouldn't hold up the
  // config cards, and a failure in one shouldn't blank the other.
  get('/api/leaderboard').then(renderBoard).catch(() => {});
  get('/api/health').then(renderHealth).catch(() => {});
}

main().catch(err => {
  console.error(err);
  showLogin();
});
