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
  const logo = logos.get(id);
  const hasLogo = !!(logo && logo.data);
  if (!b && !hasLogo) return '';
  return `${id}:${b ? b.version || 0 : 0}:${hasLogo ? logo.url : ''}`;
}

/**
 * The short code in front of a drop ID, from the brand's own initials:
 * QuantLab → QL, YSER Lab → YL, Apex Trading Group → ATG. Styled names
 * (𝗬𝗦𝗘𝗥 𝓛𝓪𝓫) are read as their plain letters first.
 */
function prefixOf(name) {
  const plain = String(name || '').normalize('NFKC').replace(/[^A-Za-z0-9 ]+/g, ' ').trim();
  const words = plain.split(/\s+/).filter(Boolean);
  let p = '';
  if (words.length > 1) p = words.map((w) => w[0]).join('');
  else if (words.length === 1) {
    const caps = words[0].replace(/[^A-Z]/g, '');
    p = caps.length >= 2 && caps.length < words[0].length ? caps : words[0].slice(0, 2);
  }
  p = p.toUpperCase().slice(0, 3);
  return p.length >= 2 ? p : 'QL';
}

/** "YL-7F2A": a drop's ID as this server shows it. */
function dropRef(id, guildId) {
  if (id == null || id === '') return '';
  const b = guildId ? getBrand(guildId) : current();
  // The ID itself is kept exactly as is: rerolls look it up by it.
  return `${prefixOf(b.name)}-${String(id)}`;
}

/**
 * Who signs a drawn card: the server's brand name and logo when it has set
 * them in Settings, otherwise Quantbot. `img` is the full-size picture for
 * canvas drawing, or null to use the card's own Quantbot mark.
 */
function signature() {
  const id = currentGuildId();
  const custom = !!(id && all()[id]);
  const b = current();
  const l = id ? logos.get(id) : null;
  return { name: custom ? b.name : 'Quantbot', img: l && l.img ? l.img : null, accent: b.accent || null };
}

/** Best guess at which server a Discord event belongs to. */
function guildIdOf(x) {
  if (!x || typeof x !== 'object') return null;
  return x.guildId || x.guild?.id || x.message?.guildId || x.channel?.guildId || null;
}

/* ── the logo ────────────────────────────────────────────────────────────── */

const LOGO_SIZE = 64;

/** The bot's own picture in that server (Settings → Bot picture), if set. */
function serverPicture(guildId) {
  try {
    const u = readJson('config.json', {})[guildId]?.brandAvatar;
    return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null;
  } catch { return null; }
}

/** The logo a server's cards use: its brand logo, else its bot picture. */
function logoSource(guildId) {
  return getBrand(guildId).logoUrl || serverPicture(guildId);
}

async function fetchLogo(url) {
  const store = require('./imageStore');
  const own = /\/i\/([a-f0-9]{32})\.(png|jpg|webp|gif)$/.exec(url);
  if (own && store.isOwnUrl(url)) {
    const found = await store.load(own[1], own[2]);
    if (!found) throw new Error('not in the image store');
    return found.buf;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function warmLogo(guildId) {
  const src = logoSource(guildId);
  if (!src) { logos.delete(guildId); return null; }
  const have = logos.get(guildId);
  if (have && have.url === src) return have;
  try {
    const buf = await fetchLogo(src);
    if (buf.length > 8 * 1024 * 1024) throw new Error('too large');
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const img = await loadImage(buf);
    const c = createCanvas(LOGO_SIZE, LOGO_SIZE);
    const s = Math.min(img.width, img.height);
    c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, LOGO_SIZE, LOGO_SIZE);
    const data = c.getContext('2d').getImageData(0, 0, LOGO_SIZE, LOGO_SIZE).data;
    // `img` is the whole picture, for the canvas cards that draw it large.
    const out = { url: src, w: LOGO_SIZE, h: LOGO_SIZE, data, img };
    logos.set(guildId, out);
    return out;
  } catch (err) {
    console.warn(`[brand] logo for ${guildId} could not load:`, err.message);
    logos.set(guildId, { url: src, failed: true });
    return null;
  }
}

/** Loads every saved custom logo — called once the bot is up. */
async function warmAll() {
  let pictured = [];
  try { pictured = Object.keys(readJson('config.json', {})).filter((id) => serverPicture(id)); } catch { /* none */ }
  for (const id of new Set([...Object.keys(all()), ...pictured])) {
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

/** True when this server's saved logo link was tried and no longer loads (e.g. an expired Discord attachment). */
function logoFailed(guildId) {
  const have = logos.get(guildId);
  return !!(have && have.failed && have.url === getBrand(guildId).logoUrl);
}

/** After the bot picture changes: drop the old logo and load the new one. */
function refreshLogo(guildId) {
  logos.delete(guildId);
  return warmLogo(guildId).catch(() => null);
}

module.exports = {
  DEFAULTS, getBrand, setBrand,
  run, enter, current, currentGuildId, cacheKey, guildIdOf,
  warmLogo, warmAll, currentLogo, logoFailed, refreshLogo,
  prefixOf, dropRef, signature, serverPicture,
};
