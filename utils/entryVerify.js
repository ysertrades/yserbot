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
 *                   on a second account is the same browser: held.
 *   fingerprint   — screen, timezone, graphics and similar. Phones of one
 *                   model share it, so on its own it only notes.
 *   network       — the internet connection the page was opened from: the
 *                   public IPv4 address, or the /64 block for IPv6 (every
 *                   device on one home connection gets its own IPv6 address
 *                   inside that block). Every device on one Wi-Fi shares it,
 *                   so a second account on it is held — except on a mobile
 *                   carrier, where strangers share addresses, so there it
 *                   only notes. A VPN, proxy or data-centre address is turned
 *                   away with "switch it off and try again" (utils/ipIntel.js).
 *   location      — the device's own position (GPS / Wi-Fi), asked for by the
 *                   page, never guessed from the address. Only a fix the
 *                   device reports as accurate to 100 m or better is compared;
 *                   it is reduced to ~40 m map cells (utils/geocell.js), and a
 *                   second account within the block around one is held. This
 *                   is what catches someone who switches network to dodge.
 *                   Each server picks: required (default), optional, or off.
 *
 * A match never removes anyone: it holds the entry for staff to approve or act
 * on, because a shared house or office is a real thing.
 *
 * Nothing raw is stored. Each signal is an HMAC of the value, keyed per
 * server, so the bot can tell two accounts match without being able to read
 * an address back — and a hash from one server means nothing in another.
 */

const crypto = require('node:crypto');
const { readJson, writeJson } = require('./jsonStorage');
const { cellsAround } = require('./geocell');

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
  // Per giveaway: who passed the check for that drop. Verifying is done for
  // every drop, not once for all of them (users holds the latest signals
  // each account was matched on).
  if (!s.drops) s.drops = {};
  return s;
}

const MAX_DROPS_PER_GUILD = 200;

