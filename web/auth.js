'use strict';

/**
 * web/auth.js
 *
 * Discord login for the control panel.
 *
 * Sessions carry no server-side state — the cookie is a payload plus an HMAC
 * of that payload, so a host restart (which this bot gets plenty of) never
 * logs anyone out and there is no session store to keep in sync.
 *
 * Two gates, and both are re-checked on every request rather than only at
 * login:
 *
 *   1. The account must OWN the guild being accessed (Discord owner flag),
 *      or hold a live staff grant, or be in PANEL_OWNER_IDS. Ownership is
 *      established at login and carried in the session, so it is only as
 *      fresh as SESSION_TTL_MS — which is why that is hours, not weeks.
 *      Staff grants are read live on every request so a revoke is immediate.
 *   2. The guild must be one the bot is currently in, and must pass the
 *      PANEL_GUILD_IDS allowlist. Both are checked live against the bot's own
 *      state on every request, so revoking access is immediate.
 *
 * The bot token is never involved in any of this and never leaves the process.
 */

const crypto = require('node:crypto');
const { readJson, writeJson } = require('../utils/jsonStorage');

const API = 'https://discord.com/api/v10';
const MANAGE_GUILD = 1n << 5n;

const SESSION_COOKIE = 'yf_session';
const STATE_COOKIE   = 'yf_state';
// Effectively "until you sign out": a long window that slides forward every
// time the panel is opened, so ordinary use never ends in a login screen.
//
// It is still bounded, and the bound matters: the guild list inside a session
// is only as fresh as the session, so this is also the window in which a
// revoked Manage Server has not taken effect yet. Bot-presence and the guild
// allowlist are re-checked live on every request regardless, so the worst case
// is a former manager keeping access to a guild the bot is still in — not to
// a guild they were never in. PANEL_SESSION_DAYS tightens it if that trade
// ever stops being acceptable.
const SESSION_DAYS = Math.min(365, Math.max(1, Number(process.env.PANEL_SESSION_DAYS) || 90));
const SESSION_TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
// Reissued once a week of use, so the window keeps sliding without minting a
// new token on every single request.
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS   = 10 * 60 * 1000;      // 10 minutes to finish logging in

// How long an embed link keeps working with nobody touching it. Expiry is not
// really the control here — revocation is (see embedVersion below) — so this
// is set long enough that it is never the reason someone gets logged out.
const EMBED_LINK_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000;

/* ─── config ─────────────────────────────────────────────────────────────── */

