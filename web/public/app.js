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
  bad_mention:     'Pick a role that still exists, or @everyone / @here.',
  no_sources:      'Keep at least one news source.',
  bad_price:       'Price must be a whole number.',
  bad_number:      'That number is outside the range this setting allows.',
  bad_weight:      'A rarity weight has to be between 0 and 1000.',
  bad_rarity:      'Could not read the rarity table.',
  bad_cards:       'Could not read the card list.',
  no_weight:       'Give at least one rarity a weight above zero, or nothing could drop.',
  no_cards:        'Leave at least one card switched on.',
  bad_color:       'Colour needs to be a 6-digit hex code.',
  bad_csrf:        'Your session expired. Reload the page.',
  forbidden:       'You cannot change that server.',
  body_too_large:  'That is too much text.',
  unknown_giveaway: 'That giveaway is no longer listed.',
  channel_gone:    'The channel that giveaway was posted in is gone.',
  message_deleted: 'The giveaway message was deleted, so there is nothing to end.',
  end_failed:      'Could not end that giveaway.',
  reroll_failed:   'Could not reroll that giveaway.',
  launch_failed:   'Could not start that giveaway.',
  all_jobs_closed: 'Leave at least one job hiring.',
  min_above_max:   'The lowest value is above the highest.',
  bad_duration:    'Use a duration like 30s, 10m, 6h or 2d.',
  empty_window:    'Boost hour needs a start and an end that differ.',
  bad_image:       'The image must be a link starting with https, or one of the generated banners.',
  bad_thumbnail:   'The thumbnail must be a link starting with https — generated banners are too wide to use as one.',
  bad_footerIcon:  'The footer icon must be a link starting with https.',
  bad_authorIcon:  'The author icon must be a link starting with https.',
  bad_titleUrl:    'The title link must start with https.',
  bad_authorUrl:   'The author link must start with https.',
  unknown_template: 'That template no longer exists.',
  unknown_activity: 'That is not something the economy knows about.',
  unknown_group:   'That settings group no longer exists.',
};

// Inside someone else's iframe the session cookie may never be sent — Safari
// drops third-party cookies entirely. The popup login hands the same signed
// token back through postMessage, and it rides in a header from then on.
const embedded = window.self !== window.top;

// Kept so you are not signing in every time the panel opens.
//
// Inside a third-party iframe this is not reliable on its own: Safari's
// Prevent Cross-Site Tracking — on by default — can block localStorage in an
// embedded frame outright, and setItem simply throws. That is why the login
// never stuck inside Whop, and why storageWorks is tracked rather than the
// failure being swallowed: if the store is unavailable the panel falls back to
// asking for storage access instead of silently making you sign in again.
const STORE_KEY = 'yserflow.session';
let storageWorks = true;

const remember = t => {
  try {
    if (t) localStorage.setItem(STORE_KEY, t);
    else localStorage.removeItem(STORE_KEY);
    storageWorks = true;
  } catch {
    storageWorks = false;
  }
};

const recall = () => {
  try { return localStorage.getItem(STORE_KEY); }
  catch { storageWorks = false; return null; }
};

/**
 * Asks the browser to let this frame use its own first-party storage.
 *
 * This is the Storage Access API, which exists for exactly this situation: an
 * embedded frame that legitimately owns a session on its own domain. Granting
 * it makes the SameSite=None cookie start being sent, so the session persists
 * across closing and reopening the host app without another Discord round
 * trip. It must be called from a real user gesture, which is why it hangs off
 * the sign-in button rather than running on load.
 */