function markDrop(s, guildId, messageId, userId) {
  if (!messageId) return;
  const g = s.drops[guildId] || (s.drops[guildId] = {});
  const d = g[messageId] || (g[messageId] = { at: Date.now(), users: [] });
  if (!d.users.includes(String(userId))) d.users.push(String(userId));
  // Oldest drops go first once a server has many.
  const ids = Object.keys(g);
  if (ids.length > MAX_DROPS_PER_GUILD) {
    ids.sort((a, b) => (g[a].at || 0) - (g[b].at || 0));
    for (const id of ids.slice(0, ids.length - MAX_DROPS_PER_GUILD)) delete g[id];
  }
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

const LOCATION_MODES = ['required', 'optional', 'off'];
/** required (default): no entry without sharing it · optional: compared when shared · off: never asked. */
function locationMode(guildId) {
  const m = store().settings[guildId]?.location;
  return LOCATION_MODES.includes(m) ? m : 'required';
}
function setLocationMode(guildId, mode) {
  if (!LOCATION_MODES.includes(mode)) return null;
  const s = store();
  s.settings[guildId] = { ...(s.settings[guildId] || {}), location: mode };
  writeJson(FILE, s);
  return mode;
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

/** The connection a device sits on: an IPv4 address, or the /64 block of an IPv6 one. */
function networkOf(ip) {
  const v = usableIp(ip);
  if (!v || !v.includes(':')) return v;
  const [head, tail = ''] = v.toLowerCase().split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const full = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return full.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

const MAX_LOCATION_ERROR_M = 100;

/**
 * Checks what has to be right before anything is recorded; the page shows the
 * answer and the one-time link stays usable for another try.
 * @returns {null | { status: 'vpn'|'need_location' }}
 */
function precheck(guildId, { intel, location }) {
  if (intel?.ok && intel.vpn) return { status: 'vpn' };
  if (locationMode(guildId) === 'required' && location?.error === 'denied') return { status: 'need_location' };
  return null;
}

/**
 * Records a verification and decides it.
 * location: { lat, lon, acc } from the device, or { error: 'denied'|'unavailable' }.
 * intel: from utils/ipIntel.js ({ ok, mobile, vpn }).
 * @returns {{ status: 'verified'|'flagged'|'vpn'|'need_location', reason?: string, matchedWith?: string[], notes: string[] }}
 */
function record(guildId, userId, { ip, device, fingerprint, userAgent, messageId = null, location = null, intel = null }) {
  const early = precheck(guildId, { intel, location });
  if (early) return { ...early, notes: [] };

  const s = store();
  const users = s.users[guildId] || (s.users[guildId] = {});
  const mode = locationMode(guildId);
  const fix = mode !== 'off' && location && Number.isFinite(location.lat) && Number.isFinite(location.lon)
    && Math.abs(location.lat) <= 90 && Math.abs(location.lon) <= 180 ? location : null;
  const precise = !!(fix && Number.isFinite(fix.acc) && fix.acc > 0 && fix.acc <= MAX_LOCATION_ERROR_M);
  let loc = null;
  if (precise) {
    const { cell, near } = cellsAround(fix.lat, fix.lon);
    loc = { cell: hashSignal(guildId, 'loc', cell), near: near.map(c => hashSignal(guildId, 'loc', c)) };
  }
  const mine = {
    ip: hashSignal(guildId, 'ip', usableIp(ip)),
    net: hashSignal(guildId, 'net', networkOf(ip)),
    mobile: !!intel?.mobile,
    dev: hashSignal(guildId, 'dev', String(device || '').slice(0, 80)),
    fp: hashSignal(guildId, 'fp', String(fingerprint || '').slice(0, 200)),
    loc,
  };

  const sameDevice = [];
  const sameLocation = [];
  const sameNetwork = [];
  const sharedMobile = [];
  const sameFp = [];
  for (const [otherId, o] of Object.entries(users)) {
    if (otherId === String(userId) || !o) continue;
    // Older records (before networks were kept) compare on the exact address.
    const net = !!(mine.net && (o.net ? o.net === mine.net : o.ip && o.ip === mine.ip));
    if (mine.dev && o.dev === mine.dev) sameDevice.push(otherId);
    else if (loc && o.loc?.cell && loc.near.includes(o.loc.cell)) sameLocation.push(otherId);
    else if (net && (mine.mobile || o.mobile)) sharedMobile.push(otherId);
    else if (net) sameNetwork.push(otherId);
    if (mine.fp && o.fp === mine.fp && o.dev !== mine.dev) sameFp.push(otherId);
  }

  const n = (k, label) => `${label} ${k.length} other account${k.length === 1 ? '' : 's'}`;
  const notes = [];
  if (sharedMobile.length) notes.push(n(sharedMobile, 'shares a mobile-carrier address with'));
  if (sameFp.length) notes.push(n(sameFp, 'same browser profile as'));
  if (!mine.net) notes.push('connection not checked');
  if (intel && !intel.ok && mine.net) notes.push('connection type unknown');
  if (mine.mobile) notes.push('on mobile data');
  if (mode !== 'off') {
    if (!fix) notes.push(location?.error === 'denied' ? 'location not shared' : 'location unavailable on this device');
    else if (!precise) notes.push(`location too rough to compare (±${Math.round(fix.acc || 0)} m)`);
  }

  let status = 'verified';
  let reason = null;
  let matchedWith = [];
  if (sameDevice.length) {
    status = 'flagged'; reason = 'same device as another account'; matchedWith = sameDevice;
  } else if (sameLocation.length) {
    status = 'flagged'; reason = 'same location as another account (within about 50 m)'; matchedWith = sameLocation;
  } else if (sameNetwork.length) {
    status = 'flagged'; reason = 'same internet connection as another account'; matchedWith = sameNetwork;
  }
  // Which signals the first match shares, for the report: lets staff see at a
  // glance how strong the match is (device alone is near-certain).
  const first = matchedWith[0] && users[matchedWith[0]];
  const firstNet = !!(first && mine.net && (first.net ? first.net === mine.net : first.ip === mine.ip));
  const signals = first ? {
    device: !!(mine.dev && first.dev === mine.dev),
    browser: !!(mine.fp && first.fp === mine.fp),
    network: firstNet,
    connection: firstNet,   // the name older reports and panels read
    location: !!(loc && first.loc?.cell && loc.near.includes(first.loc.cell)),
  } : null;

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
  if (users[userId].status === 'verified') markDrop(s, guildId, messageId, userId);
  writeJson(FILE, s);
  return { status: users[userId].status, reason, matchedWith, notes, signals };
}

/* ── alt cases (one per catch; the report and the panel act on the same one) ── */

const MAX_CASES_PER_GUILD = 100;

function caseId() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (const b of crypto.randomBytes(4)) out += abc[b % abc.length];
  return `AC-${out}`;
}

function openCase(guildId, data) {
  const s = store();
  if (!s.cases) s.cases = {};
  const g = s.cases[guildId] || (s.cases[guildId] = {});
  const id = caseId();
  g[id] = { id, at: Date.now(), status: 'open', history: [], ...data };
  const ids = Object.keys(g);
  if (ids.length > MAX_CASES_PER_GUILD) {
    ids.sort((a, b) => (g[a].at || 0) - (g[b].at || 0));
    for (const old of ids.slice(0, ids.length - MAX_CASES_PER_GUILD)) delete g[old];
  }
  writeJson(FILE, s);
  return g[id];
}

function getCase(guildId, id) {
  return store().cases?.[guildId]?.[id] || null;
}

function updateCase(guildId, id, patch) {
  const s = store();
  const c = s.cases?.[guildId]?.[id];
  if (!c) return null;
  Object.assign(c, typeof patch === 'function' ? patch(c) : patch);
  writeJson(FILE, s);
  return c;
}

function listCases(guildId, limit = 20) {
  return Object.values(store().cases?.[guildId] || {}).sort((a, b) => b.at - a.at).slice(0, limit);
}

/**
 * 'verified' | 'flagged' | 'none'.
 * With a messageId (a giveaway), verified means verified *for that drop*:
 * every giveaway asks again. An account held for matching another stays held
 * everywhere until staff approve it.
 */
function statusOf(guildId, userId, messageId = null) {
  const s = store();
  const u = s.users[guildId]?.[userId];
  if (!u) return 'none';
  if (u.status !== 'verified') return 'flagged';
  if (!messageId) return 'verified';
  return (s.drops[guildId]?.[messageId]?.users || []).includes(String(userId)) ? 'verified' : 'none';
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
    location: locationMode(guildId),
    verified: rows.filter(r => r.status === 'verified').length,
    flagged: rows.filter(r => r.status !== 'verified').sort((a, b) => b.at - a.at).slice(0, 50),
    recent: rows.filter(r => r.status === 'verified').sort((a, b) => b.at - a.at).slice(0, 10),
    // The alt cases (what the mod-log report acts on), newest first; the held
    // rows above link to theirs by caseId.
    cases: listCases(guildId, 15).map(c => ({
      id: c.id, at: c.at, status: c.status, reason: c.reason || null, signals: c.signals || null,
      userId: c.userId, name: name(c.userId),
      matchedWith: (c.matchedWith || []).map(m => ({ userId: m, name: name(m) })),
      prize: c.giveaway?.prize || null, dropId: c.giveaway?.dropId || null,
      history: (c.history || []).slice(-5),
    })),
  };
}

/** Forget a member who left — their signals should not outlive them. */
function forget(guildId, userId) {
  const s = store();
  let changed = false;
  if (s.users[guildId]?.[userId]) { delete s.users[guildId][userId]; changed = true; }
  for (const d of Object.values(s.drops[guildId] || {})) {
    const i = (d.users || []).indexOf(String(userId));
    if (i >= 0) { d.users.splice(i, 1); changed = true; }
  }
  if (changed) writeJson(FILE, s);
}

module.exports = {
  TOKEN_TTL_MS, isEnabled, setEnabled, locationMode, setLocationMode, LOCATION_MODES,
  makeToken, readToken, precheck, networkOf,
  record, statusOf, entryOf, setOverride, summary, forget,
  openCase, getCase, updateCase, listCases,
};
