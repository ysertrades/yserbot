'use strict';

/**
 * entryVerify.js — the alt-account check behind giveaway entries.
 *
 * Discord never tells a bot anything about the person behind an account, so
 * the check happens on a web page the member opens themselves. Pressing Enter
 * on a giveaway hands them a one-time signed link; the page reads three
 * signals from their browser and the bot compares them with every account
 * already verified in that server:
 *
 *   device token  — a random id the page keeps in that browser. The same id
 *                   on a second account is the same browser: blocked.
 *   fingerprint   — screen, timezone, graphics and similar. Phones of one
 *                   model share it, so on its own it only notes; together
 *                   with the same connection it blocks.
 *   connection    — the IP the page was opened from. Households, schools and
 *                   mobile networks share one, so on its own it only notes.
 *
 * Nothing raw is stored. Each signal is an HMAC of the value, keyed per
 * server, so the bot can tell two accounts match without being able to read
 * an address back — and a hash from one server means nothing in another.
 */

const crypto = require('node:crypto');
const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'entryverify.json';
const TOKEN_TTL_MS = 15 * 60 * 1000;

function secret() {
  const s = process.env.SESSION_SECRET || process.env.TOKEN || 'entry-verify';
  return crypto.createHash('sha256').update(`entry-verify:${s}`).digest();
}

function store() {
  const s = readJson(FILE, {});
  if (!s.settings) s.settings = {};
  if (!s.users) s.users = {};
  return s;
}

/* ── settings ───────────────────────────────────────────────────────────── */

/** On by default: a server has to switch it off, not on. */
function isEnabled(guildId) {
  return store().settings[guildId]?.enabled !== false;
}

function setEnabled(guildId, on) {
  const s = store();
  s.settings[guildId] = { ...(s.settings[guildId] || {}), enabled: !!on };
  writeJson(FILE, s);
  return !!on;
}

/* ── one-time links ─────────────────────────────────────────────────────── */

const b64 = buf => Buffer.from(buf).toString('base64url');

/** A signed, expiring link code for one member, one server, one giveaway. */
function makeToken(guildId, userId, messageId, channelId) {
  const body = b64(JSON.stringify({ g: String(guildId), u: String(userId), m: String(messageId || ''), c: String(channelId || ''), e: Date.now() + TOKEN_TTL_MS, n: crypto.randomBytes(6).toString('hex') }));
  const sig = b64(crypto.createHmac('sha256', secret()).update(body).digest()).slice(0, 32);
  return `${body}.${sig}`;
}

/** @returns {{g,u,m,c,e}|null} */
function readToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = b64(crypto.createHmac('sha256', secret()).update(body).digest()).slice(0, 32);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!t || !/^\d{5,25}$/.test(t.g) || !/^\d{5,25}$/.test(t.u)) return null;
    if (!(t.e > Date.now())) return { ...t, expired: true };
    return t;
  } catch { return null; }
}

/* ── signals ────────────────────────────────────────────────────────────── */

function hashSignal(guildId, kind, value) {
  if (!value) return null;
  return crypto.createHmac('sha256', secret()).update(`${guildId}:${kind}:${value}`).digest('base64url').slice(0, 24);
}

/**
 * An IP is only worth comparing when it is the visitor's: behind a proxy that
 * does not pass the real address every visitor arrives from the same private
 * one, and matching on that would flag the whole server.
 */
function usableIp(ip) {
  const v = String(ip || '').replace(/^::ffff:/, '');
  if (!v || v === 'unknown') return null;
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(v)) return null;
  return v;
}

/**
 * Records a verification and decides it.
 * @returns {{ status: 'verified'|'flagged', reason?: string, matchedWith?: string[], notes: string[] }}
 */