async function requestStorage() {
  try {
    if (typeof document.hasStorageAccess !== 'function') return false;
    if (await document.hasStorageAccess()) return true;
    await document.requestStorageAccess();
    storageWorks = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * The last resort, on browsers old enough to drop a partitioned cookie and
 * strict enough to block localStorage in a frame.
 *
 * It is a button rather than something automatic because requestStorageAccess
 * only resolves from a real user gesture — and because a permission prompt
 * nobody asked for is worse than one attached to something they tapped. It
 * shows up only once the panel is open and both quiet mechanisms have already
 * failed, so most people never see it.
 */
function offerStorageAccess() {
  if (!embedded || storageWorks) return;
  if (document.querySelector('.storage-nudge')) return;

  const note = el('div', 'panel storage-nudge');
  note.append(el('p', 'muted', 'Your browser is blocking this panel from remembering you here, so you will have to sign in again next time.'));
  const btn = el('button', 'btn', 'Keep me signed in');
  btn.addEventListener('click', async () => {
    btn.textContent = 'Asking…';
    const ok = await requestStorage();
    if (ok) { remember(state.token); }
    if (storageWorks) note.remove();
    else btn.textContent = 'Not allowed — try again';
  });
  note.append(btn);
  $('#server').before(note);
}

// A token riding in the URL, from a Whop embed link. This is Whop's own
// settings reloading the same URL every time the app opens, not anything the
// browser remembered — so it takes priority over whatever storage did or
// didn't manage to hold onto.
const urlToken = new URLSearchParams(location.search).get('t');
if (urlToken) {
  const clean = new URL(location.href);
  clean.searchParams.delete('t');
  history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
}

const state = {
  csrf: null, token: urlToken || recall(), guildId: null, guilds: [], overview: null,
  me: null,                             // who is signed in, for {user} previews
  templates: [], tpl: null, copy: {},   // Studio
  tplName: null, draft: null,           // Composer
  styleKey: null,                       // Appearance — the message being edited
  socialDraft: null,                    // Social — the account being added
  socialTests: {},                       // Social — the result of each account's Test
  liveOn: false,                        // whether the push stream is connected
  socialOpen: new Set(),                // Social — which account cards are open
  openFolds: new Set(),                 // which fold-away sections are open
  gawBump: null,                        // redraw the giveaway preview on demand
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

const authHeaders = () => (state.token ? { authorization: `Bearer ${state.token}` } : {});

async function get(path) {
  const res = await fetch(path, { credentials: 'same-origin', headers: authHeaders() });
  if (!res.ok) {
    const err = new Error(`${path} → ${res.status}`);
    err.status = res.status;
    err.body = await res.json().catch(() => ({}));
    throw err;
  }
  return res.json();
}

/**
 * @param {object} opts
 *   quiet — no "Saved" toast. For the operations that read rather than write:
 *           testing a feed and checking the bridge both go through this
 *           endpoint, and telling somebody their change was saved when they
 *           pressed Test is simply untrue.
 */
async function post(op, body, { quiet = false } = {}) {
  const res = await fetch(`/api/guild/${state.guildId}/${op}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': state.csrf, ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The detail is the reason the bot actually gave. "That change did not
    // save" told you nothing about why, and the why was sitting right there in
    // the response the whole time.
    const known = WRITE_ERRORS[data.error];
    const why = typeof data.detail === 'string' && data.detail.trim() ? data.detail.trim() : null;
    toast([known || 'That change did not save.', why].filter(Boolean).join(' — '), 'bad');
    return null;
  }
  if (data.unchanged) { if (!quiet) toast('Nothing to change.'); return data; }
  if (!quiet) toast('Saved — logged to your mod channel.', 'good');
  if (data.overview) { state.overview = data.overview; renderOverview(); }
  return data;
}

/* ── the sheet ─────────────────────────────────────────────────────────────
   A single overlay shared by the giveaway detail and the embed preview.

   Focus is moved into it and restored on close, and Escape / the scrim / the
   close button all dismiss it — a modal that traps you is worse than no modal.
   `onClose` is how a caller cleans up after itself (revoking an object URL,
   say) no matter which of those three routes was taken. */

let sheetReturnFocus = null;
let sheetOnClose = null;

function closeSheet() {
  const wrap = $('#sheet');
  if (wrap.hidden) return;
  wrap.hidden = true;
  $('#sheet-body').replaceChildren();
  $('#sheet-actions').replaceChildren();
  const after = sheetOnClose;
  sheetOnClose = null;
  try { sheetReturnFocus?.focus?.(); } catch { /* the element may be gone */ }
  sheetReturnFocus = null;
  after?.();
}

/**
 * @param {string} title
 * @param {Node[]} body    rows to show
 * @param {Node[]} actions buttons for the footer
 * @param {Function} [onClose]
 */
function openSheet(title, body, actions = [], onClose = null) {
  const wrap = $('#sheet');
  sheetReturnFocus = document.activeElement;
  sheetOnClose = onClose;
  $('#sheet-title').textContent = title;
  $('#sheet-body').replaceChildren(...body);
  $('#sheet-actions').replaceChildren(...actions);
  wrap.hidden = false;
  // The close button is the one control guaranteed to exist, so it is the
  // safe place to land focus.
  $('#sheet-close').focus();
}

function initSheet() {
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-scrim').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  });
}

/**
 * Asks before doing something, without window.confirm.
 *
 * confirm() is unusable here. Inside Whop's app the panel runs in a native
 * WKWebView, and a WKWebView only shows a JavaScript dialog if the host app
 * implements the delegate for it — Whop's does not, so confirm() returns false
 * the instant it is called. Every `if (!confirm(...)) return;` in this file was
 * therefore a button that did nothing at all inside the embed, with no error
 * and nothing in the console to explain it.
 *
 * This is the same sheet everything else uses, so it works wherever the panel
 * renders at all.
 *
 * @returns {Promise<boolean>}
 */
function askConfirm({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    let answered = false;
    const done = value => { answered = true; resolve(value); };

    const go = el('button', `btn ${danger ? 'danger' : 'primary'}`, confirmLabel);
    go.type = 'button';
    go.addEventListener('click', () => { done(true); closeSheet(); });

    const cancel = el('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { done(false); closeSheet(); });

    // Dismissing by scrim, Escape or the close button is a "no" — and has to
    // resolve, or the caller waits forever.
    openSheet(title, [el('p', 'muted', message)], [go, cancel],
      () => { if (!answered) resolve(false); });
  });
}

/** A labelled row for sheet bodies, matching the panel's own row styling. */
function sheetRow(label, value) {
  const r = el('div', 'row');
  r.append(el('span', 'k', label));
  r.append(value instanceof Node ? value : el('span', 'v', String(value)));
  return r;
}

/* ── screens ───────────────────────────────────────────────────────────── */

function showLogin() {
  if (embedded) wireEmbeddedLogin();

  const code = new URLSearchParams(location.search).get('error');
  if (code) {
    const p = $('#login-error');
    p.textContent = LOGIN_ERRORS[code] || 'Login failed.';
    p.classList.remove('soft');
    p.hidden = false;
  } else if (embedded) {
    // Set expectations before the tab switch, rather than leaving you looking
    // at a page that appears to have done nothing.
    const p = $('#login-error');
    p.textContent = 'This opens Discord in a new tab. Come back here once it says you are signed in.';
    p.classList.add('soft');
    p.hidden = false;
  }
  root.dataset.state = 'login';
}

/**
 * The sign-in button inside a host page.
 *
 * It has to stay a plain link. Opening the login from JavaScript works only
 * while the click's user activation is still live, and every `await` in front
 * of it spends that activation — the browser then blocks the new tab without
 * saying anything, so the panel sat on "Waiting for Discord…" while nothing
 * had actually opened. Building the href up front lets the browser perform the
 * navigation itself, which no amount of asynchronous work beforehand can
 * cancel. The handler is left with one job: start collecting the result.
 *
 * The handoff id has to be minted here for the same reason — it is part of the
 * URL the browser is about to follow.
 */
function wireEmbeddedLogin() {
  const link = document.querySelector('.view[data-view="login"] .btn.primary');
  if (!link || link.dataset.wired) return;
  link.dataset.wired = '1';

  const id = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now()).replace(/-/g, '');
  link.href = `/auth/login?popup=1&h=${id}`;
  link.target = '_blank';
  // Deliberately no rel="noopener": where the opener does survive, the login
  // page posts the session straight back and the poll never has to run.

  link.addEventListener('click', () => pollHandoff(id));
}

/**
 * Collecting the session the login tab leaves behind.
 *
 * On iOS the login opens a whole new Safari tab with no opener relationship,
 * so postMessage has nobody to reach. The page therefore hands a random id to
 * the login and polls for the finished session against that id. postMessage
 * still works when there is an opener; this is the path that works when there
 * isn't.
 */
let handoffTimer = null;

function pollHandoff(id) {
  const started = Date.now();
  clearInterval(handoffTimer);
  const status = $('#login-error');
  status.hidden = false;
  status.classList.add('soft');
  status.textContent = 'Waiting for Discord… you can come back to this tab once it says you are signed in.';

  handoffTimer = setInterval(async () => {
    if (Date.now() - started > 120000) {
      clearInterval(handoffTimer);
      status.textContent = 'That took too long. Tap sign in to try again.';
      return;
    }
    try {
      const res = await fetch(`/auth/handoff?h=${id}`, { credentials: 'same-origin' });
      if (res.status !== 200) return;
      const { token } = await res.json();
      if (!token) return;
      clearInterval(handoffTimer);
      status.hidden = true;
      state.token = token;
      remember(token);
      // The first /api/me carrying this token is what plants the partitioned
      // cookie, which is what makes the session outlive the app being closed.
      main().catch(() => {});
    } catch { /* keep polling */ }
  }, 1500);
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
  // Still an anchor, so a browser with no JavaScript can sign out of a cookie
  // session by following it. With JavaScript the click is taken over below,
  // because a plain navigation sends only the cookie — and the session that
  // most needs ending is often the one living purely in a bearer token.
  out.href = '/auth/logout';
  out.addEventListener('click', async (e) => {
    e.preventDefault();
    out.textContent = 'Signing out…';
    try {
      // Carries the token, so the server knows whose sessions to revoke even
      // when no cookie was ever set. Revocation is what makes this stick: the
      // stored token is dead server-side before the page reloads, so a copy
      // that survived in storage — or in a host app's saved URL — cannot sign
      // anyone back in.
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...authHeaders(), 'x-csrf-token': state.csrf || '' },
      });
    } catch { /* the local clear and the reload below still happen */ }
    state.token = null;
    remember(null);
    // replace(), not assign(): Back must not return to a panel rendered from
    // the state this page still has in memory.
    location.replace('/');
  });
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

/**
 * The tiles, updated in place.
 *
 * They used to be rebuilt with replaceChildren on every repaint, and the
 * stylesheet plays a staggered entrance on `.tiles > *`. So every repaint put
 * all six back to opacity 0 and cascaded them in again over about 380ms —
 * measurably: 140ms of a completely blank row, then one tile at a time. Once
 * is an entrance. On every overview the live stream pushes it is a flicker,
 * and on a busy server, where updates arrive closer together than the cascade
 * takes to finish, the later tiles never reach full opacity at all. That is
 * the row that looks empty until you open the panel again.
 *
 * So the elements are built once and kept. After that only the number and the
 * state class change, which means the entrance plays exactly when something
 * entered, and an update is just the digits moving.
 */
function paintTiles(specs) {
  const host = $('#tiles');
  const live = [...host.children].filter(c => !c.classList.contains('ph'));
  // Switching servers is new content, not an update to what is on screen, so
  // it earns the entrance the same way the first load does.
  const arrived = host.dataset.guild !== state.guildId || live.length !== specs.length;
  host.dataset.guild = state.guildId || '';

  if (arrived) {
    host.replaceChildren(...specs.map(s => tile(s.value, s.label, s.kind)));
    return;
  }

  specs.forEach((s, i) => {
    const t = live[i];
    const n = t.firstElementChild;
    const next = String(s.value);
    if (n.textContent !== next) {
      n.textContent = next;
      // Only on a real change, so a repaint that altered nothing stays
      // perfectly still. Restarting the class is what lets it run twice.
      n.classList.remove('ticked');
      void n.offsetWidth;
      n.classList.add('ticked');
    }
    const cls = `tile ${s.kind}`.trim();
    if (t.className !== cls) t.className = cls;
  });
}

/**
 * The read-only half of the overview screen: identity, tiles, the two cards.
 *
 * Split out because the live stream repaints these on every change and must
 * not go near a form while it is being filled in.
 */
function renderOverviewCards() {
  const d = state.overview;
  if (!d) return;

  $('#crest').replaceChildren(...(d.guild.icon
    ? [Object.assign(el('img'), { src: d.guild.icon, alt: '' })]
    : [el('span', null, d.guild.name.slice(0, 1).toUpperCase())]));
  $('#server-name').textContent = d.guild.name;
  $('#server-meta').textContent = `${num(d.guild.members)} members · ${num(d.guild.channels)} channels`;

  paintTiles([
    { value: d.newsfeed.enabled ? 'LIVE' : 'OFF', label: 'News feed', kind: d.newsfeed.enabled ? 'live' : 'idle' },
    { value: d.econcal.enabled ? 'LIVE' : 'OFF', label: 'Calendar', kind: d.econcal.enabled ? 'live' : 'idle' },
    { value: num(d.counts.activeGiveaways), label: 'Giveaways', kind: d.counts.activeGiveaways ? 'live' : 'idle' },
    { value: num(d.counts.embedTemplates), label: 'Templates', kind: '' },
    { value: num(d.counts.shopItems), label: 'Shop items', kind: '' },
    { value: num(d.counts.moderationCases), label: 'Mod cases', kind: '' },
  ]);

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

}

function renderOverview() {
  if (!state.overview) return;
  renderOverviewCards();
  renderFeedForms();
  renderModerationForm();
  renderShop();
  renderComposer();
  renderAppearance();
  renderSocial();
  renderGiveaways();
  renderSettings();
  renderPanelLog();
  renderLegalLinks();
  renderTickets();
  renderCasino();
  renderLinkRequests();
  renderModeration();
  renderGroupForm('#form-lottery', 'lottery');
  renderCards();
  renderGroupForm('#form-verify', 'verify');
  renderVerifyPanel();
  renderEconomy();
  renderCoins();
  renderSchedules();
  renderAutoreplies();
  renderLevels();
  renderLevelRoles();
  renderLottery();
  renderGiveawayForm();
  startTicking();
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

/* ── durations ─────────────────────────────────────────────────────────────
   The same 10s/10m/10h/10d the slash commands take. Mirrored here rather than
   fetched so the field can validate as you type; utils/duration.js is the
   authority and rejects anything this lets through. */

const DURATION_UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
const UNIT_NAME = { s: 'second', m: 'minute', h: 'hour', d: 'day' };

function parseDurationMs(str) {
  const m = String(str ?? '').trim().match(/^(\d+)([smhd])$/i);
  if (!m) return null;
  const ms = parseInt(m[1], 10) * DURATION_UNIT_MS[m[2].toLowerCase()];
  return ms > 0 ? ms : null;
}

function humanDuration(str) {
  const m = String(str ?? '').trim().match(/^(\d+)([smhd])$/i);
  if (!m) return str;
  const n = parseInt(m[1], 10);
  return `${n} ${UNIT_NAME[m[2].toLowerCase()]}${n === 1 ? '' : 's'}`;
}

/**
 * A duration input that says what it understood, so a typo is visible before
 * the giveaway is launched rather than after the server rejects it.
 */
function durationField(label, value, onInput) {
  const l = el('label', 'field');
  const head = el('div', 'field-head');
  const echo = el('span', 'count');
  head.append(el('span', null, label), echo);
  l.append(head);

  const input = el('input');
  input.type = 'text';
  input.value = value ?? '';
  input.placeholder = '30s · 10m · 6h · 2d';
  input.setAttribute('inputmode', 'text');
  input.autocapitalize = 'none';
  input.spellcheck = false;

  const sync = () => {
    const ok = parseDurationMs(input.value);
    echo.textContent = ok ? humanDuration(input.value) : 'use 10s / 10m / 10h / 10d';
    echo.className = `count${ok ? '' : ' bad'}`;
  };
  sync();
  input.addEventListener('input', () => {
    // Units are lower case; typing "10M" should still work.
    input.value = input.value.toLowerCase();
    sync();
    onInput(input.value);
  });

  l.append(input);
  const chips = el('div', 'chipset');
  for (const preset of ['30s', '10m', '1h', '6h', '1d', '7d']) {
    const c = el('button', 'chip', preset);
    c.type = 'button';
    c.addEventListener('click', () => { input.value = preset; sync(); onInput(preset); });
    chips.append(c);
  }
  l.append(chips);
  return l;
}

/**
 * @param {Function} onSave
 * @param {object}  [opts]
 *   label — for forms that do something rather than save something. A
 *   giveaway form is not saving settings, it is starting a giveaway, and
 *   "Save changes" said the wrong thing about what the button would do.
 */
function actions(onSave, { label = 'Save changes', busyLabel = null } = {}) {
  const wrap = el('div', 'actions');
  const save = el('button', 'btn primary small', label);
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    if (busyLabel) save.textContent = busyLabel;
    try { await onSave(); }
    finally {
      save.disabled = false;
      save.textContent = label;
    }
  });
  wrap.append(save);
  return wrap;
}

function renderFeedForms() {
  const d = state.overview;

  const nf = { enabled: d.newsfeed.enabled, filterTopics: d.newsfeed.topics.slice() };
  $('#form-newsfeed').replaceChildren(
    toggle('Feed running', nf.enabled, v => { nf.enabled = v; }),
    // Picked, not typed. The filter works off each topic's bundle of
    // keywords, so only one of these keys means anything — and the box that
    // used to be here took any words at all, stored them, and then matched
    // nothing, which looked identical to a filter that was simply strict.
    pickValues('Topics', d.newsfeed.topicOptions || [], nf.filterTopics,
      v => { nf.filterTopics = v; },
      { allNote: 'Nothing picked — every headline is posted.' }),
    pickOne('Channel', 'channel', d.newsfeed.channelId, v => { nf.channelId = v; }),
    row('Sources', chips(d.newsfeed.sources)),
    actions(() => post('newsfeed', nf)),
  );

  const ec = {
    enabled: d.econcal.enabled,
    impactFilter: d.econcal.impact.slice(),
    currencyFilter: d.econcal.currencies.slice(),
    weeklyPost: { ...d.econcal.weekly },
  };
  const wp = ec.weeklyPost;

  // Everything /econcal can set, in the order the command's own panel walks
  // through it — where it goes, who gets pinged, what is included, and when
  // the week-ahead summary posts.
  const weeklyRows = [
    select('Day', String(wp.weekday), WEEKDAY_OPTIONS, v => { wp.weekday = Number(v); }),
    textField('Time (24h, HH:MM)', `${String(wp.hour).padStart(2, '0')}:${String(wp.minute).padStart(2, '0')}`, v => {
      const m = v.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return;
      wp.hour = Math.min(23, Number(m[1]));
      wp.minute = Math.min(59, Number(m[2]));
    }),
    select('Timezone', String(wp.offsetMinutes), UTC_OFFSET_OPTIONS, v => { wp.offsetMinutes = Number(v); }),
  ];
  const weeklyWrap = el('div', 'subfields');
  weeklyWrap.append(...weeklyRows);
  weeklyWrap.hidden = !wp.enabled;

  $('#form-econcal').replaceChildren(
    toggle('Calendar running', ec.enabled, v => { ec.enabled = v; }),
    pickOne('Channel', 'channel', d.econcal.channelId, v => { ec.channelId = v; }),
    pickOne('Ping this role on reminders', 'role', d.econcal.roleId, v => { ec.roleId = v; },
      { blank: 'No ping' }),
    pickValues('Impact levels', d.econcal.impactLevels || [], ec.impactFilter,
      v => { ec.impactFilter = v; }, { allNote: 'Nothing picked — every impact level is sent.' }),
    pickValues('Currencies', d.econcal.currencyCodes || [], ec.currencyFilter,
      v => { ec.currencyFilter = v; }, { allNote: 'Nothing picked — every currency is sent.' }),
    el('h2', null, 'Weekly summary'),
    toggle('Post the week ahead', wp.enabled, v => { wp.enabled = v; weeklyWrap.hidden = !v; }),
    weeklyWrap,
    actions(() => post('econcal', ec)),
  );
}

const WEEKDAY_OPTIONS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  .map((label, i) => ({ value: String(i), label }));

// -12:00 to +14:00 in whole hours, which covers every real UTC offset the
// scheduler accepts.
const UTC_OFFSET_OPTIONS = Array.from({ length: 27 }, (_, i) => {
  const hours = i - 12;
  return { value: String(hours * 60), label: `UTC${hours >= 0 ? '+' : ''}${hours}` };
});

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
 * Ping target: nothing, the two broadcast forms, or a role in this server.
 *
 * Up here with the other pickers rather than beside the one screen that first
 * needed it — the Composer's send form uses it too, and a ping target is the
 * same question wherever it is asked.
 */
function mentionPicker(label, value, onChange, { blank = 'No ping' } = {}) {
  const current = value && value.startsWith('<@&') ? value.replace(/[^0-9]/g, '') : value;
  return select(label, current || '', [
    { value: '@everyone', label: '@everyone' },
    { value: '@here', label: '@here' },
    ...roleList().map(r => ({ value: r.id, label: `@${r.name}` })),
  ], v => onChange(v || null), { blank });
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

/**
 * Multi-select over a fixed vocabulary — impact levels, currency codes.
 *
 * Same chips as the role and channel pickers, so "pick several from a list"
 * looks the same everywhere. Nothing selected means everything, which is what
 * an empty filter means to the calendar, so the field says so rather than
 * leaving it to be inferred from a blank row.
 */
function pickValues(label, options, values, onChange, { allNote = 'Nothing picked — everything is sent.' } = {}) {
  const chosen = new Set(values || []);
  const wrap = el('div', 'field');
  const head = el('div', 'field-head');
  const note = el('span', 'count');
  head.append(el('span', null, label), note);
  wrap.append(head);

  const sync = () => { note.textContent = chosen.size ? `${chosen.size} picked` : 'all'; };

  const box = el('div', 'chipset');
  for (const o of options) {
    const value = typeof o === 'string' ? o : o.value;
    const text = typeof o === 'string' ? o : o.label;
    const b = el('button', 'chip-toggle', text);
    b.type = 'button';
    // What the option actually covers, for vocabularies where the name alone
    // does not say — "Commodities" is not obviously oil, gold and gas.
    if (o && o.hint) b.title = o.hint;
    if (chosen.has(value)) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => {
      if (chosen.has(value)) { chosen.delete(value); b.removeAttribute('aria-pressed'); }
      else { chosen.add(value); b.setAttribute('aria-pressed', 'true'); }
      sync();
      // Ordered by the vocabulary so what is sent matches what is stored.
      onChange(options.map(x => (typeof x === 'string' ? x : x.value)).filter(v => chosen.has(v)));
    });
    box.append(b);
  }
  sync();
  wrap.append(box);
  wrap.append(el('p', 'hint', allNote));
  return wrap;
}

/**
 * Member picker — a list, like channels and roles.
 *
 * It used to be a type-to-match box, which was a bad idea the moment a name
 * contained styled unicode: you cannot type 𝓎☆𝒮𝒮𝐸𝑅 on a phone keyboard, so
 * the field was effectively unusable for exactly the people most likely to
 * have a name like that.
 */
function pickMember(label, value, onChange) {
  const members = state.overview?.features?.members || [];
  return select(`${label} (${members.length})`, value || '',
    members.map(m => ({ value: m.id, label: m.name })),
    v => onChange(v || null), { blank: members.length ? 'Pick a member' : 'No members loaded' });
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
    around: { above: '', below: '', picture: '' },
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
  // Stored as null when nothing is set, so the editor always has one to bind
  // to rather than each field having to cope with it being absent.
  draft.around = draft.around || { above: '', below: '', picture: '' };
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

  /* -- what goes around the embeds ------------------------------------- */
  // Folded away, because most messages are just their embed and this would
  // otherwise be three empty boxes on every one of them.
  const a = draft.around;
  head.append(disclosure('composer:around', 'Text and picture around it', [
    el('p', 'muted', 'Plain writing outside the embed — a line of context over the top, a note or a picture under it.'),
    areaField('Above the embed', a.above, v => { a.above = v; }, 2),
    areaField('Below the embed', a.below, v => { a.below = v; }, 2),
    textField('Picture under it (URL)', a.picture, v => { a.picture = v; }),
    el('p', 'hint', 'Discord always draws a message as text, then embed, then buttons — there is no room after the embed for words. So anything below is sent as a second message right underneath, and updating the post rewrites both.'),
  ]));

  const saveRow = el('div', 'actions');
  const saveBtn = el('button', 'btn primary small', 'Save message');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const res = await post('template', { name: draft.name, embeds: draft.embeds, around: draft.around });
    saveBtn.disabled = false;
    if (res?.ok) { state.tplName = draft.name; state.draft = null; renderComposer(); }
  });

  // Sits beside Save because that is where you are when you want to check your
  // work — and it previews the draft in hand, saved or not.
  const previewBtn = el('button', 'btn small', 'Preview');
  previewBtn.type = 'button';
  previewBtn.addEventListener('click', () => openEmbedPreview(draft));

  saveRow.append(addEmbed, previewBtn, saveBtn);

  if (!state.draft?.isNew && list.some(t => t.name === draft.name)) {
    const del = el('button', 'btn small danger', 'Delete message');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!await askConfirm({
        title: 'Delete this message?',
        message: `“${draft.name}” and every button attached to it will be removed. Messages already posted in your channels stay where they are.`,
        confirmLabel: 'Delete it', danger: true,
      })) return;
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
    const target = { name: draft.name, channelId: '', content: '', mention: null };
    const channels = state.overview?.settings?.channels || [];
    sendPanel.append(
      select('Channel', '', channels.map(c => ({ value: c.id, label: `#${c.name}` })), v => { target.channelId = v; }, { blank: 'Pick a channel' }),
      // Between the channel and the line above the embed, because it reads in
      // the order the post is built: where it goes, who it is for, what it
      // says. It belongs to this send rather than to the template, so it
      // resets every time this form is drawn.
      mentionPicker('Ping with the post', null, v => { target.mention = v; }),
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

/* Live countdowns. One timer for the whole page rather than one per giveaway,
   and it only touches text that changed. */
const ticking = new Set();
let tickTimer = null;

/**
 * @param {number} endsAt
 * @param {number|null} startedAt
 *   When the thing being counted actually began. Without it the bar measured
 *   from the moment the page opened, so every reload put it back to empty and
 *   it filled again over whatever was left — a bar that looked like progress
 *   and was really just "how long have you been looking at this". Given the
 *   real start it shows the same fraction on every device, at any time, and
 *   survives a refresh unchanged.
 */
function countdownEl(endsAt, startedAt = null) {
  const node = el('span', 'countdown');
  const bar = el('div', 'meter');
  const fill = el('i');
  bar.append(fill);
  // Falling back to now keeps an old record without a start time working; it
  // is the previous behaviour, and only for those.
  const began = Number(startedAt) > 0 ? Number(startedAt) : Date.now();
  const span = Math.max(1, endsAt - began);

  const paint = () => {
    const left = endsAt - Date.now();
    if (left <= 0) { node.textContent = 'ending now'; node.className = 'countdown over'; fill.style.width = '100%'; return false; }
    const s = Math.floor(left / 1000);
    const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, sec = s % 60;
    node.textContent = d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${String(sec).padStart(2, '0')}s` : `${m}m ${String(sec).padStart(2, '0')}s`;
    const soon = left < 5 * 60000;
    node.className = `countdown${soon ? ' soon' : ''}`;
    bar.className = `meter${soon ? ' soon' : ''}`;
    fill.style.width = `${Math.min(100, ((span - left) / span) * 100).toFixed(1)}%`;
    return true;
  };
  paint();
  ticking.add(paint);
  return { node, bar };
}

function startTicking() {
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    for (const paint of [...ticking]) if (!paint()) ticking.delete(paint);
  }, 1000);
}

function renderGiveaways() {
  ticking.clear();
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
    d.append(el('p', 'hint', `${num(x.entrants)} entered · ${x.winners} winner${x.winners === 1 ? '' : 's'}`));
    if (x.endsAt) {
      const c = countdownEl(x.endsAt, x.startedAt);
      const line = el('div', 'row');
      line.append(el('span', 'k', 'Ends in'), c.node);
      d.append(line, c.bar);
    }
    const act = el('div', 'actions');
    const end = el('button', 'btn small danger', 'End now');
    end.type = 'button';
    end.addEventListener('click', async () => {
      if (!await askConfirm({
        title: 'End it now?',
        message: 'Winners are drawn immediately and announced, as if the timer had run out.',
        confirmLabel: 'End and draw',
      })) return;
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
    // A button rather than a div with a click handler, so it is reachable by
    // keyboard and announces itself as something that does something.
    const d = el('button', 'gaw tappable');
    d.type = 'button';
    const top = el('div', 'gaw-top');
    top.append(
      el('span', `kind ${x.kind}`, x.kind === 'coins' ? 'COINS' : 'PRIZE'),
      el('span', 'nm', x.title || 'Giveaway'),
      el('span', 'idtag', x.shortId),
    );
    d.append(top);
    d.append(el('p', 'hint', `${num(x.entrants)} entered · ${x.winners} winner${x.winners === 1 ? '' : 's'}`));
    d.append(el('span', 'chev', '›'));
    d.addEventListener('click', () => openEndedGiveaway(x));
    return d;
  }));
}

/**
 * The detail sheet for a finished giveaway.
 *
 * Reroll and delete both live here rather than as buttons on the card: they
 * are the two destructive-ish things you can do to a finished giveaway, and
 * putting them behind a deliberate tap keeps them off a list you scroll past.
 */
function openEndedGiveaway(x) {
  const body = [
    sheetRow('Kind', x.kind === 'coins' ? 'Coins giveaway' : 'Prize giveaway'),
    sheetRow('Prize', x.title || 'Giveaway'),
    sheetRow('Entered', num(x.entrants)),
    sheetRow('Winners', String(x.winners)),
    sheetRow('ID', el('span', 'v mono', x.shortId)),
  ];
  if (x.endedAt) body.push(sheetRow('Ended', new Date(x.endedAt).toLocaleString()));
  body.push(el('p', 'hint', 'Rerolling draws new winners. For a coins giveaway that pays them again, on top of what the first draw already paid out.'));

  const reroll = el('button', 'btn primary', 'Reroll winners');
  reroll.type = 'button';
  reroll.addEventListener('click', async () => {
    reroll.disabled = true;
    reroll.textContent = 'Drawing…';
    const out = await post('giveawayreroll', { shortId: x.shortId, kind: x.kind });
    if (out) closeSheet();
    else { reroll.disabled = false; reroll.textContent = 'Reroll winners'; }
  });

  const del = el('button', 'btn danger', 'Delete from panel');
  del.type = 'button';
  del.addEventListener('click', async () => {
    // Two taps, because deleting the record is what makes a reroll impossible
    // from then on — and the announcement in the channel stays either way.
    if (del.dataset.armed !== '1') {
      del.dataset.armed = '1';
      del.textContent = 'Tap again to delete';
      return;
    }
    del.disabled = true;
    const out = await post('giveawaydelete', { shortId: x.shortId, kind: x.kind });
    if (out) closeSheet();
    else { del.disabled = false; del.dataset.armed = ''; del.textContent = 'Delete from panel'; }
  });

  openSheet(x.title || 'Giveaway', body, [reroll, del]);
}

/* ── previewing an embed ───────────────────────────────────────────────────
   A rendering of the draft in hand, in the sheet, so the page behind blurs
   away and the only thing left to look at is the message.

   It is a likeness, not Discord: the colour spine, the type scale and the
   field grid are what make an embed recognisable at a glance, and those are
   what this reproduces. */

/** The placeholders embed.js substitutes at send time, filled in as it would. */
function fillPlaceholders(text) {
  const g = state.overview?.guild;
  return String(text ?? '')
    .replace(/\{user\}/g, `@${state.me?.name || 'you'}`)
    .replace(/\{username\}/g, state.me?.name || 'you')
    .replace(/\{server\}/g, g?.name || 'this server')
    .replace(/\{membercount\}/g, g ? num(g.members) : '0')
    .replace(/\{channel\}/g, '#channel');
}

/**
 * Fetches a generated image into an <img>.
 *
 * The blob URL is handed back so the sheet can revoke it on close — an
 * object URL left behind pins the whole buffer in memory for the life of the
 * page, and a preview is the last thing that should leak.
 */
async function loadDynamicPreview(img, key, revocables) {
  try {
    const url = `/api/preview-image/${encodeURIComponent(key)}${state.guildId ? `?g=${state.guildId}` : ''}`;
    const res = await fetch(url, { credentials: 'same-origin', headers: authHeaders() });
    if (!res.ok) throw new Error(String(res.status));
    const objectUrl = URL.createObjectURL(await res.blob());
    revocables.push(objectUrl);
    img.src = objectUrl;
    img.hidden = false;
  } catch {
    // The alternative is a broken-image icon, which reads as a bug rather
    // than as art that could not be drawn right now.
    img.replaceWith(el('p', 'hint', `Generated image “${key}” could not be drawn just now — it will still be attached when this is sent.`));
  }
}

/** A picture in the preview, only shown once it has actually loaded. */
function previewPicture(url, className) {
  const img = el('img');
  img.className = className;
  img.alt = '';
  img.hidden = true;
  img.addEventListener('load', () => { img.hidden = false; });
  // A URL that does not resolve leaves nothing rather than a broken-image
  // glyph, which reads as the preview being broken rather than the address.
  img.addEventListener('error', () => { img.replaceWith(el('p', 'hint', 'That picture would not load.')); });
  img.src = url;
  return img;
}

function openEmbedPreview(draft) {
  const revocables = [];
  const body = [];

  const buttons = (state.overview?.composer || []).find(t => t.name === draft.name)?.buttons
    || draft.buttons || [];

  // The line over the top is part of the message, so it is part of the
  // likeness — and seeing it above the box is the only way to tell it is
  // going where you meant.
  const around = draft.around || {};
  if (around.above) body.push(el('p', 'demb-say', fillPlaceholders(around.above)));

  draft.embeds.forEach(e => {
    const box = el('div', 'demb');
    box.style.borderLeftColor = /^#[0-9a-f]{6}$/i.test(e.color || '') ? e.color : '#5865F2';

    if (e.authorName) {
      const author = el('p', 'demb-auth');
      if (e.authorIcon) author.append(previewPicture(e.authorIcon, 'demb-auth-ic'));
      author.append(el('span', null, fillPlaceholders(e.authorName)));
      box.append(author);
    }
    if (e.title) box.append(el('p', 't', fillPlaceholders(e.title)));
    if (e.description) box.append(el('p', 'd', fillPlaceholders(e.description)));

    if (e.fields?.length) {
      const f = el('div', 'f');
      for (const fd of e.fields) {
        if (!fd.name && !fd.value) continue;
        const cell = el('div');
        // Inline fields sit side by side; block fields take the full width,
        // which is the single most visible thing the inline switch does.
        if (!fd.inline) cell.style.flexBasis = '100%';
        cell.append(el('b', null, fillPlaceholders(fd.name || '​')));
        cell.append(el('span', null, fillPlaceholders(fd.value || '')));
        f.append(cell);
      }
      if (f.childElementCount) box.append(f);
    }

    if (e.thumbnail) {
      // Wrapped, so the square sits beside what came before it rather than
      // on top of it — the same row the Appearance preview uses.
      const row = el('div', 'demb-row');
      const main = el('div', 'demb-main');
      while (box.firstChild) main.append(box.firstChild);
      row.append(main, previewPicture(e.thumbnail, 'demb-thumb-img'));
      box.append(row);
    }

    if (e.image) {
      if (e.image.startsWith('dynamic:')) {
        const img = el('img');
        img.className = 'big';
        img.alt = '';
        img.hidden = true;
        box.append(img);
        loadDynamicPreview(img, e.image.slice(8), revocables);
      } else {
        box.append(previewPicture(e.image, 'big'));
      }
    }

    const footBits = [];
    if (e.footer) footBits.push(fillPlaceholders(e.footer));
    if (e.timestamp) footBits.push(new Date().toLocaleString());
    if (footBits.length) {
      const ft = el('p', 'ft');
      if (e.footerIcon) ft.append(previewPicture(e.footerIcon, 'demb-auth-ic'));
      ft.append(el('span', null, footBits.join(' • ')));
      box.append(ft);
    }

    body.push(box);
  });

  if (buttons.length) {
    const row = el('div', 'demb-btns');
    for (const b of buttons) {
      const chip = el('span', b.type === 'link' ? 'link' : (b.style || 'Primary'),
        `${b.emoji ? `${b.emoji} ` : ''}${b.label || b.id}`);
      row.append(chip);
    }
    body.push(row);
  }

  if (around.below || around.picture) {
    const second = el('div', 'demb-second');
    second.append(el('p', 'hint', 'Sent as a second message, right underneath'));
    if (around.below) second.append(el('p', 'demb-say', fillPlaceholders(around.below)));
    if (around.picture) second.append(previewPicture(around.picture, 'big'));
    body.push(second);
  }

  if (!body.length) body.push(el('p', 'muted', 'Nothing to show yet — add a title or description.'));
  body.push(el('p', 'hint', 'A likeness of the message, not a screenshot of Discord. Placeholders are filled in the way they will be when it is sent.'));

  openSheet(draft.name ? `Preview · ${draft.name}` : 'Preview', body, [], () => {
    for (const url of revocables) URL.revokeObjectURL(url);
  });
}

/* ── social ────────────────────────────────────────────────────────────────
   Accounts on YouTube and TikTok, relayed into a channel as
   they post. The cards are styled on Appearance — this screen is only about
   which accounts, where they land and how often they are checked. */

const SOCIAL_ERRORS = {
  bad_bridge: 'The bridge address must start with https.',
  bad_interval: 'Check between every 2 minutes and every 6 hours.',
  bad_batch: 'Post between 1 and 10 at a time.',
  bad_platform: 'Pick one of the four platforms.',
  bad_feed_url: 'A feed address must start with https.',
  need_handle: 'Give it an account name, or a feed address.',
  too_many_accounts: 'That is as many accounts as one server can watch.',
  unknown_account: 'That account is no longer listed.',
  bad_keywords: 'One of those words is too long.',
  no_channel: 'Set a channel for it to post in first.',
  fetch_failed: 'Could not read that feed.',
  send_failed: 'Could not post to that channel.',
  nothing_to_post: 'That feed has nothing in it right now.',
};
Object.assign(WRITE_ERRORS, SOCIAL_ERRORS);

const ago = ms => {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/**
 * The bits of Discord markdown worth drawing in a preview.
 *
 * Nodes, never HTML: every piece of this is either something typed into a box
 * on this page or a value from the server, and the whole panel's rule is that
 * nothing is ever assigned as markup. **bold**, *italic* and [text](url) are
 * the three that change how a card reads — the social cards default to a
 * bolded link, which without this shows as a line of asterisks and brackets.
 */
function mdNodes(text, depth = 0) {
  const out = [];
  const src = String(text ?? '');
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([\s\S]+?)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    if (m.index > last) out.push(document.createTextNode(src.slice(last, m.index)));
    if (m[1] !== undefined) {
      const a = el('span', 'md-link', m[1]);
      a.title = m[2];
      out.push(a);
    } else if (m[3] !== undefined) {
      // Recursive, because these nest: the social cards default to a bolded
      // link, and reading ** first swallowed the whole [text](url) inside it
      // and drew the brackets literally. Depth-capped so a pathological
      // string cannot spin.
      const b = el('b');
      b.append(...(depth < 4 ? mdNodes(m[3], depth + 1) : [document.createTextNode(m[3])]));
      out.push(b);
    } else if (m[4] !== undefined) {
      const i = el('i');
      i.append(...(depth < 4 ? mdNodes(m[4], depth + 1) : [document.createTextNode(m[4])]));
      out.push(i);
    } else {
      // Code is literal by definition — nothing inside it is markup.
      out.push(el('code', null, m[5]));
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(document.createTextNode(src.slice(last)));
  return out.length ? out : [document.createTextNode(src)];
}


/** The words box — comma separated, because that is how people write lists. */
function wordsField(label, values, onChange, hint) {
  const l = el('label', 'field');
  l.append(el('span', null, label));
  const input = el('input');
  input.type = 'text';
  input.value = (values || []).join(', ');
  input.placeholder = 'clip, live, giveaway';
  input.addEventListener('input', () => {
    onChange(input.value.split(',').map(s => s.trim()).filter(Boolean));
  });
  l.append(input);
  const wrap = el('div');
  wrap.append(l);
  if (hint) wrap.append(el('p', 'hint', hint));
  return wrap;
}

function renderSocial() {
  const d = state.overview?.social;
  if (!d) return;

  const statePill = $('#social-state');
  if (statePill) {
    const live = d.enabled && !!d.channelId;
    statePill.textContent = d.enabled ? (d.channelId ? 'Watching' : 'No channel set') : 'Off';
    // On when it is actually working, amber when it is switched on but cannot
    // post anywhere, grey when it is off. A pill with no state class at all
    // takes its colour from whatever it sits inside, which reads as neither.
    statePill.className = `pill ${live ? 'on' : d.enabled ? 'wait' : 'off'}`;
  }

  /* -- where posts land --------------------------------------------------- */
  const s = {
    enabled: d.enabled, channelId: d.channelId, mentionRoleId: d.mentionRoleId,
  };
  const landNote = el('p', 'hint', '');
  const syncLand = () => {
    const watching = d.accounts.filter(a => a.enabled).length;
    landNote.textContent = !s.enabled
      ? 'Nothing is being checked.'
      : !s.channelId
        ? 'Pick a channel — until then there is nowhere for a post to go.'
        : `${watching} account${watching === 1 ? '' : 's'} being watched.`;
    landNote.className = `hint${s.enabled && !s.channelId ? ' bad' : ''}`;
  };

  $('#form-social').replaceChildren(
    toggle('Watch social accounts', s.enabled, v => { s.enabled = v; syncLand(); }),
    pickOne('Channel', 'channel', s.channelId, v => { s.channelId = v; syncLand(); }),
    pickOne('Ping this role', 'role', s.mentionRoleId, v => { s.mentionRoleId = v; }),
    landNote,
    actions(() => post('social', s)),
  );
  syncLand();

  /* -- how often ----------------------------------------------------------
     Everything about *how* a platform is reached lives behind Advanced. Most
     of it is jargon nobody should have to learn to watch a YouTube channel,
     and all of it has a working default. */
  const b = { pollMinutes: d.pollMinutes, maxPerCheck: d.maxPerCheck };

  // The helper-service box and its connection test are gone with the three
  // platforms that needed one. YouTube publishes its own feed, so there is
  // nothing in between to configure or to test — and a box that changes
  // nothing is worse than no box.
  const note = el('p', 'hint', '');
  const failing = d.accounts.filter(a => a.lastError).length;
  note.textContent = failing
    ? `${failing} channel${failing === 1 ? ' is' : 's are'} not loading — open one to see why.`
    : 'YouTube hands out its posts directly, so there is nothing in between to set up.';
  note.className = `hint${failing ? ' bad' : ''}`;

  $('#form-social-bridge').replaceChildren(
    textField('Check every (minutes)', String(b.pollMinutes), v => { b.pollMinutes = Number(v); }),
    textField('At most this many per check', String(b.maxPerCheck), v => { b.maxPerCheck = Number(v); }),
    el('p', 'hint', 'The cap stops a channel that has been quiet for a week filling your server the moment it posts again.'),
    note,
    actions(() => post('social', b)),
  );

  /* -- the accounts ------------------------------------------------------- */
  const wrap = $('#social-accounts');
  const rows = [];

  if (state.socialDraft) rows.push(socialAccountCard(state.socialDraft, d, true));
  if (!d.accounts.length && !state.socialDraft) {
    rows.push(el('p', 'muted', 'No accounts watched yet. Add one and its posts will land in your channel as they go out.'));
  }
  for (const a of d.accounts) {
    rows.push(state.socialOpen?.has(a.id) ? socialAccountCard(a, d, false) : socialStrip(a, d));
  }

  // The cards are styled with every other message the bot sends, not here.
  // Saying so with a button beats leaving someone to find it.
  const toStyle = el('button', 'btn small', 'Style these cards on Appearance');
  toStyle.type = 'button';
  toStyle.addEventListener('click', () => {
    state.styleKey = 'social.youtube';
    showSection('appearance');
    renderAppearance();
    paintBar();
  });
  const styleRow = el('div', 'actions');
  styleRow.append(toStyle);
  rows.push(styleRow);

  wrap.replaceChildren(...rows);
}

/**
 * A brand colour, lifted just far enough to be seen on the panel's own cards.
 *
 * X's brand colour is black, and the panel's card is nearly black, so the
 * stripe down the side of its row disappeared and the row read as broken. The
 * lift is for the panel only — the posted card keeps the real colour, where
 * the background is lighter and black is exactly right.
 */
function visibleBrand(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // The brightest channel, not perceptual luma. Luma weights red at a tenth of
  // green, so it scores pure #FF0000 as dark and would have quietly lightened
  // YouTube's red — a colour that is perfectly visible as a stripe. What
  // actually matters against a near-black card is whether any channel is lit
  // at all, which is what this measures.
  const peak = Math.max(r, g, b);
  // High enough that the stripe still reads on a paused row, which is drawn
  // at just over half opacity.
  const floor = 96;
  if (peak >= floor) return `#${m[1]}`;
  // Lifted towards white rather than towards its own hue, so a black stays a
  // grey instead of becoming some colour the brand never chose.
  const k = (floor - peak) / 255;
  r = Math.round(r + (255 - r) * k);
  g = Math.round(g + (255 - g) * k);
  b = Math.round(b + (255 - b) * k);
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The platform's mark.
 *
 * The picture the panel serves, which is the same one the posted card carries
 * — one drawing, so the list and the message can never show different logos.
 * The platform's colour sits behind it as a plain disc until it loads, so a
 * slow or blocked image leaves the row its shape rather than a gap.
 */
function platformMark(platform) {
  const badge = el('span', 'social-badge');
  badge.style.background = platform.color;
  if (!platform.mark) return badge;
  const img = el('img');
  img.src = platform.mark;
  img.alt = '';
  img.addEventListener('load', () => { badge.style.background = 'none'; });
  badge.append(img);
  return badge;
}

/**
 * A fold-away section. Native <details>, so it needs no script to open.
 *
 * The key is what makes it survive a redraw. Saving re-renders the screen from
 * the server's reply, and a fresh <details> starts closed — so a section you
 * had opened would snap shut under you, taking with it whatever you had just
 * asked for. The Test-the-connection result landed inside one of these.
 */
function disclosure(key, label, nodes) {
  const box = el('details', 'disc');
  const head = el('summary', null, label);
  box.append(head, ...nodes);
  if (state.openFolds?.has(key)) box.open = true;
  box.addEventListener('toggle', () => {
    if (!state.openFolds) state.openFolds = new Set();
    if (box.open) state.openFolds.add(key);
    else state.openFolds.delete(key);
  });
  return box;
}

/**
 * How an account is doing, in one word and one colour.
 *
 * Green once it is posting, amber while it has not been looked at yet, red
 * when the last look failed, grey when it is switched off.
 */
function socialHealth(a) {
  if (!a.enabled) return { tone: 'off', word: 'Paused' };
  if (a.lastError) return { tone: 'bad', word: 'Not loading' };
  if (!a.lastCheckedAt) return { tone: 'wait', word: 'Not checked yet' };
  if (a.posts) return { tone: 'on', word: `${a.posts} posted` };
  return { tone: 'on', word: 'Watching' };
}

/**
 * The collapsed account: a strip you can read a list of at a glance.
 *
 * A watched account is mostly something you set up once and then only want to
 * see the state of. Fifteen inputs each is unreadable at four accounts, so
 * the list collapses to this and opens on a tap.
 */
function socialStrip(account, d) {
  const platform = d.platforms.find(p => p.key === account.platform) || d.platforms[0];
  const health = socialHealth(account);

  const strip = el('button', 'social-strip');
  strip.type = 'button';
  strip.style.borderLeftColor = visibleBrand(platform.color);
  strip.setAttribute('aria-expanded', 'false');
  if (!account.enabled) strip.classList.add('off');

  const names = el('span', 'social-names');
  names.append(
    el('span', 'nm', account.label || account.handle || platform.label),
    el('span', 'mt', `${platform.label}${account.label && account.handle ? ` · ${account.handle}` : ''}`),
  );

  const state_ = el('span', `pill ${health.tone}`, health.word);
  const chev = el('span', 'social-chev', '›');

  strip.append(platformMark(platform), names, state_, chev);
  strip.addEventListener('click', () => {
    if (!state.socialOpen) state.socialOpen = new Set();
    state.socialOpen.add(account.id);
    renderSocial();
  });
  return strip;
}

/** One account, opened up: the few things worth changing, and the rest folded away. */
function socialAccountCard(account, d, isNew) {
  const platform = d.platforms.find(p => p.key === account.platform) || d.platforms[0];
  const draft = { id: isNew ? '' : account.id, ...account };

  const card = el('article', 'panel social-card');
  card.style.borderLeftColor = visibleBrand(platform.color);
  if (!isNew && !account.enabled) card.classList.add('off');

  const head = el('div', 'queue-head');
  const title = el('h2', null, isNew ? 'New account' : (account.label || account.handle));
  const headLeft = el('div', 'social-head-left');
  headLeft.append(platformMark(platform), title);
  head.append(headLeft);

  if (!isNew) {
    const fold = el('button', 'btn small', 'Collapse');
    fold.type = 'button';
    fold.addEventListener('click', () => {
      state.socialOpen?.delete(account.id);
      renderSocial();
    });
    head.append(fold);
  }
  card.append(head);

  /* -- the few things worth asking for ----------------------------------- */
  const basics = el('div');
  basics.append(
    select('Platform', draft.platform, d.platforms.map(p => ({ value: p.key, label: p.label })),
      v => {
        draft.platform = v;
        // The hint under the name box is per platform, so the card is redrawn
        // rather than left describing the wrong one.
        if (isNew) { state.socialDraft = { ...draft }; renderSocial(); }
      }),
    textField('Account name', draft.handle, v => { draft.handle = v; },
      { placeholder: platform.direct ? '@channelhandle' : '@username' }),
    el('p', 'hint', platform.direct
      ? 'A @handle, or the link to the channel — either works.'
      : 'The @name from their profile.'),
    textField('Show them as (optional)', draft.label || '', v => { draft.label = v; }),
    toggle('Watching', draft.enabled !== false, v => { draft.enabled = v; }),
  );
  card.append(basics);

  /* -- and the rest, folded away ------------------------------------------ */
  card.append(disclosure(`social:more:${draft.id || 'new'}`, 'More options', [
    pickOne('Post to (leave blank for the main channel)', 'channel', draft.postChannelId, v => { draft.postChannelId = v; }),
    pickOne('Ping (leave blank for the main role)', 'role', draft.mentionRoleId, v => { draft.mentionRoleId = v; }),
    wordsField('Only post if it mentions', draft.includeKeywords, v => { draft.includeKeywords = v; },
      'Comma separated. Leave empty to post everything.'),
    wordsField('Never post if it mentions', draft.excludeKeywords, v => { draft.excludeKeywords = v; },
      'Checked first — a post matching both is skipped.'),
    textField('Read from this address instead', draft.feedUrl || '', v => { draft.feedUrl = v; },
      { placeholder: 'https://…' }),
    el('p', 'hint', 'Only if somebody has given you one. It replaces the normal way this account is read.'),
  ]));

  /* -- how it is doing ---------------------------------------------------- */
  if (!isNew) {
    const status = el('div', 'rows social-status');
    status.append(
      row('Last checked', ago(account.lastCheckedAt)),
      row('Last posted', ago(account.lastPostedAt)),
      row('Posted so far', num(account.posts)),
    );
    if (account.lastError) {
      const errRow = row('Last error', account.lastError);
      errRow.classList.add('bad');
      status.append(errRow);
    }
    card.append(status);
  }

  // Same reason as the bridge result: kept in state so a re-render does not
  // take the answer off the screen a moment after it appeared.
  const out = el('div', 'social-out');
  if (!isNew && state.socialTests?.[account.id]) {
    out.append(socialTestResult(state.socialTests[account.id]));
  }
  card.append(out);

  const foot = el('div', 'actions');
  const save = el('button', 'btn primary small', isNew ? 'Start watching' : 'Save');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const res = await post('socialaccount', {
        id: draft.id || undefined,
        platform: draft.platform,
        handle: draft.handle,
        label: draft.label || '',
        feedUrl: draft.feedUrl || '',
        postChannelId: draft.postChannelId || null,
        mentionRoleId: draft.mentionRoleId || null,
        includeKeywords: draft.includeKeywords || [],
        excludeKeywords: draft.excludeKeywords || [],
        enabled: draft.enabled !== false,
      });
      if (res?.ok) {
        state.socialDraft = null;
        // A newly added account opens, so its status is visible straight away
        // rather than needing to be found and tapped.
        if (!state.socialOpen) state.socialOpen = new Set();
        if (res.id) state.socialOpen.add(res.id);
        state.overview = await get(`/api/guild/${state.guildId}`);
        renderOverview();
      }
    } finally { save.disabled = false; }
  });
  foot.append(save);

  if (isNew) {
    const cancel = el('button', 'btn small', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { state.socialDraft = null; renderSocial(); });
    foot.append(cancel);
  } else {
    const test = el('button', 'btn small', 'Test');
    test.type = 'button';
    test.addEventListener('click', async () => {
      test.disabled = true;
      test.textContent = 'Reading…';
      try {
        const res = await post('socialtest', { id: account.id }, { quiet: true });
        if (!state.socialTests) state.socialTests = {};
        state.socialTests[account.id] = res?.ok
          ? res
          : { failed: true, detail: 'The check could not be run.' };
        renderSocial();
      } finally { test.disabled = false; test.textContent = 'Test'; }
    });

    const now = el('button', 'btn small', 'Post the latest');
    now.type = 'button';
    now.addEventListener('click', async () => {
      if (!await askConfirm({
        title: 'Post the latest one now?',
        message: 'The newest post goes into the channel straight away. It does not skip anything — the next real check still posts whatever is new.',
        confirmLabel: 'Post it',
      })) return;
      now.disabled = true;
      try { await post('socialpost', { id: account.id }); }
      finally { now.disabled = false; }
    });

    const del = el('button', 'btn small danger', 'Stop watching');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!await askConfirm({
        title: `Stop watching ${account.label || account.handle}?`,
        message: 'Its posts stop arriving. Nothing already in the channel is touched.',
        confirmLabel: 'Stop watching',
      })) return;
      const res = await post('socialaccount', { id: account.id, remove: true });
      if (res?.ok) {
        state.socialOpen?.delete(account.id);
        state.overview = await get(`/api/guild/${state.guildId}`);
        renderOverview();
      }
    });

    foot.append(test, now, del);
  }
  card.append(foot);
  return card;
}

/** What a Test came back with — the three newest, or the reason there are none. */
function socialTestResult(res) {
  const box = el('div', 'social-test');
  if (res.failed) {
    box.append(el('p', 'hint bad', res.detail || 'Could not read it.'));
    // Every address that was tried, and what each one said. When a route has
    // been renamed this is the difference between "404" and knowing which
    // address 404'd.
    for (const t of res.tried || []) {
      box.append(el('p', 'hint mono', `${t.url} — ${t.why}`));
    }
    if (!(res.tried || []).length && res.url) box.append(el('p', 'hint mono', res.url));
    return box;
  }

  box.append(el('p', 'hint', `${res.found} post${res.found === 1 ? '' : 's'} found · ${res.keptByFilters} would pass your filters`));
  if (!res.baselineSet) {
    box.append(el('p', 'hint', 'Nothing has been posted from this account yet — the first check sets a starting point, and everything after that arrives. Use "Post the latest" if you want to see the card now.'));
  }
  const list = el('div', 'rows');
  for (const item of res.sample) {
    const r = row(new Date(item.published).toLocaleString(), item.title);
    if (!item.keptByFilters) r.classList.add('dim');
    list.append(r);
  }
  box.append(list);
  return box;
}

/* ── appearance: the messages the bot sends on its own ─────────────────────
   The Composer covers messages you write. This covers the other kind — the
   warning card, the mod-log entry, the goodbye, the level-up — which used to
   be hard-coded and needed a redeploy to change. */

/**
 * Token substitution, matching utils/messageStyle.js fill().
 *
 * There are deliberately two implementations. The server's is the one that
 * actually sends, and the preview you see on load comes from it; this one
 * exists so the preview keeps up while you type, which a round trip per
 * keystroke could not. The rule is small enough to hold in both places: a
 * token nobody supplied becomes nothing, and a line whose tokens *all* came
 * back empty is dropped rather than left as a label for something absent.
 */
function fillTokens(text, values) {
  if (!text) return '';
  const kept = [];
  for (const line of String(text).split('\n')) {
    let sawToken = false;
    let sawValue = false;
    const filled = line.replace(/\{(\w+)\}/g, (whole, name) => {
      sawToken = true;
      const lower = name.toLowerCase();
      const raw = Object.hasOwn(values, name) ? values[name]
        : (name === name.toUpperCase() && Object.hasOwn(values, lower) ? String(values[lower]).toUpperCase() : '');
      const value = raw === null || raw === undefined ? '' : String(raw);
      if (value !== '') sawValue = true;
      return value;
    });
    if (sawToken && !sawValue) continue;
    kept.push(filled.replace(/[ \t]+$/, ''));
  }
  return kept.join('\n').trim();
}

/** Draws one message the way Discord will, from the values being edited. */
/**
 * The editors for one message's buttons.
 *
 * A row each: what it says, what it says it with, and what colour it is. The
 * id is shown but never editable — it is what the bot routes the press on, so
 * a typed one would be a button that looks right and does nothing.
 */
function buttonEditors(entry, values, repaint) {
  const wrap = el('div', 'subfields');
  wrap.append(el('h2', null, 'Buttons'));
  values.buttons = values.buttons || [];

  if (!values.buttons.length) {
    wrap.append(el('p', 'hint', 'This message has no buttons.'));
    return wrap;
  }

  for (const b of values.buttons) {
    const row = el('div', 'subfield');
    const head = el('div', 'btn-editor-head');
    head.append(el('span', 'tag', b.id));
    if (b.does) head.append(el('span', 'hint', b.does));
    row.append(head);
    row.append(
      textField('What it says', b.label, v => { b.label = v; repaint(); }),
      textField('Emoji', b.emoji, v => { b.emoji = v; repaint(); }),
      select('Colour', b.style, (entry.buttonStyles || []).map(x => ({ value: x, label: BUTTON_STYLE_LABEL[x] || x })),
        v => { b.style = v; repaint(); }),
    );
    wrap.append(row);
  }
  wrap.append(el('p', 'hint', 'Leave the words empty to have the emoji stand alone — but not both, or Discord refuses the whole message.'));
  return wrap;
}

// Discord's names for these are about intent, not colour, and the colour is
// the thing you are actually choosing.
const BUTTON_STYLE_LABEL = {
  Primary: 'Blurple', Secondary: 'Grey', Success: 'Green', Danger: 'Red',
};

/**
 * The colour of each kind of card the bot sends without an entry of its own.
 *
 * A swatch each rather than a card each: there are seventeen, they differ only
 * in colour, and a list of seventeen near-identical editors is a screen nobody
 * can find anything on.
 */
function paletteEditors(entry, values, repaint) {
  const wrap = el('div', 'palette');
  values.palette = { ...(values.palette || {}) };
  for (const kind of entry.palette || []) {
    const row = el('div', 'palette-row');
    const head = el('div', 'palette-head');
    head.append(el('span', 'nm', kind.label));
    if (kind.does) head.append(el('span', 'hint', kind.does));
    row.append(head);
    row.append(colorField('', values.palette[kind.key] || kind.color, v => {
      values.palette[kind.key] = v;
      repaint();
    }));
    wrap.append(row);
  }
  return wrap;
}

function stylePreview(entry, values, sample) {
  // The palette has no one card to preview — it is the colour of two hundred
  // of them. A row of spines is a truer likeness than an empty box.
  if (entry.parts.includes('palette')) {
    const wrap = el('div', 'palette-preview');
    for (const kind of entry.palette || []) {
      const chip = el('div', 'demb');
      chip.style.borderLeftColor = values.palette?.[kind.key] || kind.color;
      chip.append(el('p', 't', kind.label));
      wrap.append(chip);
    }
    return wrap;
  }

  const box = el('div', 'demb');
  box.style.borderLeftColor = /^#[0-9a-f]{6}$/i.test(values.color || '') ? values.color : '#5865F2';

  const title = fillTokens(values.title, sample);
  const body = fillTokens(values.body, sample);

  if (entry.shape === 'action') {
    // The compact card: avatar and the line together on one row. The avatar is
    // drawn rather than fetched — a real one would be a request to Discord's
    // CDN for a picture nobody is looking at, and it would show as broken
    // anywhere the panel is opened without a route out.
    const a = el('div', 'a lead');
    a.append(el('span', 'av'), el('span', null, title || 'Update'));
    box.append(a);
    if (body) { const d = el('p', 'd'); d.append(...mdNodes(body)); box.append(d); }
    return box;
  }

  // The corner picture is a real element beside the text rather than something
  // floated over the top of it. It used to be an ::after pinned to the
  // corner, which on a card shorter than the square itself — a card that is
  // only a timestamp, say — hung out of the bottom and sat on the sentence
  // underneath.
  const main = el('div', 'demb-main');
  if (title) main.append(el('p', 't', title));
  if (body) { const d = el('p', 'd'); d.append(...mdNodes(body)); main.append(d); }

  // The rows the bot fills in at send time. Shown greyed so it is clear the
  // card will be taller than the parts on the left, without implying they can
  // be edited here.
  for (const f of entry.fixedFields || []) {
    const fixed = el('div', 'f fixed');
    const cell = el('div');
    cell.style.flexBasis = '100%';
    cell.append(el('b', null, f));
    cell.append(el('span', null, 'added when it is sent'));
    fixed.append(cell);
    main.append(fixed);
  }

  const footer = fillTokens(values.footer, sample);
  const bits = [];
  if (footer) bits.push(footer);
  if (values.timestamp) bits.push(new Date().toLocaleString());
  if (bits.length) main.append(el('p', 'ft', bits.join(' • ')));

  const row = el('div', 'demb-row');
  row.append(main);
  if (values.thumbnail) row.append(el('span', 'demb-thumb'));
  box.append(row);

  // The buttons under the card, in the colours they will actually be. This is
  // the point of editing them here rather than guessing — "Danger" and "red"
  // are the same thing and only one of them is visible.
  if (values.buttons?.length) {
    const btns = el('div', 'demb-btns');
    for (const b of values.buttons) {
      const chip = el('span', b.style || 'Secondary',
        `${b.emoji ? `${b.emoji} ` : ''}${b.label || ''}`.trim() || b.id);
      btns.append(chip);
    }
    // Outside the card: Discord draws a message's buttons under the embed,
    // not inside it, and putting them in the box would teach the wrong thing.
    const shell = el('div');
    shell.append(box, btns);
    return shell;
  }
  return box;
}

/** A colour picker and its hex box, kept in step with each other. */
function colorField(label, value, onChange) {
  const l = el('label', 'field');
  l.append(el('span', null, label));
  const row = el('div', 'color-row');

  const swatch = el('input');
  swatch.type = 'color';
  swatch.value = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#5865F2';

  const hex = el('input');
  hex.type = 'text';
  hex.value = swatch.value.toUpperCase();
  hex.spellcheck = false;
  hex.setAttribute('aria-label', `${label} hex code`);

  swatch.addEventListener('input', () => {
    hex.value = swatch.value.toUpperCase();
    hex.classList.remove('bad');
    onChange(hex.value);
  });
  hex.addEventListener('input', () => {
    const v = hex.value.trim();
    const full = v.startsWith('#') ? v : `#${v}`;
    // Typing a hex goes character by character, so half of what is typed is
    // never going to be valid. Marking it rather than rejecting it lets the
    // field finish being typed into.
    if (!/^#[0-9a-f]{6}$/i.test(full)) { hex.classList.add('bad'); return; }
    hex.classList.remove('bad');
    swatch.value = full;
    onChange(full.toUpperCase());
  });

  row.append(swatch, hex);
  l.append(row);
  return l;
}

/**
 * The {token} chips.
 *
 * Clicking one drops it into whichever box you were last typing in, at the
 * cursor. Typing them by hand works too — this is so you do not have to
 * remember which message understands which.
 */
function tokenChips(tokens, focusRef) {
  const wrap = el('div', 'field');
  const head = el('div', 'field-head');
  head.append(el('span', null, 'Placeholders'), el('span', 'count', 'click to insert'));
  wrap.append(head);

  const box = el('div', 'chipset');
  for (const t of tokens) {
    const b = el('button', 'chip-toggle mono', t);
    b.type = 'button';
    b.addEventListener('click', () => {
      const input = focusRef.el;
      if (!input) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      input.value = input.value.slice(0, start) + t + input.value.slice(end);
      input.setSelectionRange(start + t.length, start + t.length);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
    box.append(b);
  }
  wrap.append(box);
  return wrap;
}

/** Remembers the last box you typed in, so a chip knows where to go. */
function trackFocus(node, focusRef) {
  for (const input of node.querySelectorAll('input[type="text"], textarea')) {
    input.addEventListener('focus', () => { focusRef.el = input; });
  }
  return node;
}

// Which rows the bot appends itself, per message. Named here rather than sent
// from the server because they are a fact about the preview, not about the
// stored style.
const FIXED_FIELDS = {
  'log.action': ['User', 'Moderator', 'Reason'],
  'dm.action': ['📋 Reason'],
  'member.leave': ['👥 Members Left', '⏳ Time in Server'],
  'ticket.opened': ['Support Team'],
};

const PART_LABEL = {
  enabled: 'Send this message',
  thumbnail: 'Show a picture in the corner',
  timestamp: 'Show the time',
};

function appearanceEntries() {
  return (state.overview?.appearance?.groups || []).flatMap(g => g.entries);
}

function renderAppearanceIndex() {
  const wrap = $('#appearance-index');
  const groups = state.overview?.appearance?.groups || [];
  if (!groups.length) { wrap.replaceChildren(el('p', 'muted', 'Nothing to style yet.')); return; }

  const nodes = [];
  for (const g of groups) {
    nodes.push(el('p', 'index-group', g.name));
    for (const e of g.entries) {
      const b = el('button', 'tpl-entry');
      b.type = 'button';
      b.append(el('span', 'nm', e.label));
      const meta = el('span', 'mt');
      // A dot for "this server has changed it" and a slash for "switched off",
      // so the list says what is different without opening anything.
      meta.textContent = `${e.values.enabled === false ? '⃠' : ''}${e.changed ? '●' : ''}`;
      meta.title = [e.changed ? 'changed from the shipped wording' : null,
        e.values.enabled === false ? 'not being sent' : null].filter(Boolean).join(' · ');
      b.append(meta);
      if (e.key === state.styleKey) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => { state.styleKey = e.key; renderAppearance(); });
      nodes.push(b);
    }
  }
  wrap.replaceChildren(...nodes);
}

function renderAppearance() {
  const data = state.overview?.appearance;
  const body = $('#appearance-body');
  if (!body) return;
  if (!data) { body.replaceChildren(); return; }

  const entries = appearanceEntries();
  if (!entries.length) { body.replaceChildren(el('p', 'muted', 'Nothing to style yet.')); return; }
  if (!entries.some(e => e.key === state.styleKey)) state.styleKey = entries[0].key;

  const count = $('#appearance-count');
  if (count) {
    count.textContent = data.changedCount ? `${data.changedCount} changed` : 'all default';
    count.classList.toggle('on', data.changedCount > 0);
  }
  renderAppearanceIndex();

  const entry = entries.find(e => e.key === state.styleKey);
  const values = { ...entry.values };
  const sample = { ...(data.sample || {}), server: state.overview?.guild?.name || 'your server' };
  const focusRef = { el: null };

  const card = el('article', 'panel');
  const head = el('div', 'queue-head');
  head.append(el('h2', null, entry.label), el('span', 'tag', entry.key));
  card.append(head, el('p', 'muted', entry.blurb));
  if (entry.wordingNote) card.append(el('p', 'hint', entry.wordingNote));

  const preview = el('div', 'style-preview');
  const previewEntry = { ...entry, fixedFields: FIXED_FIELDS[entry.key] || [] };
  const repaint = () => {
    preview.replaceChildren(
      values.enabled === false
        ? el('p', 'muted', 'Switched off — this message is not sent at all.')
        : stylePreview(previewEntry, values, sample),
    );
  };

  const fields = el('div');
  for (const part of entry.parts) {
    if (part === 'enabled') {
      fields.append(toggle(PART_LABEL.enabled, values.enabled !== false, v => { values.enabled = v; repaint(); }));
    } else if (part === 'color') {
      fields.append(colorField('Colour', values.color, v => { values.color = v; repaint(); }));
    } else if (part === 'title') {
      fields.append(textField(entry.shape === 'action' ? 'The line' : 'Title',
        values.title, v => { values.title = v; repaint(); }));
    } else if (part === 'body') {
      fields.append(areaField(entry.bodyLabel || 'Body', values.body, v => { values.body = v; repaint(); }, 3));
      if (entry.bodyHint) fields.append(el('p', 'hint', entry.bodyHint));
    } else if (part === 'footer') {
      fields.append(textField('Footer', values.footer, v => { values.footer = v; repaint(); }));
    } else if (part === 'thumbnail' || part === 'timestamp') {
      fields.append(toggle(PART_LABEL[part], !!values[part], v => { values[part] = v; repaint(); }));
    } else if (part === 'buttons') {
      fields.append(buttonEditors(entry, values, repaint));
    } else if (part === 'palette') {
      fields.append(paletteEditors(entry, values, repaint));
    }
  }
  card.append(trackFocus(fields, focusRef));
  card.append(tokenChips(entry.tokens, focusRef));

  const save = el('button', 'btn primary small', 'Save');
  save.type = 'button';
  save.addEventListener('click', async () => {
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      const payload = { key: entry.key };
      for (const part of entry.parts) payload[part] = values[part];
      // Sent as a map keyed by id — the server matches those against the ids
      // the message actually declares, so a stale tab cannot invent one.
      if (entry.parts.includes('palette')) payload.palette = values.palette;
      if (entry.parts.includes('buttons')) {
        payload.buttons = Object.fromEntries((values.buttons || []).map(b =>
          [b.id, { label: b.label, emoji: b.emoji, style: b.style }]));
      }
      const res = await post('appearance', payload);
      if (res?.ok) {
        state.overview = await get(`/api/guild/${state.guildId}`);
        renderOverview();
      }
    } finally {
      save.disabled = false;
      save.textContent = 'Save';
    }
  });

  const revert = el('button', 'btn small', 'Undo my edits');
  revert.type = 'button';
  revert.addEventListener('click', () => renderAppearance());

  const reset = el('button', 'btn small danger', 'Back to default');
  reset.type = 'button';
  reset.disabled = !entry.changed;
  reset.addEventListener('click', async () => {
    if (!await askConfirm({
      title: `Put "${entry.label}" back?`,
      message: 'Your wording and colour for this one message are dropped and the shipped version comes back. Nothing else is touched.',
      confirmLabel: 'Put it back',
    })) return;
    const res = await post('appearancereset', { key: entry.key });
    if (res?.ok) {
      state.overview = await get(`/api/guild/${state.guildId}`);
      renderOverview();
    }
  });

  const foot = el('div', 'actions');
  foot.append(save, revert, reset);
  card.append(foot);

  const shown = el('article', 'panel');
  shown.append(el('h2', null, 'How it will look'), preview,
    el('p', 'hint', 'A likeness, not a screenshot. The names and numbers are stand-ins — the real ones go in when it is sent.'));

  repaint();
  body.replaceChildren(card, shown);
}

/* ── start a giveaway ──────────────────────────────────────────────────── */

let gawPreviewTimer = null;

// Bounded on purpose. An unbounded retry would keep the page requesting
// forever whenever the render pacer stayed busy, and a preview is cosmetic —
// it is not worth a permanent poll.
const PREVIEW_RETRIES = 4;

function refreshGawPreview(draft, attempt = 0) {
  clearTimeout(gawPreviewTimer);
  gawPreviewTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/preview/giveaway?amount=${draft.amount}&winners=${draft.winners}`,
        { credentials: 'same-origin', headers: authHeaders() });
      if (res.status === 429) {
        if (attempt < PREVIEW_RETRIES) gawPreviewTimer = setTimeout(() => refreshGawPreview(draft, attempt + 1), 320);
        return;
      }
      if (!res.ok) return;
      const img = $('#gaw-preview');
      const previous = img.src;
      img.src = URL.createObjectURL(await res.blob());
      if (previous.startsWith('blob:')) URL.revokeObjectURL(previous);
    } catch { /* preview is cosmetic; a failure must not block launching */ }
  }, 320);
}

function renderGiveawayForm() {
  const form = $('#form-gaw');
  const draft = { kind: 'coins', amount: 5000, prize: '', winners: 1, duration: '1h', channelId: '',
                  mention: null, requiredRoleId: null, bonusRoleId: null, minAccountAgeDays: 0 };

  const bump = () => refreshGawPreview(draft);

  // Coins pay out automatically; a prize is announced and handed over by you.
  // Only one of the two fields is ever relevant, so the other is hidden rather
  // than left sitting there inert.
  const amountField = textField('Coins each winner gets', '5000', v => { draft.amount = Number(v); bump(); });
  const prizeField = textField('What you are giving away', '', v => { draft.prize = v; },
    { placeholder: 'Blue Guardian $10k account' });
  prizeField.style.display = 'none';

  // Prize giveaways can carry a banner; coins ones already draw their own.
  // Either a generated image — the Prize giveaway one is editable in Studio —
  // or a link, with the picker winning if both are filled in.
  const generated = (state.overview?.composerMeta?.dynamicImages || [])
    .map(d => ({ value: d, label: `Generated · ${d.slice(8)}` }));
  let pickedImage = '', typedImage = '';
  const syncImage = () => { draft.imageUrl = pickedImage || typedImage || null; };

  const imagePick = select('Banner', '', generated, v => { pickedImage = v; syncImage(); },
    { blank: 'None, or paste a link below' });
  const imageUrlField = textField('Image link (https)', '', v => { typedImage = v.trim(); syncImage(); },
    { placeholder: 'https://…' });
  const imageNote = el('p', 'hint', 'The Prize giveaway banner can be reworded in Studio, and every giveaway using it picks that up.');
  for (const node of [imagePick, imageUrlField, imageNote]) node.style.display = 'none';

  const kindField = select('Type', 'coins', [
    { value: 'coins', label: 'Coins — paid out automatically' },
    { value: 'prize', label: 'Prize — announced, you hand it over' },
  ], v => {
    draft.kind = v;
    amountField.style.display = v === 'coins' ? '' : 'none';
    prizeField.style.display = v === 'prize' ? '' : 'none';
    for (const node of [imagePick, imageUrlField, imageNote]) {
      node.style.display = v === 'prize' ? '' : 'none';
    }
    // A prize giveaway does not use the coins banner, so its preview would be
    // showing something that will not be posted.
    $('#gaw-preview').closest('.stage').style.display = v === 'coins' ? '' : 'none';
    if (v === 'coins') bump();
  });

  form.replaceChildren(
    kindField,
    amountField,
    prizeField,
    imagePick,
    imageUrlField,
    imageNote,
    textField('Winners', '1', v => { draft.winners = Number(v); bump(); }),
    durationField('Runs for', '1h', v => { draft.duration = v; }),
    pickOne('Channel', 'channel', '', v => { draft.channelId = v; }, { blank: 'Pick a channel' }),
    mentionPicker('Ping with the post', null, v => { draft.mention = v; }),
    pickOne('Only this role may enter', 'role', '', v => { draft.requiredRoleId = v; }, { blank: 'Anyone' }),
    pickOne('Extra entries for', 'role', '', v => { draft.bonusRoleId = v; }, { blank: 'No bonus role' }),
    textField('Minimum account age (days)', '0', v => { draft.minAccountAgeDays = Number(v); }),
    actions(async () => {
      if (!draft.channelId) { toast('Pick a channel first.', 'bad'); return; }
      if (!parseDurationMs(draft.duration)) { toast('Duration must look like 30s, 10m, 6h or 2d.', 'bad'); return; }
      const what = draft.kind === 'coins' ? `${num(draft.amount)} coins` : (draft.prize || 'a prize');
      if (!await askConfirm({
        title: 'Launch this giveaway?',
        message: `${what} to ${draft.winners} winner${draft.winners === 1 ? '' : 's'}, running for ${humanDuration(draft.duration)}. It posts to the channel straight away.`,
        confirmLabel: 'Launch it',
      })) return;
      await post('giveawaystart', draft);
    }, { label: 'Launch giveaway', busyLabel: 'Launching…' }),
  );

  // Only draw it when that section is actually on screen. Rendering a preview
  // for a panel nobody is looking at costs a blocked event loop for nothing.
  state.gawBump = bump;
  if (root.dataset.section === 'giveaways') bump();
}

/* ── lottery ───────────────────────────────────────────────────────────── */

function renderLottery() {
  const l = state.overview?.features?.lottery;
  const wrap = $('#lottery-live');
  if (!l) { wrap.replaceChildren(); return; }

  const nodes = [
    row('Tickets in the pot', num(l.totalTickets)),
    row('Players today', num(l.participants)),
    row('Prize', `${num(l.reward)} coins`),
  ];

  if (l.open && l.nextDrawAt) {
    // The draw is daily, so the bar runs from the previous one. Without that
    // it filled from whenever the page happened to be opened.
    const c = countdownEl(l.nextDrawAt, l.lastDrawAt || l.nextDrawAt - 86400000);
    const line = el('div', 'row');
    line.append(el('span', 'k', 'Next draw'), c.node);
    nodes.push(line, c.bar);
  } else if (!l.open) {
    // No countdown when there is nothing to count down to, and a plain
    // statement of what that means for the coins already in the pot. A
    // paused lottery holding tickets is real money frozen, and the person
    // who paused it is the only one who can unfreeze it.
    const why = l.closedReason === 'paused'
      ? 'Paused — no draw will run, and tickets are not on sale.'
      : 'No results channel set, so no draw can run. Tickets are not on sale.';
    const note = el('p', 'hint bad', l.totalTickets
      ? `${why} ${num(l.totalTickets)} ticket${l.totalTickets === 1 ? '' : 's'} are held in the pot and stay there until it runs again.`
      : why);
    nodes.push(note);
  }

  if (l.top.length) {
    nodes.push(el('h2', null, 'Most tickets'));
    const board = el('ol', 'board');
    board.append(...l.top.map((t, i) => {
      const li = el('li');
      li.append(
        el('span', 'rank', `${i + 1}`),
        el('span', 'name', t.name || 'left the server'),
        el('span', 'bal', `${num(t.tickets)}`),
      );
      return li;
    }));
    nodes.push(board);
  } else {
    nodes.push(el('p', 'muted', 'Nobody has bought a ticket today.'));
  }

  const act = el('div', 'actions');
  const clear = el('button', 'btn small danger', 'Void today\'s pool');
  clear.type = 'button';
  clear.title = 'Clears entries without paying anyone. Drawing stays on its schedule.';
  clear.addEventListener('click', async () => {
    if (!await askConfirm({
      title: "Clear today's lottery?",
      message: 'Every entry is discarded. Nobody is paid out and no tickets are refunded.',
      confirmLabel: 'Clear the pool', danger: true,
    })) return;
    await post('lotteryclear', {});
  });
  act.append(clear);
  nodes.push(act);

  wrap.replaceChildren(...nodes);
}

/* ── economy ───────────────────────────────────────────────────────────────
   Eight activity cards, a jobs board and the two dials above them. The cards
   are built from the field descriptions the server sends rather than written
   out here, so adding a setting to utils/economySettings.js puts it on screen
   without touching this file. */

const HOUR_LABEL = h => `${String(h).padStart(2, '0')}:00`;

function econField(f, value, onChange) {
  if (f.type === 'bool') return toggle(f.label, !!value, onChange);
  if (f.type === 'duration') return durationField(f.label, value ?? '', onChange);
  const range = f.min != null ? ` (${f.min}–${num(f.max)})` : '';
  return textField(`${f.label}${range}`, value == null ? '' : String(value), v => onChange(Number(v)));
}

function renderEconomy() {
  const e = state.overview?.economy;
  if (!e) return;

  /* -- the server-wide dials --------------------------------------------- */
  const g = { multiplier: e.global.multiplier, boost: { ...e.global.boost } };
  const boostPill = $('#boost-state');
  if (boostPill) {
    boostPill.hidden = !e.global.active;
    boostPill.textContent = 'Boost hour running';
    boostPill.className = 'pill on';
  }

  const gNote = el('p', 'hint', '');
  const syncG = () => {
    const wraps = g.boost.startHour > g.boost.endHour;
    const empty = g.boost.startHour === g.boost.endHour;
    if (g.boost.enabled && empty) {
      gNote.textContent = 'Start and end are the same hour, so the window never opens. Pick two different hours.';
      gNote.className = 'hint bad';
      return;
    }
    const window = `${HOUR_LABEL(g.boost.startHour)}–${HOUR_LABEL(g.boost.endHour)}${wraps ? ' (over midnight)' : ''}`;
    gNote.textContent = g.boost.enabled
      ? `Everything pays ${g.multiplier}× normally, and ${Math.round(g.multiplier * g.boost.multiplier * 100) / 100}× between ${window}.`
      : `Everything pays ${g.multiplier}× — 1 is the shipped economy.`;
    gNote.className = 'hint';
  };

  const hourOptions = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: HOUR_LABEL(h) }));

  $('#form-econ-global').replaceChildren(
    textField('Payout multiplier (0.1–10)', String(g.multiplier), v => { g.multiplier = Number(v); syncG(); }),
    toggle('Run a boost hour', g.boost.enabled, v => { g.boost.enabled = v; syncG(); }),
    textField('Boost multiplier (1–10)', String(g.boost.multiplier), v => { g.boost.multiplier = Number(v); syncG(); }),
    select('Starts at', String(g.boost.startHour), hourOptions, v => { g.boost.startHour = Number(v); syncG(); }),
    select('Ends at', String(g.boost.endHour), hourOptions, v => { g.boost.endHour = Number(v); syncG(); }),
    gNote,
    actions(() => post('economyglobal', {
      multiplier: g.multiplier,
      // The hours mean the hours here, on this device — which is what someone
      // typing "6pm" means. The offset travels with them so the bot can work
      // out which UTC hour that actually is.
      boost: { ...g.boost, offsetMinutes: -new Date().getTimezoneOffset() },
    })),
  );
  syncG();

  /* -- one card per activity --------------------------------------------- */
  const wrap = $('#econ-activities');
  wrap.replaceChildren(...e.activities.map(a => {
    const draft = { activity: a.key };
    const card = el('article', 'panel econ-card');
    if (!a.enabled) card.classList.add('off');

    const head = el('div', 'queue-head');
    head.append(el('h2', null, `${a.emoji} ${a.label}`), el('span', 'tag', a.command));
    card.append(head, el('p', 'muted', a.blurb));

    const note = el('p', 'hint', '');
    const values = { ...a.values };
    const syncNote = () => {
      // Only the pairs can be wrong on their own; everything else is bounded
      // by the input itself.
      const bad = ('min' in values && Number(values.min) > Number(values.max))
        || ('rewardMin' in values && Number(values.rewardMin) > Number(values.rewardMax));
      note.textContent = bad
        ? 'The lowest payout is above the highest — nothing could be rolled between them.'
        : values.enabled === false ? 'Members are told this command is closed.' : '';
      note.className = `hint${bad ? ' bad' : ''}`;
    };

    for (const f of a.fields) {
      card.append(econField(f, values[f.key], v => {
        values[f.key] = v;
        draft[f.key] = v;
        if (f.key === 'enabled') card.classList.toggle('off', v === false);
        syncNote();
      }));
    }
    card.append(note, actions(() => post('economy', { ...draft, activity: a.key })));
    syncNote();
    return card;
  }));

  /* -- the jobs board ---------------------------------------------------- */
  const jobs = Object.fromEntries(e.jobs.map(j => [j.id, j.open]));
  const jobNote = el('p', 'hint', '');
  const syncJobs = () => {
    const open = Object.values(jobs).filter(Boolean).length;
    jobNote.textContent = open === 0
      ? 'At least one job has to stay open — use the switch on the Jobs card to close the command instead.'
      : `${open} of ${e.jobs.length} hiring.`;
    jobNote.className = `hint${open === 0 ? ' bad' : ''}`;
  };

  $('#form-econ-jobs').replaceChildren(
    ...e.jobs.map(j => {
      const t = toggle(`${j.label} · ${j.pay} · ${j.shift}`, j.open, v => { jobs[j.id] = v; syncJobs(); });
      return t;
    }),
    jobNote,
    actions(() => post('economyjobs', { jobs })),
  );
  syncJobs();
}

/* ── trading cards ─────────────────────────────────────────────────────── */

const RARITY_TINT = {
  common: '#9E9E9E', uncommon: '#43A047', rare: '#1E88E5',
  epic: '#8E24AA', legendary: '#FFD700', mythic: '#FF1744',
};

function renderCards() {
  const c = state.overview?.cards;
  if (!c) return;

  /* -- how often they drop ---------------------------------------------- */
  const drops = { ...c.values };
  $('#cards-count').textContent = `${c.totals.enabled}/${c.totals.catalogue} dropping`;
  $('#cards-count').hidden = false;

  $('#form-cards').replaceChildren(
    ...c.fields.flatMap(f => [
      textField(`${f.label} (${f.min}–${f.max})`, drops[f.key], v => { drops[f.key] = Number(v); }),
      el('p', 'hint', f.hint),
    ]),
    pickOne('Drop channel', 'channel', drops.channelId, v => { drops.channelId = v; }, { blank: 'Anywhere members talk' }),
    el('p', 'hint', 'Left blank, a card can drop in any channel that reaches the count.'),
    actions(() => post('carddrops', drops)),
  );

  /* -- the odds and the payouts ------------------------------------------ */
  const rarity = Object.fromEntries(c.rarities.map(r => [r.key, { weight: r.weight, price: r.price }]));
  const oddsNote = el('p', 'hint', '');
  const syncOdds = () => {
    const total = Object.values(rarity).reduce((s, r) => s + (Number(r.weight) || 0), 0);
    oddsNote.textContent = total > 0
      ? c.rarities.map(r => `${r.label} ${Math.round(((Number(rarity[r.key].weight) || 0) / total) * 1000) / 10}%`).join('  ·  ')
      : 'Every tier is at zero, so nothing could drop — give at least one a weight.';
    oddsNote.className = `hint${total > 0 ? '' : ' bad'}`;
  };

  $('#form-card-rarity').replaceChildren(
    ...c.rarities.map(r => {
      const row = el('div', 'subfield');
      const head = el('span', 'k', `${r.emoji} ${r.label} · ${r.cards} card${r.cards === 1 ? '' : 's'}`);
      head.style.borderLeft = `3px solid ${RARITY_TINT[r.key] || 'var(--rule)'}`;
      head.style.paddingLeft = '0.5rem';
      row.append(
        head,
        textField('Weight', r.weight, v => { rarity[r.key].weight = Number(v); syncOdds(); }),
        textField('Sells for (coins)', r.price, v => { rarity[r.key].price = Number(v); }),
      );
      return row;
    }),
    oddsNote,
    actions(() => post('cardrarity', { rarity })),
  );
  syncOdds();

  /* -- the catalogue ------------------------------------------------------ */
  $('#cards-collected').textContent = `${c.totals.collected.toLocaleString()} held by ${c.totals.collectors}`;
  $('#cards-collected').hidden = false;

  const picked = Object.fromEntries(c.cards.map(x => [x.id, x.enabled]));
  const listNote = el('p', 'hint', '');
  const syncList = () => {
    const on = Object.values(picked).filter(Boolean).length;
    listNote.textContent = on === 0
      ? 'At least one card has to stay on, or there would be nothing to drop.'
      : `${on} of ${c.cards.length} dropping.`;
    listNote.className = `hint${on === 0 ? ' bad' : ''}`;
  };

  // Grouped by tier, in the order they get rarer — a flat list of sixty-odd
  // switches is a wall, and the tier is the thing you are usually filtering by.
  const list = $('#card-list');
  list.replaceChildren(...c.rarities.map(r => {
    const group = el('details', 'item');
    const sum = el('summary');
    const badge = el('span', 'bstyle secondary', r.label);
    badge.style.borderLeft = `3px solid ${RARITY_TINT[r.key] || 'var(--rule)'}`;
    const mine = c.cards.filter(x => x.rarity === r.key);
    sum.append(
      badge,
      el('span', 'nm', `${mine.length} cards`),
      el('span', 'pr', `${mine.reduce((s, x) => s + x.held, 0).toLocaleString()} held`),
    );
    const body = el('div', 'body');
    body.append(...mine.map(x => toggle(
      `${x.emoji} ${x.name} — ${x.desc}${x.held ? `  ·  ${x.held} held` : ''}`,
      x.enabled,
      v => { picked[x.id] = v; syncList(); },
    )));
    group.append(sum, body);
    return group;
  }));

  $('#form-card-list').replaceChildren(listNote, actions(() => post('cardlist', { cards: picked })));
  syncList();
}

/* ── verification ──────────────────────────────────────────────────────── */

function renderVerifyPanel() {
  const draft = { channelId: state.overview?.features?.groups?.verify?.values?.channelId || null };
  const form = $('#form-verifypanel');
  if (!form) return;

  form.replaceChildren(
    pickOne('Channel', 'channel', draft.channelId, v => { draft.channelId = v; }),
    actions(async () => {
      if (!draft.channelId) { toast('Pick a channel first.', 'bad'); return; }
      if (!await askConfirm({
        title: 'Post the verification panel?',
        message: 'Members in that channel will see it straight away. Posting again makes a second panel — it does not move the first.',
        confirmLabel: 'Post it',
      })) return;
      await post('verifypanel', draft);
    }, { label: 'Post it', busyLabel: 'Posting…' }),
  );
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

/* ── reports, cases and warnings ───────────────────────────────────────────
   Reports lead the section because they are the only thing here waiting on a
   person. Everything below is reference or settings. */

function renderModeration() {
  const m = state.overview?.mod;
  if (!m) return;

  /* -- the report queue -------------------------------------------------- */
  const chState = $('#report-channel-state');
  chState.textContent = m.reports.channel
    ? `Filed to #${m.reports.channel}`
    : 'No report channel set — /report cannot be used';
  chState.className = `hint${m.reports.channel ? '' : ' bad'}`;

  const count = $('#report-count');
  count.hidden = m.reports.open.length === 0;
  count.textContent = String(m.reports.open.length);

  const open = $('#report-open');
  open.replaceChildren(...(m.reports.open.length ? m.reports.open.map(r => {
    const d = el('button', 'gaw tappable');
    d.type = 'button';
    const top = el('div', 'gaw-top');
    // Repeat offenders are the ones worth spotting from the list.
    const repeat = r.priorActioned > 0 || r.warnings > 0;
    top.append(
      el('span', `kind ${repeat ? 'sev-warn' : 'sev-clear'}`, repeat ? 'REPEAT' : 'NEW'),
      el('span', 'nm', r.targetName),
    );
    d.append(top);
    d.append(el('p', 'hint', `${r.reason} · from ${r.reporterName}${r.createdAt ? ` · ${relativeTime(r.createdAt)}` : ''}`));
    const bits = [];
    if (r.warnings) bits.push(`${r.warnings} warning${r.warnings === 1 ? '' : 's'}`);
    if (r.priorActioned) bits.push(`${r.priorActioned} report${r.priorActioned === 1 ? '' : 's'} actioned before`);
    if (!r.inServer) bits.push('no longer in the server');
    if (bits.length) d.append(el('p', 'hint', bits.join(' · ')));
    d.append(el('span', 'chev', '›'));
    d.addEventListener('click', () => openReport(r));
    return d;
  }) : [el('p', 'muted', 'No reports waiting.')]));

  /* -- members with warnings --------------------------------------------- */
  const warned = $('#warned-list');
  warned.replaceChildren(...(m.warned.length ? m.warned.map(w => {
    const r = el('div', 'permit');
    r.append(el('span', 'who', w.name));
    const right = el('div', 'permit-right');
    right.append(el('span', `pill ${w.count >= 3 ? 'wait' : 'off'}`, `${w.count} warning${w.count === 1 ? '' : 's'}`));
    const clear = el('button', 'btn small', 'Clear');
    clear.type = 'button';
    clear.addEventListener('click', async () => {
      if (!await askConfirm({
        title: `Clear warnings for ${w.name}?`,
        message: `All ${w.count} warning${w.count === 1 ? '' : 's'} are removed. Kicks and bans stay on the case log — those are a record of something that happened.`,
        confirmLabel: 'Clear them', danger: true,
      })) return;
      clear.disabled = true;
      await post('warnclear', { userId: w.userId });
    });
    right.append(clear);
    r.append(right);
    return r;
  }) : [el('p', 'muted', 'Nobody has a warning.')]));

  // The case log itself lives in Discord, where it belongs — this is just the
  // running total, so the number is still visible without a second list.
  $('#case-total').textContent = m.caseTotal ? `${num(m.caseTotal)} cases logged` : '';

  /* -- automatic punishment ---------------------------------------------- */
  const ws = { ...m.warnSettings };
  const muteField = textField('Mute length (minutes)', String(ws.muteMinutes), v => { ws.muteMinutes = Number(v); });
  muteField.style.display = ws.action === 'mute' ? '' : 'none';

  $('#form-warnsettings').replaceChildren(
    textField('Act after this many warnings — 0 for never', String(ws.threshold), v => { ws.threshold = Number(v); }),
    select('What to do', ws.action, [
      { value: 'kick', label: 'Kick them' },
      { value: 'ban', label: 'Ban them' },
      { value: 'mute', label: 'Time them out' },
    ], v => { ws.action = v; muteField.style.display = v === 'mute' ? '' : 'none'; }),
    muteField,
    actions(() => post('warnsettings', ws)),
  );

  /* -- filtered words ----------------------------------------------------- */
  const words = { customWords: m.filters.customWords.slice() };
  $('#form-badwords').replaceChildren(
    areaField(`Words and phrases, one per line (${m.filters.customWords.length})`,
      words.customWords.join('\n'),
      v => { words.customWords = v.split('\n').map(w => w.trim()).filter(Boolean); }, 5),
    actions(() => post('moderation', words)),
  );
}

/** A report, and everything that can be done about it. */
function openReport(r) {
  const body = [
    sheetRow('Reported', `${r.targetName} (${r.targetTag})`),
    sheetRow('Reason', r.reason),
    sheetRow('Reported by', r.reporterName),
    sheetRow('Account age', r.accountAge),
    sheetRow('Still here', r.inServer ? 'yes' : 'no'),
    sheetRow('Warnings', String(r.warnings)),
    sheetRow('Past reports', r.priorReports
      ? `${r.priorReports} · ${r.priorActioned} actioned`
      : 'none'),
  ];
  if (r.link) body.push(sheetRow('Message', el('span', 'v mono wrap', r.link)));

  const why = { text: '' };
  body.push(textField('Reason to record (optional)', '', v => { why.text = v; }));

  const timeout = { minutes: 60 };
  const timeoutField = textField('Timeout length (minutes)', '60', v => { timeout.minutes = Number(v); });
  body.push(timeoutField);

  const act = (label, action, danger) => {
    const b = el('button', `btn ${danger ? 'danger' : ''}`.trim(), label);
    b.type = 'button';
    // A member who has left can still be banned, but not kicked or timed out.
    if (!r.inServer && (action === 'kick' || action === 'timeout')) b.disabled = true;
    b.addEventListener('click', async () => {
      if (b.dataset.armed !== '1' && action !== 'dismiss') {
        b.dataset.armed = '1';
        b.textContent = `Tap again to ${label.toLowerCase()}`;
        return;
      }
      b.disabled = true;
      const out = await post('report', {
        reportId: r.id, action, reason: why.text,
        timeoutMinutes: timeout.minutes,
      });
      if (out) closeSheet();
      else { b.disabled = false; b.dataset.armed = ''; b.textContent = label; }
    });
    return b;
  };

  openSheet(`Report · ${r.targetName}`, body, [
    act('Warn', 'warn', false),
    act('Timeout', 'timeout', false),
    act('Kick', 'kick', true),
    act('Ban', 'ban', true),
    act('Dismiss', 'dismiss', false),
  ]);
}

/* ── link requests ─────────────────────────────────────────────────────────
   The queue used to live only as cards in the mod-log channel, which means
   noticing one requires being in Discord, on the right channel, at the time.

   Each row leads with the domain rather than the member, because that is what
   the decision is actually about, and carries the worst signal found so a row
   that needs reading looks different from one that does not. */

const SEVERITY_LABEL = { danger: 'CHECK', warn: 'LOOK', clear: 'CLEAR' };

function renderLinkRequests() {
  const l = state.overview?.links;
  if (!l) return;

  const stateLine = $('#link-filter-state');
  stateLine.textContent = l.filterOn
    ? 'Link filter is on'
    : 'Link filter is off — nothing new will arrive here';
  stateLine.className = `hint${l.filterOn ? '' : ' bad'}`;

  const count = $('#link-count');
  count.hidden = l.waiting.length === 0;
  count.textContent = String(l.waiting.length);

  /* -- waiting on a decision --------------------------------------------- */
  const wrap = $('#link-waiting');
  const rows = l.waiting.map(r => {
    const d = el('button', 'gaw tappable');
    d.type = 'button';
    const top = el('div', 'gaw-top');
    top.append(
      el('span', `kind sev-${r.severity}`, SEVERITY_LABEL[r.severity] || 'LOOK'),
      el('span', 'nm', r.domain || 'unreadable address'),
    );
    d.append(top);
    d.append(el('p', 'hint', `${r.displayName} · in #${r.channel || 'a deleted channel'}${r.createdAt ? ` · ${relativeTime(r.createdAt)}` : ''}`));
    if (r.flags.length) d.append(el('p', 'hint', r.flags[0].text));
    d.append(el('span', 'chev', '›'));
    d.addEventListener('click', () => openLinkRequest(r));
    return d;
  });

  // An unfinished request still blocks that member from opening another one,
  // so it has to be visible and clearable even though there is nothing to
  // decide on it yet.
  for (const r of l.unfinished) {
    const d = el('div', 'gaw');
    const top = el('div', 'gaw-top');
    top.append(el('span', 'kind sev-idle', 'UNSENT'), el('span', 'nm', r.displayName));
    d.append(top);
    d.append(el('p', 'hint', 'Was told to ask but never filled the form in. This still blocks them from opening another request.'));
    const act = el('div', 'actions');
    const drop = el('button', 'btn small', 'Clear it');
    drop.type = 'button';
    drop.addEventListener('click', async () => {
      drop.disabled = true;
      await post('linkrequest', { requestId: r.id, action: 'discard' });
    });
    act.append(drop);
    d.append(act);
    rows.push(d);
  }

  wrap.replaceChildren(...(rows.length ? rows : [el('p', 'muted', 'Nothing waiting.')]));

  /* -- standing permissions ---------------------------------------------- */
  // Its own row rather than the generic one: a name, a state and a button do
  // not sit on a shared baseline, and the button needs to be held off the
  // text rather than butted against it.
  const permits = $('#link-permits');
  permits.replaceChildren(...(l.permits.length ? l.permits.map(p => {
    const r = el('div', 'permit');
    r.append(el('span', 'who', p.displayName));

    const right = el('div', 'permit-right');
    const state = p.state === 'locked'
      ? { cls: 'off', text: `locked ${readableWait(p.secondsLeft)}` }
      : p.state === 'waiting'
        ? { cls: 'wait', text: `next in ${readableWait(p.secondsLeft)}` }
        : { cls: 'on', text: 'may post now' };
    right.append(el('span', `pill ${state.cls}`, state.text));

    const revoke = el('button', 'btn small danger', 'Revoke');
    revoke.type = 'button';
    revoke.addEventListener('click', async () => {
      if (!await askConfirm({
        title: 'Revoke this permission?',
        message: `${p.displayName} will need to ask again before posting another link.`,
        confirmLabel: 'Revoke it', danger: true,
      })) return;
      revoke.disabled = true;
      await post('linkrevoke', { userId: p.userId });
    });
    right.append(revoke);

    r.append(right);
    return r;
  }) : [el('p', 'muted', 'Nobody has a standing permission.')]));

  /* -- recently decided --------------------------------------------------- */
  const recent = $('#link-recent');
  recent.replaceChildren(...(l.recent.length ? l.recent.map(r => {
    const row = el('div', 'row');
    row.append(el('span', 'k', `${r.status === 'approved' ? '✅' : '❌'} ${r.domain || '—'}`));
    row.append(el('span', 'v dim',
      `${r.displayName}${r.decidedBy ? ` · by ${r.decidedBy}` : ''}${r.decidedAt ? ` · ${relativeTime(r.decidedAt)}` : ''}`));
    return row;
  }) : [el('p', 'muted', 'No decisions yet.')]));
}

function readableWait(seconds) {
  if (!seconds || seconds < 0) return 'now';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * The full request, and the two decisions.
 *
 * Everything found about the link is laid out before the buttons, because the
 * whole point is that approving should be a judgement rather than a reflex.
 */
function openLinkRequest(r) {
  const body = [];

  const flags = el('div', 'signals');
  for (const f of (r.flags.length ? r.flags : [{ level: 'good', text: 'Nothing unusual about this one.' }])) {
    flags.append(el('p', `signal ${f.level}`, f.text));
  }
  body.push(flags);

  body.push(sheetRow('Link', el('span', 'v mono wrap', r.link || '—')));
  body.push(sheetRow('Asked by', `${r.displayName} (${r.userTag})`));
  body.push(sheetRow('Account age', r.accountAge));
  if (r.memberAge) body.push(sheetRow('In this server', r.memberAge));
  body.push(sheetRow('Past requests', r.history.total > 1
    ? `${r.history.approved} approved · ${r.history.denied} denied`
    : 'This is their first'));
  body.push(sheetRow('Channel', r.channel ? `#${r.channel}` : 'deleted'));

  if (r.reason) {
    const q = el('div', 'quote');
    q.append(el('p', null, r.reason));
    body.push(el('span', 'k', 'Their reason'), q);
  }

  const cool = { value: '24h' };
  body.push(durationField('Then they may post one link every', '24h', v => { cool.value = v; }));

  const approve = el('button', 'btn primary', 'Approve and post it');
  approve.type = 'button';
  approve.addEventListener('click', async () => {
    if (!parseDurationMs(cool.value)) { toast('Cooldown must look like 6h or 7d.', 'bad'); return; }
    approve.disabled = true;
    approve.textContent = 'Posting…';
    const out = await post('linkrequest', { requestId: r.id, action: 'approve', cooldown: cool.value });
    if (out) closeSheet();
    else { approve.disabled = false; approve.textContent = 'Approve and post it'; }
  });

  const denyBtn = el('button', 'btn danger', 'Deny');
  denyBtn.type = 'button';
  denyBtn.addEventListener('click', async () => {
    denyBtn.disabled = true;
    const out = await post('linkrequest', { requestId: r.id, action: 'deny' });
    if (out) closeSheet();
    else denyBtn.disabled = false;
  });

  openSheet(r.domain || 'Link request', body, [approve, denyBtn]);
}

/* ── casino ────────────────────────────────────────────────────────────────
   Three forms rather than one, because they are three different decisions:
   what a bet may be, what the shortcut buttons offer, and which games exist.
   Saving one should not make you re-confirm the other two. */

function renderCasino() {
  const c = state.overview?.casino;
  if (!c) return;

  /* -- table stakes ------------------------------------------------------ */
  const stakes = { ...c.values };
  const stakeNote = el('p', 'hint', '');
  const syncStakeNote = () => {
    const bad = Number(stakes.minBet) >= Number(stakes.maxBet);
    stakeNote.textContent = bad
      ? 'Minimum must be below maximum, or nobody can place a bet at all.'
      : `Bets between ${num(stakes.minBet)} and ${num(stakes.maxBet)} coins.${Number(stakes.cooldownSeconds) > 0 ? ` ${stakes.cooldownSeconds}s between games.` : ' No cooldown between games.'}`;
    stakeNote.className = `hint${bad ? ' bad' : ''}`;
  };

  $('#form-casino').replaceChildren(
    ...c.fields.map(f => textField(`${f.label}${f.key === 'cooldownSeconds' ? ' — 0 for none' : ''}`,
      String(stakes[f.key] ?? ''), v => { stakes[f.key] = Number(v); syncStakeNote(); })),
    stakeNote,
    actions(() => post('casino', stakes)),
  );
  syncStakeNote();

  /* -- quick bets -------------------------------------------------------- */
  const presets = c.presets.slice();
  const presetForm = $('#form-casino-presets');
  const presetNote = el('p', 'hint', '');
  const syncPresetNote = () => {
    // Sorted and de-duplicated server-side, so say so rather than letting the
    // saved order come back looking like the field was ignored.
    const clean = [...new Set(presets.filter(n => n > 0))].sort((a, b) => a - b);
    presetNote.textContent = clean.length < presets.length
      ? `Duplicates and blanks are dropped — this will save as ${clean.join(' / ')} topped up from the defaults.`
      : `Buttons will read ${clean.join(' / ')}, lowest first.`;
  };

  presetForm.replaceChildren(
    ...presets.map((value, i) => textField(`Button ${i + 1}`, String(value), v => {
      presets[i] = Number(v);
      syncPresetNote();
    })),
    presetNote,
    actions(() => post('casino', { presets })),
  );
  syncPresetNote();

  /* -- games ------------------------------------------------------------- */
  const games = Object.fromEntries(c.games.map(g => [g.key, g.enabled]));
  const gamesNote = el('p', 'hint', '');
  const syncGamesNote = () => {
    const on = Object.values(games).filter(Boolean).length;
    gamesNote.textContent = on === 0
      ? 'Every game is off — the casino menu will say it is closed.'
      : `${on} of ${c.games.length} games open.`;
    gamesNote.className = `hint${on === 0 ? ' bad' : ''}`;
  };

  $('#form-casino-games').replaceChildren(
    ...c.games.map(g => toggle(g.label, g.enabled, v => { games[g.key] = v; syncGamesNote(); })),
    gamesNote,
    actions(() => post('casino', { games })),
  );
  syncGamesNote();
}

/* ── tickets ───────────────────────────────────────────────────────────── */

function renderTickets() {
  const t = state.overview?.tickets;
  if (!t) return;

  /* -- the open list ---------------------------------------------------- */
  const wrap = $('#ticket-open');
  if (!t.open.length) {
    wrap.replaceChildren(el('p', 'muted', 'No tickets are open right now.'));
  } else {
    wrap.replaceChildren(...t.open.map(tk => {
      const d = el('div', 'gaw');
      const top = el('div', 'gaw-top');
      top.append(el('span', 'kind prize', 'OPEN'), el('span', 'nm', `#${tk.name}`));
      d.append(top);

      const bits = [];
      if (tk.createdAt) bits.push(`opened ${relativeTime(tk.createdAt)}`);
      d.append(el('p', 'hint', bits.join(' · ') || 'open'));
      if (tk.ownerId) {
        const line = el('div', 'row');
        line.append(el('span', 'k', 'Opened by'), el('span', 'v mono', tk.ownerId));
        d.append(line);
      }

      const act = el('div', 'actions');
      const close = el('button', 'btn small danger', 'Close');
      close.type = 'button';
      close.addEventListener('click', () => openTicketSheet(tk));
      act.append(close);
      d.append(act);
      return d;
    }));
  }

  /* -- settings ---------------------------------------------------------- */
  const draft = { ...t.values };
  $('#form-tickets').replaceChildren(
    pickOne('Support role', 'role', t.supportRoleId, v => { draft.supportRoleId = v; },
      { blank: 'No support role' }),
    ...t.fields.map(f => {
      if (f.type === 'bool') return toggle(f.label, !!draft[f.key], v => { draft[f.key] = v; });
      if (f.type === 'int') {
        return textField(`${f.label} (${f.min}–${f.max})`, String(draft[f.key] ?? ''),
          v => { draft[f.key] = Number(v); });
      }
      return areaField(f.label, draft[f.key] ?? '', v => { draft[f.key] = v; }, 3);
    }),
    el('p', 'hint', 'The nudge message can use {time}, which becomes how long the ticket has been quiet.'),
    actions(() => post('tickets', draft)),
  );

  /* -- post the panel ----------------------------------------------------- */
  const panel = { channelId: '' };
  const postForm = $('#form-ticketpanel');
  postForm.replaceChildren(
    pickOne('Channel', 'channel', '', v => { panel.channelId = v; }, { blank: 'Pick a channel' }),
    actions(async () => {
      if (!panel.channelId) { toast('Pick a channel first.', 'bad'); return; }
      await post('ticketpanel', panel);
    }, { label: 'Post the panel', busyLabel: 'Posting…' }),
  );
}

/** Closing deletes the channel, so it asks in the sheet rather than inline. */
function openTicketSheet(tk) {
  const body = [
    sheetRow('Channel', `#${tk.name}`),
    tk.ownerId ? sheetRow('Opened by', el('span', 'v mono', tk.ownerId)) : null,
    tk.createdAt ? sheetRow('Opened', new Date(tk.createdAt).toLocaleString()) : null,
    el('p', 'note', 'Closing deletes the channel and everything said in it. There is no archive — this cannot be undone.'),
  ].filter(Boolean);

  const close = el('button', 'btn danger', 'Close this ticket');
  close.type = 'button';
  close.addEventListener('click', async () => {
    if (close.dataset.armed !== '1') {
      close.dataset.armed = '1';
      close.textContent = 'Tap again to delete the channel';
      return;
    }
    close.disabled = true;
    const out = await post('ticketclose', { channelId: tk.id });
    if (out) closeSheet();
    else { close.disabled = false; close.dataset.armed = ''; close.textContent = 'Close this ticket'; }
  });

  openSheet(`#${tk.name}`, body, [close]);
}

/** "3 hours ago", for anything with a timestamp and no room for a full date. */
function relativeTime(ts) {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month']];
  let n = secs, unit = 'second';
  for (const [size, name] of steps) {
    if (n < size) { unit = name; break; }
    n = n / size;
    unit = name;
  }
  const rounded = Math.round(n);
  return `${rounded} ${unit}${rounded === 1 ? '' : 's'} ago`;
}

/**
 * Which panel actions are announced in the mod log.
 *
 * Coins are missing from this list on purpose, and the copy says so — an
 * economy change that leaves no trace is the one thing not worth making
 * optional.
 */
function renderPanelLog() {
  const pl = state.overview?.panelLog;
  const form = $('#form-panellog');
  if (!pl) { form.replaceChildren(); return; }

  const draft = { ...pl.values };
  form.replaceChildren(
    ...pl.categories.map(c => toggle(c.label, draft[c.key] !== false, v => { draft[c.key] = v; })),
    actions(() => post('panellog', draft)),
  );
}

/**
 * The Whop embed link.
 *
 * Whop's app reloads whatever URL is sitting in its own embed field, not
 * anything the page did on its own — so once the WebView it uses has closed,
 * neither a cookie nor localStorage can be counted on to still be there.
 * The URL itself is the only thing that survives, because Whop is the one
 * holding onto it. Baking a long-lived, revocable session into that URL is
 * what keeps the embed signed in across the app being closed and reopened.
 */
function initEmbedLink() {
  const getBtn = $('#embed-link-get');
  if (!getBtn || getBtn.dataset.wired) return;
  getBtn.dataset.wired = '1';

  const revokeBtn = $('#embed-link-revoke');
  const row = $('#embed-link-row');
  const input = $('#embed-link-value');
  const note = $('#embed-link-note');

  const showLink = url => {
    input.value = url;
    row.hidden = false;
    revokeBtn.hidden = false;
    note.hidden = false;
    note.textContent = "Anyone with this link can act on your servers here, the same as your own Discord login — treat it like a password and only paste it into Whop's own embed settings.";
  };

  const mint = async () => {
    const res = await fetch('/api/embed-link', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'x-csrf-token': state.csrf, ...authHeaders() },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) { toast('Could not get the link.', 'bad'); return; }
    showLink(data.url);
  };

  getBtn.addEventListener('click', async () => {
    getBtn.disabled = true;
    getBtn.textContent = 'Getting your link…';
    try { await mint(); }
    finally { getBtn.disabled = false; getBtn.textContent = 'Get my Whop link'; }
  });

  revokeBtn.addEventListener('click', async () => {
    revokeBtn.disabled = true;
    try {
      const res = await fetch('/api/embed-link', {
        method: 'DELETE', credentials: 'same-origin',
        headers: { 'x-csrf-token': state.csrf, ...authHeaders() },
      });
      if (!res.ok) { toast('Could not replace the link.', 'bad'); return; }
      await mint();
      toast('New link ready — update Whop with it.', 'good');
    } finally { revokeBtn.disabled = false; }
  });

  $('#embed-link-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(input.value); toast('Copied.', 'good'); }
    catch { input.select(); toast('Select and copy the link manually.'); }
  });
}

/* ── terms & privacy ──────────────────────────────────────────────────────
   The pages themselves are static and public; all this does is show their
   real, absolute addresses. Relative hrefs would open fine, but the thing
   you actually need from this card is a URL to paste into Discord's
   application listing — and for that it has to be the full one. */

function renderLegalLinks() {
  const card = $('#legal-card');
  if (!card) return;
  // Wired once. This runs on every overview refresh, and a second pass would
  // stack a second click handler on each copy button — two toasts, then three.
  if (card.dataset.wired) return;
  card.dataset.wired = '1';

  const absolute = path => new URL(path, location.origin).href;
  const links = {
    terms:   { url: absolute('/terms'),   urlEl: '#legal-terms-url',   copy: '#legal-copy-terms' },
    privacy: { url: absolute('/privacy'), urlEl: '#legal-privacy-url', copy: '#legal-copy-privacy' },
  };

  for (const { url, urlEl, copy } of Object.values(links)) {
    // Shown without the scheme — the address is there to be recognised and
    // copied, and "https://" at the front of both is the part nobody reads.
    $(urlEl).textContent = url.replace(/^https?:\/\//, '');
    $(urlEl).title = url;
    $(copy).addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); toast('Link copied.', 'good'); }
      catch { toast(url); }
    });
  }
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
    // Without this a boolean field fell through to the number input below and
    // rendered as an empty box — which is why the lottery pause never showed
    // up as a switch.
    if (f.type === 'bool') return toggle(f.label, !!v, x => { draft[f.key] = x; });
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
      if (!await askConfirm({
        title: 'Change balances?',
        message: `${draft.mode === 'set' ? 'Set to' : draft.mode === 'give' ? 'Give' : 'Take'} ${num(draft.amount)} coins — ${who}. Coin changes are always written to your mod log.`,
        confirmLabel: 'Do it', danger: draft.mode !== 'give',
      })) return;
      await post('coins', draft);
    }),
  );
}