function config() {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return {
    clientId:     process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    secret:       process.env.SESSION_SECRET || '',
    baseUrl:      base,
    redirectUri:  base ? `${base}/auth/callback` : '',
    // Empty means "any guild the bot is in that you can manage".
    allowlist: (process.env.PANEL_GUILD_IDS || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    // Origins allowed to embed the panel. Empty (the default) means nobody.
    frameAncestors: (process.env.PANEL_FRAME_ANCESTORS || '')
      .split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
    // The bot's own operator(s) — sees and manages every guild the bot is in,
    // not only the ones Discord says they personally have Manage Server on.
    // Empty (the default) means nobody gets the owner console.
    ownerIds: (process.env.PANEL_OWNER_IDS || '')
      .split(',').map(s => s.trim()).filter(Boolean),
  };
}

/** Whether the panel is configured to be embedded anywhere at all. */
function embeddable() {
  return config().frameAncestors.length > 0;
}

/**
 * Whether this Discord account is the bot's own operator, wired through
 * PANEL_OWNER_IDS rather than any per-guild permission.
 *
 * A per-guild "Manage Server" gate is somebody else's to grant — that
 * server's own admins, via their own roles — and it only ever covers the one
 * server it was granted on. The console that spans every server the bot is
 * in needs a gate that is not scoped to any single one, and this is it.
 */
function isOwner(uid) {
  return config().ownerIds.includes(String(uid));
}

/** Which required settings are missing, so the server can say so precisely. */
function missingConfig() {
  const c = config();
  const missing = [];
  if (!c.clientId)     missing.push('DISCORD_CLIENT_ID');
  if (!c.clientSecret) missing.push('DISCORD_CLIENT_SECRET');
  if (!c.secret)       missing.push('SESSION_SECRET');
  if (!c.baseUrl)      missing.push('PUBLIC_BASE_URL');
  return missing;
}

/* ─── signed tokens ──────────────────────────────────────────────────────── */

const b64 = buf => Buffer.from(buf).toString('base64url');

function sign(payload, secret) {
  const body = b64(JSON.stringify(payload));
  const mac  = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token, secret) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const mac  = token.slice(dot + 1);
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');

  // Compare in constant time. Buffers of differing length would make
  // timingSafeEqual throw, so length is checked first — that leaks only the
  // length of a value the attacker already controls.
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ─── cookies ────────────────────────────────────────────────────────────── */

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

// Secure is unconditional: the panel is only ever reached over the HTTPS
// domain, and a cookie that would travel in clear is worse than no login.
//
// SameSite is Lax normally, which lets the Discord redirect back in while
// blocking cross-site requests. When embedding is enabled it has to be None,
// or the cookie is not sent from inside the host page at all. Note that None
// is necessary but not sufficient — Safari blocks third-party cookies
// outright, which is why the bearer-token path below exists.
const sameSite = () => (embeddable() ? 'None' : 'Lax');

// Partitioned (CHIPS) is what actually makes the login stick inside a host
// page. A plain third-party cookie is dropped by Safari no matter what
// SameSite says; a partitioned one is allowed, because it is keyed to the host
// page and so cannot be used to follow anyone between sites. It needs Secure
// and SameSite=None, both of which are already true when embedding is on.
//
// Browsers that predate CHIPS ignore the attribute, so this costs nothing
// where it is not understood — the bearer token still covers those.
const partitioned = () => (embeddable() ? '; Partitioned' : '');

function cookie(name, value, maxAgeMs) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/', 'HttpOnly', 'Secure', `SameSite=${sameSite()}`,
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ].join('; ') + partitioned();
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=${sameSite()}; Max-Age=0${partitioned()}`;
}

/* ─── login flow ─────────────────────────────────────────────────────────── */

/**
 * Step 1 — where to send the browser to start a login.
 *
 * `popup` is carried inside the signed state rather than as a query parameter,
 * because the callback arrives from Discord and cannot be trusted to preserve
 * anything we did not sign.
 */
function authorizeUrl({ popup = false, handoff = null } = {}) {
  const c = config();
  // The state is signed rather than stored, and echoed back in a cookie the
  // callback must match. Without it, anyone could feed you a callback URL and
  // log you into their account.
  const state = sign({
    n: crypto.randomBytes(16).toString('base64url'),
    popup: !!popup,
    // The handoff id lets a login that opened in a whole new browser tab still
    // reach the page that started it — see collectHandoff below.
    h: typeof handoff === 'string' && /^[\w-]{8,64}$/.test(handoff) ? handoff : null,
    exp: Date.now() + STATE_TTL_MS,
  }, c.secret);
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('redirect_uri', c.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'none');
  return { url: url.toString(), state };
}

async function discord(path, init) {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`Discord ${path} responded ${res.status}`);
  return res.json();
}

/**
 * Step 2 — trade the code for a session.
 *
 * @returns {{token: string, user: object}} the signed session cookie value
 * @throws  if the exchange fails or the account manages no eligible guild
 */
async function completeLogin(code, client) {
  const c = config();

  const token = await discord('/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.redirectUri,
    }),
  });

  const bearer = { headers: { authorization: `Bearer ${token.access_token}` } };
  const [user, guilds] = await Promise.all([
    discord('/users/@me', bearer),
    discord('/users/@me/guilds', bearer),
  ]);

  // Keep only guilds this account OWNS (Discord owner flag), that the bot is
  // actually in, and that the allowlist permits.
  //
  // Manage Server used to be enough. That let anyone with an admin role on
  // YOUR server open YOUR panel. Ownership is the right gate for multi-tenant
  // use: each person only sees servers they created under their Discord.
  // Staff grants (owner console) and PANEL_OWNER_IDS still open extra access
  // without needing the Discord owner flag.
  //
  // The access token is discarded right after this — the panel never acts on
  // the user's behalf, so there is nothing to store.
  const manageable = guilds
    .filter(g => g.owner === true)
    .filter(g => client.guilds.cache.has(g.id))
    .filter(g => c.allowlist.length === 0 || c.allowlist.includes(g.id))
    .map(g => g.id);

  // The one account this rejects nobody for: the bot's own operator may not
  // personally own every guild the bot runs in — that is the whole reason the
  // owner console exists — so this login must not turn on the very check the
  // console is here to see past.
  if (manageable.length === 0 && !c.ownerIds.includes(user.id)) {
    const err = new Error('no_manageable_guilds');
    err.code = 'no_manageable_guilds';
    throw err;
  }

  return {
    token: sign({
      uid: user.id,
      name: user.global_name || user.username,
      avatar: user.avatar,
      guilds: manageable,
      // Which generation of this account's sessions this token belongs to.
      // Signing out bumps the counter, and every token stamped with an older
      // one stops verifying — see revokeSessions.
      sv: sessionVersion(user.id),
      exp: Date.now() + SESSION_TTL_MS,
    }, c.secret),
    user,
  };
}

/* ─── handoff ────────────────────────────────────────────────────────────────
 *
 * On iOS, a link opened from inside a third-party iframe becomes a full Safari
 * tab with no opener relationship at all — so postMessage has nobody to talk
 * to and the embedded panel sits there still logged out.
 *
 * So the page mints a random id before it starts, and the finished login parks
 * the session against that id for a minute. The page polls for it. No opener,
 * no shared storage and no third-party cookie required — which is exactly the
 * set of things that stop working inside someone else's iframe.
 */

const handoffs = new Map(); // id → { token, at }
const HANDOFF_TTL_MS = 2 * 60 * 1000;

function parkHandoff(id, token) {
  if (!id) return;
  const now = Date.now();
  for (const [k, v] of handoffs) if (now - v.at > HANDOFF_TTL_MS) handoffs.delete(k);
  if (handoffs.size > 200) return; // refuse to grow without bound
  handoffs.set(id, { token, at: now });
}

/** Single use: the token is deleted as it is handed over. */
function collectHandoff(id) {
  if (typeof id !== 'string' || !/^[\w-]{8,64}$/.test(id)) return null;
  const entry = handoffs.get(id);
  if (!entry) return null;
  handoffs.delete(id);
  if (Date.now() - entry.at > HANDOFF_TTL_MS) return null;
  return entry.token;
}

/* ─── request-time checks ────────────────────────────────────────────────── */

/**
 * A session close enough to expiry to be worth reissuing, so an active user is
 * never logged out mid-use. Returns a fresh token, or null if it is still young.
 */
/**
 * A valid bearer token that arrived without a session cookie beside it.
 *
 * This is the moment worth planting a cookie. The login happens in a separate
 * top-level tab, so the cookie it sets belongs to a different storage
 * partition and is invisible from inside the host page — the embedded panel
 * only ever holds the token in memory, which is why closing the host app used
 * to mean signing in again. Writing the token back as a partitioned cookie
 * from a request the frame itself made puts it in the frame's own partition,
 * where it survives the app being closed and reopened.
 *
 * Returns null when a cookie is already present, so this is a one-time
 * adoption rather than a Set-Cookie on every call.
 */
function adoptable(req) {
  const c = config();
  if (!c.secret) return null;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  if (parseCookies(req)[SESSION_COOKIE]) return null;
  const token = header.slice(7).trim();
  return verify(token, c.secret) ? token : null;
}

/**
 * Whop reloads whatever URL is pasted into its embed settings — it does not
 * remember anything the page did on its own, and inside its app the
 * iframe's WebView drops third-party cookies and localStorage outright with
 * no way to unlock either one (that machinery only helps in a real browser).
 * So nothing kept in the browser survives the app being closed there; the
 * only thing that does is the URL itself, because Whop is the one holding
 * onto it. An embed link is a normal session baked into that URL.
 *
 * The session itself lives server-side, keyed by a short opaque id, rather
 * than folded into a signed token the way every other session here works.
 * A signed token carries its own payload — this account's whole guild list,
 * name and avatar, base64'd — and that payload only grows with the account,
 * while Whop's own field for this URL is a plain database column with a
 * 255-character ceiling. An account managing more than a couple of servers
 * cleared that ceiling easily, and there was no way to paste the link in at
 * all: not "signed out sometimes", but the one thing meant to prevent that
 * being impossible to configure in the first place. The id costs nothing to
 * look up wherever it is used, and the URL is short regardless of how many
 * servers the account manages.
 *
 * Long-lived by design, which is why it carries its own revocation instead
 * of relying on expiry: `ev` is a version number checked against
 * embedVersion(uid) on every use, so regenerating a link invalidates every
 * link minted before it without touching anything else the account can do.
 * A link minted before this change is still a signed token rather than an
 * id, and still works — resolveToken tells the two apart by shape and reads
 * whichever one it was handed.
 *
 * Minting always bumps the version and clears this account's older records
 * first, in the same call — not as a separate revoke the caller does before
 * asking for a new one. Whop's own note above says as much ("regenerating a
 * link invalidates every link before it"), but the two-step version of this
 * had a real failure mode once the link actually got usable: an admin whose
 * only open session *is* the embed link — which is now the normal way to use
 * this, having just fixed the one thing stopping anyone from pasting it in —
 * clicking Replace would have the first step revoke the very token the
 * second step needed to authenticate with. One request, one still-valid
 * session at the moment it is checked, closes that gap entirely.
 */
const EMBED_SESSIONS_FILE = 'panel_embed_sessions.json';

function mintEmbedLink(session) {
  const { uid, name, avatar, guilds } = session;

  const versions = readJson('panel_embed_links.json', {});
  versions[uid] = (versions[uid] || 1) + 1;
  writeJson('panel_embed_links.json', versions);

  const store = readJson(EMBED_SESSIONS_FILE, {});
  for (const [existingId, rec] of Object.entries(store)) if (rec.uid === uid) delete store[existingId];
  pruneEmbedSessions(store);

  const id = crypto.randomBytes(16).toString('base64url');
  store[id] = { uid, name, avatar, guilds, ev: versions[uid], exp: Date.now() + EMBED_LINK_TTL_MS };
  writeJson(EMBED_SESSIONS_FILE, store);
  return id;
}

/** The stored record behind an embed-link id, or null — expiry only; the
 * caller still runs it through embedLinkCurrent for revocation. */
function embedSessionFor(id) {
  if (typeof id !== 'string' || !/^[\w-]{16,32}$/.test(id)) return null;
  const rec = readJson(EMBED_SESSIONS_FILE, {})[id];
  if (!rec || rec.exp < Date.now()) return null;
  return rec;
}

/** Drops entries that could never verify again — expired, or from a session
 * a since-regenerated link left behind — so the store does not grow forever
 * on an account that keeps hitting "Replace it". Run opportunistically on
 * mint rather than on a timer, which needs nothing running between requests. */
function pruneEmbedSessions(store) {
  const now = Date.now();
  for (const [id, rec] of Object.entries(store)) {
    if (rec.exp < now || rec.ev !== embedVersion(rec.uid)) delete store[id];
  }
}

function embedVersion(uid) {
  const versions = readJson('panel_embed_links.json', {});
  return versions[uid] || 1;
}

/** Invalidates every embed link minted for this account so far. */
function revokeEmbedLinks(uid) {
  const versions = readJson('panel_embed_links.json', {});
  versions[uid] = (versions[uid] || 1) + 1;
  writeJson('panel_embed_links.json', versions);

  // Drop this account's own stored sessions immediately rather than waiting
  // for the next mint elsewhere to prune them — the point of Replace is that
  // the old link stops working now, not eventually.
  const store = readJson(EMBED_SESSIONS_FILE, {});
  let changed = false;
  for (const [id, rec] of Object.entries(store)) {
    if (rec.uid === uid) { delete store[id]; changed = true; }
  }
  if (changed) writeJson(EMBED_SESSIONS_FILE, store);
}

/* ── staff: who besides a guild's own managers may open its panel ───────────
 *
 * Manage Server is the normal gate, and it belongs to that server — its own
 * admins hand it out through their own roles, and this bot has no say in it.
 * Running the bot across many servers needs a second gate underneath that
 * one: people the bot's operator lets in personally, independent of what any
 * one server's roles say, and revocable the moment they should not have a
 * server's panel anymore — see the owner console this backs, web/owner.js.
 *
 * Deliberately not folded into the signed session the way `guilds` is.
 * That list is a snapshot of what Discord said at login and is only ever as
 * fresh as SESSION_TTL by design (see the top of this file) — acceptable for
 * a permission Discord itself governs, because Discord is slow to change it
 * too. A grant made here is entirely this file's own data, so there is no
 * reason to accept the same staleness: canAccessGuild below reads this store
 * fresh on every request, and a revoke here is a revoke now.
 */
const STAFF_FILE = 'panel_staff.json';

/** Guild ids this account currently has a staff grant in, read live. */
function staffGuildsFor(uid) {
  const staff = readJson(STAFF_FILE, {});
  return Object.keys(staff).filter(guildId => uid in (staff[guildId] || {}));
}

/** Who currently holds a staff grant for one guild. */
function listStaff(guildId) {
  const staff = readJson(STAFF_FILE, {})[guildId] || {};
  return Object.entries(staff).map(([userId, rec]) => ({ userId, ...rec }));
}

function grantStaff(guildId, userId, addedBy) {
  const staff = readJson(STAFF_FILE, {});
  if (!staff[guildId]) staff[guildId] = {};
  staff[guildId][userId] = { addedBy, addedAt: Date.now() };
  writeJson(STAFF_FILE, staff);
}

/** @returns {boolean} whether there was a grant to remove */
function revokeStaff(guildId, userId) {
  const staff = readJson(STAFF_FILE, {});
  if (!staff[guildId] || !(userId in staff[guildId])) return false;
  delete staff[guildId][userId];
  if (Object.keys(staff[guildId]).length === 0) delete staff[guildId];
  writeJson(STAFF_FILE, staff);
  return true;
}

const SESSION_VERSION_FILE = 'panel_session_versions.json';

function sessionVersion(uid) {
  return readJson(SESSION_VERSION_FILE, {})[uid] || 1;
}

/**
 * Ends every signed-in session this account has, everywhere.
 *
 * Signing out used to clear the cookie and nothing else, which was not
 * signing out. A session is *also* a bearer token — held in the browser's
 * storage, and carried in the URL of a Whop embed link — and a bearer token
 * is self-contained: it stays valid until it expires no matter what the
 * cookie does. So the button cleared the cookie, the page reloaded, the
 * stored token signed you straight back in, and nothing looked like it had
 * happened. It failed hardest exactly where it mattered most: in an embedded
 * frame, where Safari can block the storage write that was doing the real
 * work, and where the host reloads a URL that still has the token in it.
 *
 * A counter fixes it properly. Every token carries the version that was
 * current when it was minted; bumping the version makes every one of them
 * stop verifying at once, on the server, whatever the client did or failed
 * to do.
 */
function revokeSessions(uid) {
  const versions = readJson(SESSION_VERSION_FILE, {});
  versions[uid] = (versions[uid] || 1) + 1;
  writeJson(SESSION_VERSION_FILE, versions);
}

/**
 * Whether a token is still one this account honours.
 *
 * The two credentials are versioned separately on purpose. An embed link is a
 * long-lived thing somebody deliberately minted for a host app to replay, and
 * it has its own Replace button; signing out of the panel on a laptop should
 * not silently break the Whop embed. So logout bumps sessions only, and
 * Replace bumps embed links only.
 *
 * A token minted before versions existed carries no `sv`. Those stay valid
 * while the account has never signed out — nobody is forced to log in again
 * by this shipping — and stop the moment it does, which is the whole point.
 */
function embedLinkCurrent(session) {
  if (session.ev != null) return session.ev === embedVersion(session.uid);
  const want = sessionVersion(session.uid);
  return session.sv == null ? want === 1 : session.sv === want;
}

function refreshed(session) {
  const remaining = session.exp - Date.now();
  if (remaining > SESSION_TTL_MS - REFRESH_AFTER_MS) return null;
  const { exp, ...rest } = session;
  // `rest` carries the token's own sv forward untouched. Re-stamping it with
  // the current version here would let a revoked session renew itself back
  // into life on its next refresh, which is the one way this could have been
  // written that puts the bug straight back.
  return sign({ ...rest, exp: Date.now() + SESSION_TTL_MS }, config().secret);
}

/**
 * A session from whatever a token turns out to be, or null.
 *
 * There are two shapes a token can arrive in, and this is the one place that
 * tells them apart. A signed session — from a login, or an embed link minted
 * before short ids existed — is body-and-mac with a literal `.` between the
 * two; sign() never produces the one without the other, so the dot alone is
 * enough to tell it from an opaque embed-link id, which is nothing but random
 * bytes and never contains one. Whichever it is, embedLinkCurrent makes the
 * same revocation check apply either way.
 */
function resolveToken(token) {
  const c = config();
  if (!c.secret || typeof token !== 'string' || !token) return null;
  const trimmed = token.trim();
  const session = trimmed.includes('.') ? verify(trimmed, c.secret) : embedSessionFor(trimmed);
  return session && embedLinkCurrent(session) ? session : null;
}

/**
 * A session from a bare token, for the one caller that cannot send a header.
 *
 * Same resolution and same freshness check as a bearer header — this only
 * changes where the string was carried, not how much it is believed.
 */
function sessionForToken(token) {
  return resolveToken(token);
}

/**
 * The signed session on a request, or null.
 *
 * A bearer token is accepted alongside the cookie. That is what makes the
 * embedded panel work: inside a third-party iframe Safari drops the cookie
 * entirely, so the page holds the same token in memory and sends it as a
 * header instead. Same token, same check — only the transport differs.
 */
function sessionFor(req) {
  const c = config();
  if (!c.secret) return null;

  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const fromHeader = resolveToken(header.slice(7).trim());
    if (fromHeader) return fromHeader;
  }
  return resolveToken(parseCookies(req)[SESSION_COOKIE]);
}

/**
 * Whether a session may act on a guild, re-verified live.
 * `session.guilds` is only as fresh as the session; the bot-presence and
 * allowlist checks are current as of this instant.
 */
function canAccessGuild(session, guildId, client) {
  if (!session) return false;
  if (!client.guilds.cache.has(guildId)) return false;

  // The bot's own operator sees every guild it is in — the allowlist below
  // exists to narrow who gets a panel at all, and the owner console's whole
  // job is to see past that narrowing, not be caught by it.
  if (isOwner(session.uid)) return true;

  const { allowlist } = config();
  if (allowlist.length > 0 && !allowlist.includes(guildId)) return false;

  // Either the ownership snapshot this session was minted with, or a staff
  // grant checked fresh against right now — see staffGuildsFor above for why
  // those two get different freshness guarantees.
  if (Array.isArray(session.guilds) && session.guilds.includes(guildId)) return true;
  return staffGuildsFor(session.uid).includes(guildId);
}

/**
 * CSRF token bound to the session it was issued for.
 *
 * SameSite=Lax already blocks cross-site POSTs in current browsers, but it is
 * one flag on one cookie — this is the second lock, and it costs nothing.
 */
function csrfFor(session) {
  const c = config();
  return crypto.createHmac('sha256', c.secret)
    .update(`csrf:${session.uid}:${session.exp}`)
    .digest('base64url');
}

function csrfValid(session, token) {
  if (typeof token !== 'string' || !token) return false;
  const want = Buffer.from(csrfFor(session));
  const got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

module.exports = {
  config, missingConfig, csrfFor, csrfValid, embeddable, isOwner,
  parkHandoff, collectHandoff, refreshed, adoptable,
  mintEmbedLink, revokeEmbedLinks,
  staffGuildsFor, listStaff, grantStaff, revokeStaff,
  authorizeUrl, completeLogin,
  sessionFor, sessionForToken, canAccessGuild,
  parseCookies, cookie, clearCookie, verify,
  revokeSessions, sessionVersion,
  SESSION_COOKIE, STATE_COOKIE, SESSION_TTL_MS, STATE_TTL_MS,
};