function record(guildId, userId, { ip, device, fingerprint, userAgent }) {
  const s = store();
  const users = s.users[guildId] || (s.users[guildId] = {});
  const mine = {
    ip: hashSignal(guildId, 'ip', usableIp(ip)),
    dev: hashSignal(guildId, 'dev', String(device || '').slice(0, 80)),
    fp: hashSignal(guildId, 'fp', String(fingerprint || '').slice(0, 200)),
  };

  const sameDevice = [];
  const sameFpAndIp = [];
  const sameIp = [];
  const sameFp = [];
  for (const [otherId, o] of Object.entries(users)) {
    if (otherId === String(userId) || !o) continue;
    if (mine.dev && o.dev === mine.dev) sameDevice.push(otherId);
    else if (mine.fp && mine.ip && o.fp === mine.fp && o.ip === mine.ip) sameFpAndIp.push(otherId);
    else {
      if (mine.ip && o.ip === mine.ip) sameIp.push(otherId);
      if (mine.fp && o.fp === mine.fp) sameFp.push(otherId);
    }
  }

  const notes = [];
  if (sameIp.length) notes.push(`same connection as ${sameIp.length} other account${sameIp.length === 1 ? '' : 's'}`);
  if (sameFp.length) notes.push(`same browser profile as ${sameFp.length} other account${sameFp.length === 1 ? '' : 's'}`);
  if (!mine.ip) notes.push('connection not checked');

  let status = 'verified';
  let reason = null;
  let matchedWith = [];
  if (sameDevice.length) {
    status = 'flagged'; reason = 'same device as another account'; matchedWith = sameDevice;
  } else if (sameFpAndIp.length) {
    status = 'flagged'; reason = 'same browser and connection as another account'; matchedWith = sameFpAndIp;
  }

  const prev = users[userId] || {};
  users[userId] = {
    ...mine,
    // A decision staff already made stands until they change it.
    status: prev.override || status,
    override: prev.override || null,
    reason, matchedWith: matchedWith.slice(0, 10), notes,
    ua: String(userAgent || '').slice(0, 120),
    at: Date.now(),
  };
  writeJson(FILE, s);
  return { status: users[userId].status, reason, matchedWith, notes };
}

/** 'verified' | 'flagged' | 'none' */
function statusOf(guildId, userId) {
  const u = store().users[guildId]?.[userId];
  if (!u) return 'none';
  return u.status === 'verified' ? 'verified' : 'flagged';
}

function entryOf(guildId, userId) {
  return store().users[guildId]?.[userId] || null;
}

/** Staff decision from the panel: 'verified', 'flagged', or null to forget. */
function setOverride(guildId, userId, decision) {
  const s = store();
  const users = s.users[guildId] || (s.users[guildId] = {});
  if (decision === null) { delete users[userId]; writeJson(FILE, s); return { ok: true, removed: true }; }
  if (!users[userId]) return { error: 'not_verified' };
  users[userId].override = decision === 'verified' ? 'verified' : 'flagged';
  users[userId].status = users[userId].override;
  writeJson(FILE, s);
  return { ok: true };
}

/** For the panel: counts, and everyone flagged with who they matched. */
function summary(guildId, guild = null) {
  const users = store().users[guildId] || {};
  const name = id => guild?.members?.cache?.get(id)?.displayName || null;
  const rows = Object.entries(users).map(([id, u]) => ({
    userId: id, name: name(id), status: u.status, reason: u.reason || null,
    matchedWith: (u.matchedWith || []).map(m => ({ userId: m, name: name(m) })),
    notes: u.notes || [], at: u.at || 0, override: u.override || null,
  }));
  return {
    enabled: isEnabled(guildId),
    verified: rows.filter(r => r.status === 'verified').length,
    flagged: rows.filter(r => r.status !== 'verified').sort((a, b) => b.at - a.at).slice(0, 50),
    recent: rows.filter(r => r.status === 'verified').sort((a, b) => b.at - a.at).slice(0, 10),
  };
}

/** Forget a member who left — their signals should not outlive them. */
function forget(guildId, userId) {
  const s = store();
  if (s.users[guildId]?.[userId]) {
    delete s.users[guildId][userId];
    writeJson(FILE, s);
  }
}

module.exports = {
  TOKEN_TTL_MS, isEnabled, setEnabled, makeToken, readToken,
  record, statusOf, entryOf, setOverride, summary, forget,
};