/* ── automation ────────────────────────────────────────────────────────── */

function templateOptions() {
  return (state.overview?.composer || []).map(t => ({ value: t.name, label: t.name }));
}

// The browser's offset in minutes east of UTC — getTimezoneOffset() reports the
// opposite sign to how the scheduler stores it, so it is negated here once.
const tzOffset = () => -new Date().getTimezoneOffset();

const freqOptions = () => (state.overview?.features?.frequencies || [])
  .map(f => (typeof f === 'string' ? { value: f, label: f } : f));

const freqLabel = value =>
  (state.overview?.features?.frequencies || []).find(f => f.value === value)?.label || value;

const dayOptions = () => state.overview?.features?.scheduleDays || [];

// How a schedule's cadence reads in the list. A weekly one names its day —
// "Every week (pick a day)" is the wording for the picker, not for a row
// describing a schedule that already has one.
const cadenceLabel = s => {
  if (s.frequency !== 'weekly' || s.dayOfWeek === null || s.dayOfWeek === undefined) return freqLabel(s.frequency);
  return `Every ${dayOptions().find(d => d.value === s.dayOfWeek)?.label || 'week'}`;
};

const fmtTime = ts => (ts ? new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'not set');

function renderSchedules() {
  const list = $('#sched-list');
  const items = state.overview?.features?.schedules || [];
  if (!items.length) { list.replaceChildren(el('p', 'muted', 'No scheduled posts.')); return; }

  list.replaceChildren(...items.map(s => {
    const draft = { id: s.id, channelId: s.channelId, embedName: s.embedName, frequency: s.frequency };
    const d = el('details', 'item');
    const sum = el('summary');
    sum.append(
      el('span', 'bstyle secondary', cadenceLabel(s)),
      el('span', 'nm', s.embedName),
      el('span', 'pr', s.channelName ? `#${s.channelName}` : 'channel gone'),
    );
    const body = el('div', 'body');
    // Only a weekly schedule has a day to pick, so the picker appears with it
    // rather than sitting there greyed out on the other cadences.
    const dayPick = select('Day of the week', s.dayOfWeek ?? '', dayOptions(),
      v => { draft.dayOfWeek = v; }, { blank: 'Leave it on its current day' });
    const syncDay = f => { dayPick.style.display = f === 'weekly' ? '' : 'none'; };
    syncDay(s.frequency);
    body.append(
      select('Message to post', s.embedName, templateOptions(), v => { draft.embedName = v; }),
      pickOne('Channel', 'channel', s.channelId, v => { draft.channelId = v; }),
      select('How often', s.frequency, freqOptions(), v => { draft.frequency = v; syncDay(v); }),
      dayPick,
      textField('Time (HH:MM, or "2h" from now)', '', v => { draft.time = v; draft.offsetMinutes = tzOffset(); },
        { placeholder: fmtTime(s.time) }),
      mentionPicker('Ping with the post', s.mention, v => { draft.mention = v; }),
      el('p', 'hint', `Next: ${fmtTime(s.time)}${s.lastRun ? ` · last posted ${new Date(s.lastRun).toLocaleString()}` : ''}`),
    );
    const act = el('div', 'actions');
    const save = el('button', 'btn primary small', 'Save');
    save.type = 'button';
    save.addEventListener('click', () => post('schedule', draft));
    const del = el('button', 'btn small danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', async () => {
      if (!await askConfirm({
        title: 'Delete this schedule?',
        message: 'It stops posting from now on. Anything it has already posted stays.',
        confirmLabel: 'Delete it', danger: true,
      })) return;
      await post('schedule', { id: s.id, remove: true });
    });
    act.append(save, del);
    body.append(act);
    d.append(sum, body);
    return d;
  }));

  // Creating a schedule works here because the browser knows your UTC offset,
  // so a typed "09:30" means the same instant it would from /schedule.
  const add = el('details', 'item');
  const addSum = el('summary');
  addSum.append(el('span', 'nm', '+ Schedule a post'));
  const nb = { embedName: '', channelId: '', frequency: 'everyday', time: '', mention: null, offsetMinutes: tzOffset() };
  const addBody = el('div', 'body');
  const newDayPick = select('Day of the week', '', dayOptions(),
    v => { nb.dayOfWeek = v; }, { blank: 'Whichever day the time lands on' });
  const syncNewDay = f => { newDayPick.style.display = f === 'weekly' ? '' : 'none'; };
  syncNewDay(nb.frequency);
  addBody.append(
    select('Message to post', '', templateOptions(), v => { nb.embedName = v; }, { blank: 'Pick a message' }),
    pickOne('Channel', 'channel', '', v => { nb.channelId = v; }, { blank: 'Pick a channel' }),
    select('How often', 'everyday', freqOptions(), v => { nb.frequency = v; syncNewDay(v); }),
    newDayPick,
    textField('Time', '', v => { nb.time = v; }, { placeholder: '09:30, or 2h from now' }),
    mentionPicker('Ping with the post', null, v => { nb.mention = v; }),
    el('p', 'hint', `Times are read in your timezone (UTC${tzOffset() >= 0 ? '+' : ''}${(tzOffset() / 60).toFixed(2).replace(/\.00$/, '')}).`),
    actions(() => post('schedulenew', nb)),
  );
  add.append(addSum, addBody);
  list.append(add);
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
      if (!await askConfirm({
        title: 'Remove this auto-reply?',
        message: `The bot will stop replying to “${r.trigger}”.`,
        confirmLabel: 'Remove it', danger: true,
      })) return;
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

  // Live copy of what is on screen, so the readout below can be recalculated
  // as you type rather than only after a save.
  const shown = Object.fromEntries(lv.fields.map(f => [f.key, lv.values[f.key] ?? f.fallback ?? '']));

  const rate = el('p', 'hint');
  const syncRate = () => { rate.textContent = describeXpRate(shown); };

  const draft = {};
  const nodes = [];
  for (const f of lv.fields) {
    // A duration keeps its 20s/1m form all the way through — Number() on it
    // would send NaN, which is how a text-shaped field breaks a numeric form.
    const isDuration = f.type === 'duration';
    const label = isDuration ? f.label : `${f.label} (${f.min}–${f.max})`;
    nodes.push(textField(label, String(shown[f.key]), v => {
      shown[f.key] = isDuration ? v : Number(v);
      draft[f.key] = shown[f.key];
      syncRate();
    }, isDuration ? { placeholder: '20s, 1m, 5m — or 0' } : {}));
    if (f.hint) nodes.push(el('p', 'hint', f.hint));
  }

  syncRate();
  nodes.push(rate);
  nodes.push(el('p', 'hint', `${num(lv.tracked)} members are being tracked.`));
  nodes.push(actions(() => post('levels', draft)));
  form.replaceChildren(...nodes);
}

