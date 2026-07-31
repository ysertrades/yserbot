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

const API = 'https://discord.com/api/v10';
const MANAGE_GUILD = 1n << 5n;

const SESSION_COOKIE = 'yf_session';
const STATE_COOKIE   = 'yf_state';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;  // 8 hours
const STATE_TTL_MS   = 10 * 60 * 1000;      // 10 minutes to finish logging in

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
  };
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
// SameSite=Lax lets the Discord redirect back in while still blocking
// cross-site requests; the Whop iframe would need None, and that is phase 4.
function cookie(name, value, maxAgeMs) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  return parts.join('; ');
}

function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/* ─── login flow ─────────────────────────────────────────────────────────── */

/** Step 1 — where to send the browser to start a login. */
function authorizeUrl() {
  const c = config();
  // The state is signed rather than stored, and echoed back in a cookie the
  // callback must match. Without it, anyone could feed you a callback URL and
  // log you into their account.
  const state = sign({ n: crypto.randomBytes(16).toString('base64url'), exp: Date.now() + STATE_TTL_MS }, c.secret);
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

/* ─── request-time checks ────────────────────────────────────────────────── */

/** The signed session on a request, or null. */
function sessionFor(req) {
  const c = config();
  if (!c.secret) return null;
  return verify(parseCookies(req)[SESSION_COOKIE], c.secret);
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

module.exports = {
  config, missingConfig,
  authorizeUrl, completeLogin,
  sessionFor, canAccessGuild,
  parseCookies, cookie, clearCookie, verify,
  SESSION_COOKIE, STATE_COOKIE, SESSION_TTL_MS, STATE_TTL_MS,
};
