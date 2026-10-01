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
const SESSION_DAYS = Math.min(365, Math.max(1, Number(process.env.PANEL_SESSION_DAYS) || 90));
const SESSION_TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS   = 10 * 60 * 1000;
const EMBED_LINK_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000;

function config() {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return {
    clientId:     process.env.DISCORD_CLIENT_ID || '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    secret:       process.env.SESSION_SECRET || '',
    baseUrl:      base,
    redirectUri:  base ? `${base}/auth/callback` : '',
    allowlist: (process.env.PANEL_GUILD_IDS || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    frameAncestors: (process.env.PANEL_FRAME_ANCESTORS || '')
      .split(/[\s,]+/).map(s => s.trim()).filter(Boolean),
    ownerIds: (process.env.PANEL_OWNER_IDS || '')
      .split(',').map(s => s.trim()).filter(Boolean),
  };
}

function embeddable() {
  return config().frameAncestors.length > 0;
}

function isOwner(uid) {
  return config().ownerIds.includes(String(uid));
}

function missingConfig() {
  const c = config();
  const missing = [];
  if (!c.clientId)     missing.push('DISCORD_CLIENT_ID');
  if (!c.clientSecret) missing.push('DISCORD_CLIENT_SECRET');
  if (!c.secret)       missing.push('SESSION_SECRET');
  if (!c.baseUrl)      missing.push('PUBLIC_BASE_URL');
  return missing;
}

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

const sameSite = () => (embeddable() ? 'None' : 'Lax');
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

function authorizeUrl({ popup = false, handoff = null } = {}) {
  const c = config();
  const state = sign({
    n: crypto.randomBytes(16).toString('base64url'),
    popup: !!popup,
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
  const PERM_ADMINISTRATOR = 0x8n;
  const PERM_MANAGE_GUILD = 0x20n;
  const canManageGuild = (g) => {
    if (g.owner === true) return true;
    try {
      const p = BigInt(g.permissions || 0);
      return (p & PERM_ADMINISTRATOR) === PERM_ADMINISTRATOR
        || (p & PERM_MANAGE_GUILD) === PERM_MANAGE_GUILD;
    } catch {
      return false;
    }
  };
  const manageable = guilds
    .filter(canManageGuild)
    .filter(g => client.guilds.cache.has(g.id))
    .filter(g => c.allowlist.length === 0 || c.allowlist.includes(g.id))
    .map(g => g.id);
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
      sv: sessionVersion(user.id),
      exp: Date.now() + SESSION_TTL_MS,
    }, c.secret),
    user,
  };
}

const handoffs = new Map();
const HANDOFF_TTL_MS = 2 * 60 * 1000;

function parkHandoff(id, token) {
  if (!id) return;
  const now = Date.now();
  for (const [k, v] of handoffs) if (now - v.at > HANDOFF_TTL_MS) handoffs.delete(k);
  if (handoffs.size > 200) return;
  handoffs.set(id, { token, at: now });
}

function collectHandoff(id) {
  if (typeof id !== 'string' || !/^[\w-]{8,64}$/.test(id)) return null;
  const entry = handoffs.get(id);
  if (!entry) return null;
  handoffs.delete(id);
  if (Date.now() - entry.at > HANDOFF_TTL_MS) return null;
  return entry.token;
}

function adoptable(req) {
  const c = config();
  if (!c.secret) return null;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  if (parseCookies(req)[SESSION_COOKIE]) return null;
  const token = header.slice(7).trim();
  return verify(token, c.secret) ? token : null;
}

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

function embedSessionFor(id) {
  if (typeof id !== 'string' || !/^[\w-]{16,32}$/.test(id)) return null;
  const rec = readJson(EMBED_SESSIONS_FILE, {})[id];
  if (!rec || rec.exp < Date.now()) return null;
  return rec;
}

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

function revokeEmbedLinks(uid) {
  const versions = readJson('panel_embed_links.json', {});
  versions[uid] = (versions[uid] || 1) + 1;
  writeJson('panel_embed_links.json', versions);
  const store = readJson(EMBED_SESSIONS_FILE, {});
  let changed = false;
  for (const [id, rec] of Object.entries(store)) {
    if (rec.uid === uid) { delete store[id]; changed = true; }
  }
  if (changed) writeJson(EMBED_SESSIONS_FILE, store);
}

const STAFF_FILE = 'panel_staff.json';

function staffGuildsFor(uid) {
  const staff = readJson(STAFF_FILE, {});
  return Object.keys(staff).filter(guildId => uid in (staff[guildId] || {}));
}

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

function revokeSessions(uid) {
  const versions = readJson(SESSION_VERSION_FILE, {});
  versions[uid] = (versions[uid] || 1) + 1;
  writeJson(SESSION_VERSION_FILE, versions);
}

function embedLinkCurrent(session) {
  if (session.ev != null) return session.ev === embedVersion(session.uid);
  const want = sessionVersion(session.uid);
  return session.sv == null ? want === 1 : session.sv === want;
}

function refreshed(session) {
  const remaining = session.exp - Date.now();
  if (remaining > SESSION_TTL_MS - REFRESH_AFTER_MS) return null;
  const { exp, ...rest } = session;
  return sign({ ...rest, exp: Date.now() + SESSION_TTL_MS }, config().secret);
}

function resolveToken(token) {
  const c = config();
  if (!c.secret || typeof token !== 'string' || !token) return null;
  const trimmed = token.trim();
  const session = trimmed.includes('.') ? verify(trimmed, c.secret) : embedSessionFor(trimmed);
  return session && embedLinkCurrent(session) ? session : null;
}

function sessionForToken(token) {
  return resolveToken(token);
}

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

function canAccessGuild(session, guildId, client) {
  if (!session) return false;
  if (!client.guilds.cache.has(guildId)) return false;

  // Bot operator may open any guild the bot is in (owner console + panel).
  if (isOwner(session.uid)) return true;

  const { allowlist } = config();
  if (allowlist.length > 0 && !allowlist.includes(guildId)) return false;

  if (Array.isArray(session.guilds) && session.guilds.includes(guildId)) return true;
  return staffGuildsFor(session.uid).includes(guildId);
}

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