/**
 * What the level settings add up to, in a sentence.
 *
 * Four numbers that each make sense alone tell you nothing together — whether
 * 25 XP on a 20-second cooldown is generous depends on the base XP and the
 * curve, and nobody does that arithmetic in their head. Recomputed as the
 * fields change, so the effect of a change is visible before it is saved.
 */
function describeXpRate(v) {
  const ms = parseDurationMs(String(v.cooldownMs ?? '')) ?? (/^0/.test(String(v.cooldownMs)) ? 0 : null);
  const maxXp = Number(v.xpMax) || 0;
  const avgXp = ((Number(v.xpMin) || 0) + maxXp) / 2;
  const baseXp = Number(v.baseXp) || 0;
  if (ms === null || !avgXp || !baseXp) return 'Fill the fields above to see what they add up to.';

  const msgs = Math.max(1, Math.ceil(baseXp / avgXp));
  if (ms === 0) return `No cooldown — every message pays. About ${msgs} message${msgs === 1 ? '' : 's'} to reach level 2.`;

  const perHour = Math.floor(3600000 / ms) * maxXp;
  return `At most ${num(perHour)} XP/hour · about ${msgs} earning message${msgs === 1 ? '' : 's'} to reach level 2 (${shortDuration(msgs * ms)} at full speed).`;
}

