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
 *   1. The account must hold Manage Server in the guild being accessed. This
 *      one is established at login and carried in the session, so it is only
 *      as fresh as SESSION_TTL_MS — which is why that is hours, not weeks.
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
  };
}

/** Whether the panel is configured to be embedded anywhere at all. */
function embeddable() {
  return config().frameAncestors.length > 0;
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

  // Keep only guilds the account can manage AND the bot is actually in AND
  // the allowlist permits. The access token is discarded right after this —
  // the panel never acts on the user's behalf, so there is nothing to store.
  const manageable = guilds
    .filter(g => (BigInt(g.permissions || 0) & MANAGE_GUILD) === MANAGE_GUILD)
    .filter(g => client.guilds.cache.has(g.id))
    .filter(g => c.allowlist.length === 0 || c.allowlist.includes(g.id))
    .map(g => g.id);

  if (manageable.length === 0) {
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
 * Long-lived by design, which is why it carries its own revocation instead
 * of relying on expiry: `ev` is a version number checked against
 * embedVersion(uid) on every use, so regenerating a link invalidates every
 * link minted before it without touching anything else the account can do.
 */
function mintEmbedLink(session) {
  const { uid, name, avatar, guilds } = session;
  return sign({ uid, name, avatar, guilds, ev: embedVersion(uid), exp: Date.now() + EMBED_LINK_TTL_MS }, config().secret);
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
}

/** True for an ordinary session, and for an embed link that has not been revoked since. */
function embedLinkCurrent(session) {
  return session.ev == null || session.ev === embedVersion(session.uid);
}

function refreshed(session) {
  const remaining = session.exp - Date.now();
  if (remaining > SESSION_TTL_MS - REFRESH_AFTER_MS) return null;
  const { exp, ...rest } = session;
  return sign({ ...rest, exp: Date.now() + SESSION_TTL_MS }, config().secret);
}

/**
 * The signed session on a request, or null.
 *
 * A bearer token is accepted alongside the cookie. That is what makes the
 * embedded panel work: inside a third-party iframe Safari drops the cookie
 * entirely, so the page holds the same signed token in memory and sends it as
 * a header instead. Same token, same signature check — only the transport
 * differs.
 */
function sessionFor(req) {
  const c = config();
  if (!c.secret) return null;

  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const fromHeader = verify(header.slice(7).trim(), c.secret);
    if (fromHeader && embedLinkCurrent(fromHeader)) return fromHeader;
  }
  const fromCookie = verify(parseCookies(req)[SESSION_COOKIE], c.secret);
  return fromCookie && embedLinkCurrent(fromCookie) ? fromCookie : null;
}

/**
 * Whether a session may act on a guild, re-verified live.
 * `session.guilds` is only as fresh as the session; the bot-presence and
 * allowlist checks are current as of this instant.
 */
function canAccessGuild(session, guildId, client) {
  if (!session || !Array.isArray(session.guilds)) return false;
  if (!session.guilds.includes(guildId)) return false;
  if (!client.guilds.cache.has(guildId)) return false;
  const { allowlist } = config();
  if (allowlist.length > 0 && !allowlist.includes(guildId)) return false;
  return true;
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
  config, missingConfig, csrfFor, csrfValid, embeddable,
  parkHandoff, collectHandoff, refreshed, adoptable,
  mintEmbedLink, revokeEmbedLinks,
  authorizeUrl, completeLogin,
  sessionFor, canAccessGuild,
  parseCookies, cookie, clearCookie, verify,
  SESSION_COOKIE, STATE_COOKIE, SESSION_TTL_MS, STATE_TTL_MS,
};
