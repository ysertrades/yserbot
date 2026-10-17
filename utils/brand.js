'use strict';

/**
 * brand.js — each server's own name, caption, colour and logo.
 *
 * The bot used to sign every banner, card and footer "QuantLab", whichever
 * server it was posting in. Now a server can set its own brand on the panel's
 * Settings tab, and everything that used to say QuantLab says that instead.
 *
 * Generated images are drawn synchronously, deep inside code that is never
 * told which server it is drawing for. Rather than thread a guild id through
 * every generator, the server is carried in an AsyncLocalStorage context: the
 * event dispatcher, the background runners and the panel each wrap their work
 * in run(guildId, …), and anything underneath reads current(). Outside any
 * context — or for a server that has set nothing — it is the QuantLab default,
 * so nothing changes for anyone who never opens the setting.
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'brand.json';
const DEFAULTS = Object.freeze({
  name: 'QuantLab',
  caption: 'ORIGINAL DESIGN',
  accent: null,       // '#RRGGBB' or null to keep each card's own colours
  logoUrl: null,      // https image; null = the QuantLab logo
  watermark: true,    // the faint woven wordmark across banners
  version: 0,         // bumped on every change, so cached images redraw
});

const als = new AsyncLocalStorage();
const logos = new Map(); // guildId -> { url, w, h, data } | { url, failed: true }

function all() {
  return readJson(FILE, {});
}

function getBrand(guildId) {
  if (!guildId) return { ...DEFAULTS };
  const saved = all()[guildId] || {};
  return { ...DEFAULTS, ...saved };
}

const HEX = /^#?[0-9a-f]{6}$/i;

/**
 * @returns {{ ok: true, brand: object } | { error: string, detail?: string }}
 */
function setBrand(guildId, body = {}) {
  if (!guildId) return { error: 'bad_guild' };
  const cur = getBrand(guildId);
  const next = { ...cur };

  if ('name' in body) {
    const v = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
    next.name = v || DEFAULTS.name;
  }
  if ('caption' in body) {
    next.caption = String(body.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 28);
  }
  if ('accent' in body) {
    const v = body.accent == null ? '' : String(body.accent).trim();
    if (v && !HEX.test(v)) return { error: 'bad_color', detail: 'Accent must be a 6-digit hex colour.' };
    next.accent = v ? (v.startsWith('#') ? v : `#${v}`).toUpperCase() : null;
  }
  if ('logoUrl' in body) {
    const v = body.logoUrl == null ? '' : String(body.logoUrl).trim();
    if (v && !/^https:\/\//i.test(v)) return { error: 'bad_url', detail: 'The logo must be an https image link or an upload.' };
    next.logoUrl = v ? v.slice(0, 500) : null;
  }
  if ('watermark' in body) next.watermark = !!body.watermark;
  if ('reset' in body && body.reset) Object.assign(next, DEFAULTS);

  next.version = (cur.version || 0) + 1;
  const store = all();
  store[guildId] = next;
  writeJson(FILE, store);
  logos.delete(guildId);
  warmLogo(guildId).catch(() => {});
  return { ok: true, brand: next };
}

/* ── the context ─────────────────────────────────────────────────────────── */

function run(guildId, fn) {
  return als.run(guildId ? String(guildId) : null, fn);
}

/**
 * For loops in the background runners: everything after this call in the
 * same async chain (until the next enter) is for that server.
 */
function enter(guildId) {
  als.enterWith(guildId ? String(guildId) : null);
}

function currentGuildId() {
  return als.getStore() || null;
}

/** The brand for whatever server the current work is for. */
function current() {
  return getBrand(currentGuildId());
}

/**
 * Part of every memoised image's cache key, so one server's banner is never
 * served to another and a change shows on the next draw. Empty for anyone on
 * the default brand — those keep sharing one cached copy, as before.
 */
function cacheKey() {
  const id = currentGuildId();
  if (!id) return '';
  const b = all()[id];
  if (!b) return '';
  const logo = logos.get(id);
  return `${id}:${b.version || 0}:${logo && logo.data ? 'L' : ''}`;
}

/** Best guess at which server a Discord event belongs to. */
function guildIdOf(x) {
  if (!x || typeof x !== 'object') return null;
  return x.guildId || x.guild?.id || x.message?.guildId || x.channel?.guildId || null;
}

/* ── the logo ────────────────────────────────────────────────────────────── */

const LOGO_SIZE = 64;

async function warmLogo(guildId) {
  const b = getBrand(guildId);
  if (!b.logoUrl) { logos.delete(guildId); return null; }
  const have = logos.get(guildId);
  if (have && have.url === b.logoUrl) return have;
  try {
    const res = await fetch(b.logoUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error('too large');
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const img = await loadImage(buf);
    const c = createCanvas(LOGO_SIZE, LOGO_SIZE);
    const s = Math.min(img.width, img.height);
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, LOGO_SIZE, LOGO_SIZE);
    const data = c.getContext('2d').getImageData(0, 0, LOGO_SIZE, LOGO_SIZE).data;
    const out = { url: b.logoUrl, w: LOGO_SIZE, h: LOGO_SIZE, data };
    logos.set(guildId, out);
    return out;
  } catch (err) {
    console.warn(`[brand] logo for ${guildId} could not load:`, err.message);
    logos.set(guildId, { url: b.logoUrl, failed: true });
    return null;
  }
}

/** Loads every saved custom logo — called once the bot is up. */
async function warmAll() {
  for (const id of Object.keys(all())) {
    try { await warmLogo(id); } catch { /* one bad link never stops the rest */ }
  }
}

/** The current server's logo pixels, or null to use the QuantLab logo. */
function currentLogo() {
  const id = currentGuildId();
  if (!id) return null;
  const l = logos.get(id);
  return l && l.data ? l : null;
}

module.exports = {
  DEFAULTS, getBrand, setBrand,
  run, enter, current, currentGuildId, cacheKey, guildIdOf,
  warmLogo, warmAll, currentLogo,
};