/**
 * Short, readable span. The page's own duration() floors to whole minutes,
 * which turns every XP cooldown into "0m" — these are seconds-to-minutes, not
 * the hours-to-days it was written for.
 */
function shortDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rest = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return rest ? `${m}m ${rest}s` : `${m}m`;
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
  // Lets an empty form fall back to whatever this guild has saved, rather than
  // to the factory defaults the embed is no longer sending.
  if (state.guildId) params.set('g', state.guildId);
  const url = `/api/preview/${state.tpl.key}?${params}`;

  try {
    const res = await fetch(url, { credentials: 'same-origin', headers: authHeaders() });
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
      markStudioDirty();
      requestPreview();
    });
    l.append(input);
    return l;
  }));
}

/**
 * What is currently saved for a banner, filled in with the defaults.
 *
 * Studio shows the effective wording — the words the embed would actually
 * send — rather than the raw saved record, which only holds the fields that
 * differ. Otherwise a banner with one customised line would open with the
 * other three blank.
 */
function savedCopyFor(key) {
  const saved = state.overview?.banners?.[key] || {};
  const tpl = state.templates.find(t => t.key === key);
  return { ...(tpl?.defaults || {}), ...saved };
}

/** Whether the form differs from what is saved, which is what the embed sends. */
function studioDirty() {
  if (!state.tpl) return false;
  const saved = savedCopyFor(state.tpl.key);
  return Object.keys(state.tpl.defaults).some(f => (state.copy[f] ?? '') !== (saved[f] ?? ''));
}

function markStudioDirty() {
  const dirty = studioDirty();
  $('#tpl-dirty').hidden = !dirty;
  $('#tpl-save').disabled = !dirty;
  $('#tpl-revert').disabled = !dirty;
}

function selectTemplate(key, copy) {
  state.tpl = state.templates.find(t => t.key === key) || state.templates[0];
  state.copy = copy ? { ...copy } : savedCopyFor(state.tpl.key);
  renderStudioFields();
  markStudioDirty();
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

  // Revert goes back to what is saved; reset goes back to the factory wording
  // and needs saving to take effect, same as any other edit.
  $('#tpl-revert').addEventListener('click', () => selectTemplate(state.tpl.key));
  $('#tpl-reset').addEventListener('click', () => selectTemplate(state.tpl.key, state.tpl.defaults));

  $('#tpl-save').addEventListener('click', async () => {
    const btn = $('#tpl-save');
    btn.disabled = true;
    const previous = btn.textContent;
    btn.textContent = 'Saving…';
    try {
      // Only the lines that differ from the defaults are sent, so a banner
      // left alone stays on the default render the cache already holds.
      const copy = {};
      for (const [f, v] of Object.entries(state.copy)) {
        if (v && v !== state.tpl.defaults[f]) copy[f] = v;
      }
      const out = await post('banner', { template: state.tpl.key, copy });
      if (out && state.overview) {
        state.overview.banners = { ...(state.overview.banners || {}), [state.tpl.key]: out.copy || {} };
      }
    } finally {
      btn.textContent = previous;
      markStudioDirty();
    }
  });

  selectTemplate(templates[0].key);
}

/* ── the pill ──────────────────────────────────────────────────────────────
   Two small things the bar now has room for: how far down the page you are,
   and which section you are in once the nav has scrolled past. */

const SECTION_NAMES = {
  overview: 'Overview', composer: 'Composer', studio: 'Studio',
  casino: 'Casino', tickets: 'Tickets',
  giveaways: 'Giveaways', feeds: 'Feeds', economy: 'Economy',
  automation: 'Automation', engagement: 'Engagement',
  moderation: 'Moderation', settings: 'Settings',
};

function paintBar() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const y = window.scrollY;
  document.documentElement.style.setProperty('--scroll', max > 8 ? `${Math.min(100, (y / max) * 100).toFixed(1)}%` : '0%');
  // 64px is roughly where the section nav leaves the screen, so the label
  // arrives exactly as the thing it replaces goes away.
  root.dataset.scrolled = y > 64 ? '1' : '0';
  $('#here').textContent = SECTION_NAMES[root.dataset.section] || '';
}

function watchScroll() {
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    // Coalesced into a frame — a scroll handler that writes styles directly is
    // the classic way to make a phone feel sluggish.
    requestAnimationFrame(() => { queued = false; paintBar(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  paintBar();
}

/**
 * Tapping outside a field closes the keyboard.
 *
 * Browsers only blur an input when you tap something else focusable, so on a
 * phone the keyboard stays up over half the screen while you try to read what
 * you just typed. Tapping any non-interactive part of the page now dismisses
 * it, which is what every native app does.
 */
function dismissKeyboardOnOutsideTap() {
  const isControl = node => node instanceof Element
    && node.closest('input, textarea, select, button, a, label, [contenteditable]');

  document.addEventListener('pointerdown', event => {
    const active = document.activeElement;
    if (!active || !/^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
    if (isControl(event.target)) return;
    active.blur();
  }, { passive: true });
}

/* ── live ──────────────────────────────────────────────────────────────────
   The panel used to be a snapshot: it read everything once and then showed
   you that until you reloaded. Someone entering a giveaway, a report coming
   in, a watched account starting to fail — none of it appeared without a
   refresh, so the number on screen was only true at the moment you last
   looked at it.

   The server pushes the whole overview whenever it changes. What arrives is
   applied to the parts of the page that only ever display things; forms are
   never touched, because the one thing worse than a stale number is a
   half-typed one disappearing. */

let live = null;
let liveMissed = false;

/** Is the person in the middle of typing something? */
function isEditing() {
  const a = document.activeElement;
  if (!a) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  return a.isContentEditable === true;
}

/**
 * Repaints what the stream can safely repaint.
 *
 * Lists and counters only. The composer, the appearance editor, Studio, the
 * economy dials and every settings form are left exactly as they are — a
 * repaint would throw away whatever was in them.
 *
 * Social is a special case: its account list is read-only once collapsed, but
 * an open card is a form, so it is only redrawn when none is open.
 */
function renderLive() {
  if (!state.overview) return;
  // Deferred rather than dropped: whatever arrived is already in state, and
  // the next tick — or the moment the field loses focus — will show it.
  if (isEditing() || sheetIsOpen()) { liveMissed = true; return; }
  liveMissed = false;

  renderOverviewCards();
  renderGiveaways();
  renderLottery();
  renderModeration();
  renderLinkRequests();
  renderTickets();
  if (!state.socialDraft && !(state.socialOpen?.size)) renderSocial();
  startTicking();
}

function sheetIsOpen() {
  const sheet = $('#sheet');
  return !!sheet && !sheet.hidden;
}

function stopLive() {
  if (live) { live.close(); live = null; }
}

/**
 * Opens the stream for the guild being looked at.
 *
 * EventSource reconnects by itself, so there is no retry loop here — the only
 * thing worth doing on an error is saying so, and letting it get on with it.
 */
function startLive() {
  stopLive();
  if (typeof EventSource !== 'function' || !state.guildId) return;

  // The token rides on the query string because EventSource cannot set a
  // header, and inside somebody else's iframe the cookie is blocked outright.
  // The server checks it exactly as it checks a header.
  const qs = state.token ? `?t=${encodeURIComponent(state.token)}` : '';
  try {
    live = new EventSource(`/api/guild/${state.guildId}/stream${qs}`, { withCredentials: true });
  } catch {
    return;
  }

  live.addEventListener('overview', ev => {
    let next;
    try { next = JSON.parse(ev.data); } catch { return; }
    // Guard against a payload that arrives after the guild has been switched.
    if (!next?.guild?.id || next.guild.id !== state.guildId) return;
    state.overview = next;
    renderLive();
  });
}

// A field losing focus is the moment a deferred repaint becomes safe.
document.addEventListener('focusout', () => {
  if (!liveMissed) return;
  // A tick of delay: focusout fires before focus lands on the next field, and
  // repainting in between would take that field out from under it.
  setTimeout(() => { if (liveMissed) renderLive(); }, 60);
});

// Nothing is pushed to a page nobody is looking at, and a phone suspends the
// connection anyway. Reopening on return is also what makes the first thing
// you see current rather than however old the tab was.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopLive();
  else if (state.guildId) startLive();
});

/* ── boot ──────────────────────────────────────────────────────────────── */

/**
 * Shows one section and marks its nav button.
 *
 * The active section carries `data-active` and the stylesheet keys off that
 * alone, so adding a section is a matter of adding markup and a nav button —
 * there is no second list anywhere that has to be kept in step.
 */
function showSection(name) {
  root.dataset.section = name;
  for (const s of document.querySelectorAll('.section')) {
    const active = s.dataset.section === name;
    s.toggleAttribute('data-active', active);
    // Restart the entrance animation for the section that just appeared.
    // Reading offsetWidth between clearing and restoring it is what forces the
    // browser to acknowledge the reset.
    if (active) { s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; }
  }
  for (const b of document.querySelectorAll('#sections button')) {
    if (b.dataset.goto === name) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  }
}

function initSections() {
  for (const b of document.querySelectorAll('#sections button')) {
    b.addEventListener('click', () => {
      showSection(b.dataset.goto);
      if (b.dataset.goto === 'giveaways') state.gawBump?.();
      paintBar();
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
  // Banner wording is per guild, so Studio has to re-read it rather than keep
  // showing the previous server's copy.
  if (state.tpl) selectTemplate(state.tpl.key);
  // And the stream follows whichever server is being looked at.
  startLive();
}

/**
 * Whether /api/me has ever answered. It is the line between "we do not know
 * who you are" and "we know exactly who you are and something else broke",
 * and those two need opposite responses: one is a sign-in page, the other is
 * an error message on a panel you stay signed in to.
 */
let signedIn = false;

/** Says what actually went wrong, instead of implying you are not signed in. */
function reportLoadFailure(err) {
  console.error(err);
  // A 401 this late is the real thing — the session died while the page was
  // using it — so this is the one failure that does belong on the sign-in page.
  if (err?.status === 401) {
    state.token = null;
    remember(null);
    signedIn = false;
    return showLogin();
  }
  toast('Could not load that server. Reload to try again.', 'bad');
}

async function main() {
  watchScroll();
  dismissKeyboardOnOutsideTap();

  // The popup posts the session back here when it finishes.
  window.addEventListener('message', event => {
    // Only our own origin may hand us a session. Without this check any page
    // that could reach this window could inject one.
    if (event.origin !== location.origin) return;
    if (event.data?.type !== 'yserflow-session' || typeof event.data.token !== 'string') return;
    clearInterval(handoffTimer);
    state.token = event.data.token;
    remember(event.data.token);
    main().catch(() => {});
  });

  let me;
  try {
    me = await get('/api/me');
  } catch (err) {
    if (err.status === 503 && err.body?.missing) return showSetup(err.body.missing);

    // A stored token that no longer works is worse than none — it would keep
    // failing silently on every load. Throwing it away and asking once more is
    // the other half: signing out and straight back in leaves exactly that
    // pair behind, a fresh cookie from the callback and a dead token still in
    // storage, and one refused credential should never be allowed to decide
    // that a page with a perfectly good cookie is not signed in. Costs one
    // extra request, and only on a load that had already failed.
    if (err.status === 401 && state.token) {
      state.token = null;
      remember(null);
      try {
        me = await get('/api/me');
      } catch (retry) {
        if (retry.status === 503 && retry.body?.missing) return showSetup(retry.body.missing);
        return showLogin();
      }
    } else {
      return showLogin();
    }
  }

  // Past this point there is a session. Anything that fails from here on is a
  // problem with the data, not with who you are — see the handler on main().
  signedIn = true;

  state.csrf = me.csrf;
  if (me.token) { state.token = me.token; remember(me.token); }
  state.guilds = me.guilds;
  state.me = me.user;
  renderIdentity(me.user);
  initSections();
  initSheet();
  initEmbedLink();
  $('#tpl-new').addEventListener('click', () => {
    state.tplName = null;
    state.draft = { ...newDraft(''), isNew: true };
    renderComposer();
  });
  $('#social-new').addEventListener('click', () => {
    state.socialDraft = {
      id: '', platform: 'youtube', handle: '', label: '', feedUrl: '',
      postChannelId: null, mentionRoleId: null,
      includeKeywords: [], excludeKeywords: [], enabled: true,
    };
    renderSocial();
  });
  root.dataset.state = 'panel';
  offerStorageAccess();

  const params = new URLSearchParams(location.search);
  const wanted = params.get('g');
  // Always through showSection, including for the default — it is what puts
  // data-active on a section, and without it nothing would be visible at all.
  const section = params.get('s');
  const known = section && document.querySelector(`#sections button[data-goto="${section}"]`);
  showSection(known ? section : (root.dataset.section || 'overview'));

  paintBar();

  const first = me.guilds.some(g => g.id === wanted) ? wanted : me.guilds[0]?.id;
  // A server whose overview will not load is a broken server, not a broken
  // session. Letting this throw sent the whole of main() into its catch and
  // showed the sign-in page to somebody who had just signed in perfectly
  // well — one bad request and the panel appeared to reject the login.
  if (first) await selectGuild(first).catch(reportLoadFailure);

  // Independent of the guild view, so one slow call never blanks the others.
  get('/api/leaderboard').then(renderBoard).catch(() => {});
  get('/api/health').then(renderHealth).catch(() => {});
  initStudio().catch(() => {});
}

// Never sign somebody out over a bug. Before /api/me answers, a failure really
// does mean there is no session and the sign-in page is the right screen.
// After it answers, the session is good and blanking the panel back to a
// sign-in button just tells the person a lie about why nothing loaded.
main().catch(err => {
  console.error(err);
  if (signedIn) toast('Something went wrong loading the panel. Reload to try again.', 'bad');
  else showLogin();
});
