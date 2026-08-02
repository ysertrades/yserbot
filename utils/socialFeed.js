'use strict';

/**
 * socialFeed.js
 *
 * Watching accounts on YouTube and TikTok, and posting what they put out into
 * a Discord channel.
 *
 * ── Why these two and not four ───────────────────────────────────────────
 *
 * Instagram and X were here and have been taken out, because neither could be
 * made to work rather than because nobody wanted them. Both refuse a program
 * outright now, so the only way in is a bridge — a service that logs in, reads
 * the page and re-publishes it as RSS — and the free shared bridge everybody
 * points at has since restricted itself to testing use and turns servers away.
 * Instagram's route additionally wants a logged-in account that a shared
 * service does not have. Every public alternative that was tried refuses a
 * request from a server rather than a person.
 *
 * A platform that is offered and cannot work is worse than one that is not
 * offered: it reads as the bot being broken. Anyone running their own bridge
 * can still watch either of them through an account's own feed address, which
 * is the setting immediately below.
 *
 * ── How each one is actually reached ─────────────────────────────────────
 *
 *   YouTube  — publishes a real Atom feed per channel, no key, no limits:
 *              /feeds/videos.xml?channel_id=UC…  This one just works, and it
 *              works for as long as YouTube keeps it up. A handle (@name) is
 *              resolved to the channel id once and remembered, because nobody
 *              knows their own UC… id off the top of their head.
 *
 *   TikTok   — will not hand a feed to a program without a logged-in session,
 *              so it goes through a bridge. RSSHub is the usual one and is the
 *              default here, but the address is a setting, so a server that
 *              runs its own bridge points at that instead — which is the only
 *              arrangement that is genuinely reliable, since the public
 *              instance is shared by everyone and restricts accordingly.
 *
 *   anything — every account can override its feed address outright. A bridge
 *              nobody here has heard of, a Nitter mirror, a plain RSS export:
 *              if it speaks RSS or Atom it works, and it keeps working when
 *              whatever we guessed about a platform's URLs stops being true.
 *
 * The panel says all of this on the screen rather than leaving someone to
 * work out why their Instagram is quiet.
 *
 * ── What is stored ───────────────────────────────────────────────────────
 *
 * data/social.json, per guild: the shared settings, then a list of accounts.
 * Each account carries its own cursor, so one going quiet or erroring never
 * stalls the others, and its last error, so the panel can say what is wrong
 * instead of just showing nothing.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'social.json';

/* ─── the platforms ──────────────────────────────────────────────────────── */

/**
 * Brand colours.
 *
 * X's is black. Not #000000 though — Discord reads an embed colour of zero as
 * "no colour set" and draws its own grey instead, so pure black is the one
 * black that cannot be used. #0F1419 is X's own near-black and renders as
 * black.
 *
 * Each is editable on the Appearance screen like every other message.
 */
const PLATFORMS = {
  youtube: {
    key: 'youtube',
    label: 'YouTube',
    emoji: '▶️',
    color: '#FF0000',
    mark: 'youtube',
    styleKey: 'social.youtube',
    // The one that needs nothing in between.
    direct: true,
    handleHint: '@channelhandle, a UC… channel id, or a channel URL',
    verb: 'posted a video',
    profileUrl: h => (h.startsWith('UC') ? `https://www.youtube.com/channel/${h}` : `https://www.youtube.com/${h}`),
    feedUrl: (handle, { channelId } = {}) => {
      const id = channelId || (handle.startsWith('UC') ? handle : null);
      return id ? `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}` : null;
    },
  },
  tiktok: {
    key: 'tiktok',
    label: 'TikTok',
    emoji: '🎵',
    color: '#FE2C55',
    mark: 'tiktok',
    styleKey: 'social.tiktok',
    direct: false,
    handleHint: '@username',
    verb: 'posted on TikTok',
    profileUrl: h => `https://www.tiktok.com/@${h.replace(/^@/, '')}`,
    bridgePaths: h => [`/tiktok/user/@${h.replace(/^@/, '')}`, `/tiktok/user/${h.replace(/^@/, '')}`],
  },
};

const PLATFORM_KEYS = Object.keys(PLATFORMS);

/* ─── settings ───────────────────────────────────────────────────────────── */

const DEFAULTS = {
  enabled: false,
  channelId: null,
  mentionRoleId: null,
  // The public RSSHub. Anyone running their own points at it here, which is
  // the difference between "usually works" and "works".
  bridgeUrl: 'https://rsshub.app',
  pollMinutes: 10,
  // A watched account that has been quiet for a week and then posts eight
  // things must not dump eight cards at once.
  maxPerCheck: 3,
};

const LIMITS = { accounts: 25, handle: 80, label: 60, keyword: 40, keywords: 12, feedUrl: 400 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));

function normaliseAccount(raw, index) {
  const platform = Object.hasOwn(PLATFORMS, raw?.platform) ? raw.platform : 'youtube';
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `acc${index + 1}`,
    platform,
    handle: String(raw?.handle ?? '').slice(0, LIMITS.handle),
    label: raw?.label ? String(raw.label).slice(0, LIMITS.label) : null,
    // Resolved once for YouTube handles, so the lookup is not repeated on
    // every poll for the life of the account.
    channelId: raw?.channelId ? String(raw.channelId).slice(0, 64) : null,
    feedUrl: raw?.feedUrl ? String(raw.feedUrl).slice(0, LIMITS.feedUrl) : null,
    postChannelId: raw?.postChannelId ? String(raw.postChannelId) : null,
    mentionRoleId: raw?.mentionRoleId ? String(raw.mentionRoleId) : null,
    enabled: raw?.enabled !== false,
    includeKeywords: Array.isArray(raw?.includeKeywords) ? raw.includeKeywords.slice(0, LIMITS.keywords) : [],
    excludeKeywords: Array.isArray(raw?.excludeKeywords) ? raw.excludeKeywords.slice(0, LIMITS.keywords) : [],
    lastId: raw?.lastId ?? null,
    lastCheckedAt: Number(raw?.lastCheckedAt) || 0,
    lastPostedAt: Number(raw?.lastPostedAt) || 0,
    lastError: raw?.lastError ? String(raw.lastError).slice(0, 200) : null,
    // Which of the candidate paths last worked, so the next check starts
    // there rather than walking the list again.
    feedPath: raw?.feedPath ? String(raw.feedPath).slice(0, 200) : null,
    // Consecutive failures, which is what the runner's back-off counts.
    failures: Number(raw?.failures) || 0,
    posts: Number(raw?.posts) || 0,
  };
}

function getSettings(guildId) {
  const stored = readJson(FILE, {})[guildId] || {};
  return {
    ...DEFAULTS,
    ...stored,
    pollMinutes: clamp(stored.pollMinutes ?? DEFAULTS.pollMinutes, 2, 360),
    maxPerCheck: clamp(stored.maxPerCheck ?? DEFAULTS.maxPerCheck, 1, 10),
    bridgeUrl: typeof stored.bridgeUrl === 'string' && stored.bridgeUrl ? stored.bridgeUrl : DEFAULTS.bridgeUrl,
    // An account on a platform that is no longer offered is dropped here
    // rather than normalised. normaliseAccount falls back to YouTube for a
    // platform it does not know, which is right for a typo and quite wrong
    // for a retirement — an Instagram handle wearing a YouTube badge would
    // fail every check forever and read as a bug rather than as a removal.
    // The record stays on disk untouched; it simply stops being served.
    accounts: (Array.isArray(stored.accounts) ? stored.accounts : [])
      .filter(a => Object.hasOwn(PLATFORMS, a?.platform))
      .map(normaliseAccount),
  };
}

function setSettings(guildId, next) {
  const all = readJson(FILE, {});
  all[guildId] = { ...(all[guildId] || {}), ...next };
  writeJson(FILE, all);
  return getSettings(guildId);
}

/** Writes one account's fields back without disturbing the others. */
function patchAccount(guildId, accountId, patch) {
  const all = readJson(FILE, {});
  const guild = all[guildId];
  if (!guild || !Array.isArray(guild.accounts)) return null;
  const idx = guild.accounts.findIndex(a => a.id === accountId);
  if (idx === -1) return null;
  guild.accounts[idx] = { ...guild.accounts[idx], ...patch };
  writeJson(FILE, all);
  return normaliseAccount(guild.accounts[idx], idx);
}

/* ─── where an account's feed lives ──────────────────────────────────────── */

/**
 * Every address worth trying for one account, best first.
 *
 * A list rather than one address because a bridge's routes get renamed and
 * the old name is not always kept. RSSHub moved X from /twitter/user to
 * /x/user, and the old path became a flat 404 — every watched X account went
 * quiet and the panel could only report the 404, which said nothing about
 * why. Trying both means a rename costs one wasted request instead of the
 * whole feature, and the working one is remembered afterwards.
 *
 * Order:
 *   1. whatever the account was told to use, alone — an explicit address is
 *      an instruction, not a suggestion, and guessing past it would be wrong;
 *   2. the one that worked last time, if there is one;
 *   3. the platform's own feed, or the bridge's candidates.
 */
function feedUrlsFor(account, settings) {
  if (account.feedUrl) return [account.feedUrl];
  const platform = PLATFORMS[account.platform];
  if (!platform) return [];

  if (platform.direct) {
    const url = platform.feedUrl(account.handle, { channelId: account.channelId });
    return url ? [url] : [];
  }

  const base = String(settings.bridgeUrl || DEFAULTS.bridgeUrl).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return [];

  const paths = platform.bridgePaths(account.handle);
  // The remembered one first. It is still followed by the rest, so a bridge
  // that changes again recovers on its own rather than sticking to a path
  // that has stopped working.
  const ordered = account.feedPath && paths.includes(account.feedPath)
    ? [account.feedPath, ...paths.filter(x => x !== account.feedPath)]
    : paths;
  return ordered.map(path => `${base}${path}`);
}

/** The address that will be tried first — what the panel shows. */
function feedUrlFor(account, settings) {
  return feedUrlsFor(account, settings)[0] || null;
}

/* ─── fetching ───────────────────────────────────────────────────────────── */

const UA = 'Mozilla/5.0 (compatible; YSERFlowBot/1.0; +https://github.com/ysertrades/yserbot)';
const FETCH_TIMEOUT_MS = 12_000;

async function getText(url, { timeout = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/* ─── getting the picture at its real size ───────────────────────────────── */

/**
 * Feeds point at a small copy of the picture, and the card is wide.
 *
 * YouTube's Atom feed always names `hqdefault.jpg`, which is 480×360 — and
 * 4:3, so a widescreen video is letterboxed inside it and the actual frame is
 * 480×270. Drawn across the full width of an embed on a phone, at two or
 * three device pixels to the CSS pixel, that is being asked to cover roughly
 * four times the width it has, and it looks exactly as soft as that sounds.
 *
 * The same frame exists at 1280×720 under a different name, with no bars. It
 * is not in the feed and there is no flag that says whether it is there, so
 * the only way to know is to ask — which is what this does, once per video,
 * and then remembers the answer.
 *
 *   maxresdefault — the source frame, whatever it was uploaded at
 *   hq720         — 1280×720, present on some where maxres is not
 *   (the feed's own hqdefault, if neither is)
 *
 * A video uploaded below 720p has neither, and YouTube answers those with a
 * 404 whose *body* is a 120×90 grey placeholder — so this checks the status
 * and not whether bytes came back. Getting that backwards would swap a soft
 * picture for a grey rectangle, which is worse.
 */
const YT_THUMB = /^(https?:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/[A-Za-z0-9_-]{6,}\/)([a-z0-9_]+)(\.(?:jpg|webp)(?:\?.*)?)$/i;
const YT_BETTER = ['maxresdefault', 'hq720'];

// One entry per video, and only for videos actually posted — a busy server
// watching a dozen accounts will hold a few hundred of these at most. Capped
// anyway, because a process that runs for months should not have anything
// that only grows.
const IMAGE_CACHE = new Map();
const IMAGE_CACHE_MAX = 500;

function rememberImage(from, to) {
  if (IMAGE_CACHE.size >= IMAGE_CACHE_MAX) {
    // Oldest first. Map keeps insertion order, so this is the first key.
    IMAGE_CACHE.delete(IMAGE_CACHE.keys().next().value);
  }
  IMAGE_CACHE.set(from, to);
  return to;
}

/** Does this address exist? Never throws — an unknown is a no. */
async function exists(url, timeout = 6_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * X serves the same picture at whatever size the query string asks for.
 *
 * `name=small` is 680px on its longest side; `name=orig` is what was
 * uploaded. Both are the same media key, so this is a rename rather than a
 * guess — there is nothing to check and it cannot 404.
 */
function widenTwitterImage(url) {
  if (!/^https?:\/\/pbs\.twimg\.com\//i.test(url)) return null;
  // The query-string form, and the older colon suffix.
  if (/[?&]name=/i.test(url)) return url.replace(/([?&]name=)[^&]*/i, '$1orig');
  if (/:(thumb|small|medium|large)$/i.test(url)) return url.replace(/:(thumb|small|medium|large)$/i, ':orig');
  return null;
}

/**
 * The sharpest version of a picture a feed pointed at.
 *
 * Always resolves to a usable address: when there is nothing better, or when
 * finding out would mean waiting on a network that is not answering, it hands
 * back exactly what it was given. A soft picture beats no picture.
 *
 * Instagram and TikTok are deliberately left alone. Their CDNs bake the size
 * into a signed path, so a rewritten URL does not return a bigger picture —
 * it returns a 403.
 */
async function sharpestImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return url;
  if (IMAGE_CACHE.has(url)) return IMAGE_CACHE.get(url);

  const widened = widenTwitterImage(url);
  if (widened) return rememberImage(url, widened);

  const yt = url.match(YT_THUMB);
  if (yt) {
    const [, base, name, ext] = yt;
    // Already asking for one of the big ones.
    if (YT_BETTER.includes(name.toLowerCase())) return rememberImage(url, url);
    for (const better of YT_BETTER) {
      const candidate = `${base}${better}${ext}`;
      if (await exists(candidate)) return rememberImage(url, candidate);
    }
    return rememberImage(url, url);
  }

  return rememberImage(url, url);
}

/**
 * Turns a YouTube handle into the UC… id its feed is keyed by.
 *
 * There is no API for this without a key, but the channel page carries the id
 * in its own markup — that is what the page itself uses to subscribe you. The
 * result is written back onto the account so this happens once, not every ten
 * minutes forever.
 */
async function resolveYouTubeChannelId(handle) {
  const cleaned = String(handle || '').trim();
  if (!cleaned) return null;
  if (/^UC[\w-]{20,}$/.test(cleaned)) return cleaned;

  const m = cleaned.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (m) return m[1];

  const path = cleaned.startsWith('http')
    ? cleaned
    : `https://www.youtube.com/${cleaned.startsWith('@') ? cleaned : `@${cleaned}`}`;

  const html = await getText(path);
  const found = html.match(/"channelId":"(UC[\w-]+)"/)
    || html.match(/channel_id=(UC[\w-]+)/)
    || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/);
  return found ? found[1] : null;
}

/**
 * Asks the bridge whether it is there.
 *
 * Three of the four platforms are only reachable through it, and when it is
 * down or blocked they all go quiet at once with nothing to show for it. This
 * turns that into a sentence somebody can act on — and it is worth checking
 * from the machine the bot runs on rather than from a browser, because the two
 * are on different networks and only one of them matters.
 */
async function checkBridge(bridgeUrl) {
  const base = String(bridgeUrl || DEFAULTS.bridgeUrl).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return { ok: false, reason: 'That is not an http address.' };

  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(base, { headers: { 'User-Agent': UA }, signal: controller.signal })
      .finally(() => clearTimeout(timer));
    const ms = Date.now() - started;
    if (res.ok) return { ok: true, status: res.status, ms };
    return {
      ok: false, status: res.status, ms,
      reason: res.status === 403 || res.status === 429
        ? `It answered ${res.status} — it is up, but it is refusing this server. A public bridge does that when it is busy or when it does not like where the request came from. Running your own is the fix.`
        : `It answered ${res.status}.`,
    };
  } catch (err) {
    return {
      ok: false, ms: Date.now() - started,
      reason: `Could not reach it at all: ${(err.message || String(err)).slice(0, 120)}`,
    };
  }
}

/* ─── parsing ────────────────────────────────────────────────────────────── */

// Feeds double-encode entities often enough that one pass is not sufficient —
// "S&amp;amp;P" needs two. Loops until it stops changing.
function decodeEntities(str) {
  let prev = String(str ?? '');
  for (let i = 0; i < 5; i++) {
    const next = prev
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
      .replace(/&amp;/g, '&');
    if (next === prev) break;
    prev = next;
  }
  return prev.trim();
}

// A malformed numeric entity would otherwise throw out of the whole parse and
// lose every item in the feed for one bad character.
function safeCodePoint(n) {
  try { return String.fromCodePoint(n); } catch { return ''; }
}

function stripCdata(str) {
  const m = String(str).match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : str;
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeEntities(stripCdata(m[1])) : '';
}

function attr(block, pattern, name) {
  const el = block.match(pattern);
  if (!el) return null;
  const m = el[0].match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

const MAX_BODY = 1200;

function htmlToText(html) {
  if (!html) return '';
  let text = String(html)
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d)>/gi, '\n')
    .replace(/<(strong|b)[^>]*>/gi, '**').replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)[^>]*>/gi, '*').replace(/<\/(em|i)>/gi, '*')
    .replace(/<[^>]+>/g, '');
  text = decodeEntities(text).split('\n').map(l => l.trim()).filter(Boolean).join('\n').trim();
  if (text.length > MAX_BODY) text = `${text.slice(0, MAX_BODY - 1).trimEnd()}…`;
  return text;
}

function firstImage(...sources) {
  for (const src of sources) {
    if (!src) continue;
    const m = String(src).match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m) return decodeEntities(m[1]);
  }
  return null;
}

/**
 * Reads RSS <item>s and Atom <entry>s the same way.
 *
 * YouTube publishes Atom and everything else publishes RSS, and writing two
 * parsers means two places for a feed to be read slightly wrong. Newest
 * first, matching what both formats promise.
 */
function parseFeed(xml) {
  const text = String(xml || '');
  const blocks = [
    ...(text.match(/<item[\s>][\s\S]*?<\/item>/gi) || []),
    ...(text.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []),
  ];

  const items = [];
  for (const block of blocks) {
    const isAtom = /^<entry/i.test(block);

    const title = tag(block, 'title') || tag(block, 'media:title');
    // Atom puts the address in an attribute, RSS in the element's text.
    const link = isAtom
      ? (attr(block, /<link\b[^>]*>/i, 'href') || tag(block, 'link'))
      : (tag(block, 'link') || attr(block, /<link\b[^>]*>/i, 'href'));

    const id = tag(block, 'guid') || tag(block, 'id') || link || title;
    if (!id) continue;

    const publishedRaw = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    const published = publishedRaw ? new Date(publishedRaw) : new Date();

    const descriptionHtml = tag(block, 'description') || tag(block, 'content:encoded')
      || tag(block, 'content') || tag(block, 'summary') || tag(block, 'media:description');

    const image = attr(block, /<media:thumbnail\b[^>]*>/i, 'url')
      || attr(block, /<media:content\b[^>]*>/i, 'url')
      || attr(block, /<enclosure\b[^>]*>/i, 'url')
      || firstImage(descriptionHtml);

    // Atom wraps the author in an element of its own — <author><name>…</name>
    // <uri>…</uri></author> — so reading <author> whole gives the name with
    // the profile URL glued to the end of it. Take the <name> from inside.
    const authorBlock = block.match(/<author[\s>][\s\S]*?<\/author>/i)?.[0];
    const author = tag(block, 'dc:creator')
      || (authorBlock ? tag(authorBlock, 'name') : '')
      || tag(block, 'media:credit')
      || (authorBlock ? authorBlock.replace(/<[^>]*>/g, ' ') : '');

    items.push({
      id,
      title: title || '(untitled)',
      link: link || '',
      published: Number.isNaN(published.getTime()) ? new Date() : published,
      text: htmlToText(descriptionHtml),
      image: image && /^https?:\/\//i.test(image) ? image : null,
      // Some feeds put an email or a URL in the author field. Neither is a
      // name, and both look wrong at the top of a card.
      author: author.replace(/https?:\/\/\S+/g, '').replace(/\s*<[^>]*>\s*/g, ' ')
        .replace(/\s+/g, ' ').trim().slice(0, 80),
    });
  }

  // Both formats promise newest-first, but a bridge assembling a page into a
  // feed does not always keep that promise. Sorting costs nothing and stops a
  // mis-ordered feed replaying old posts as new ones.
  items.sort((a, b) => b.published - a.published);
  return items;
}

/**
 * Pulls one account's feed and returns its items, newest first.
 *
 * Throws with something a person can read — the panel shows it verbatim, and
 * "HTTP 503" next to an account name is far more use than a blank list.
 */
async function fetchAccount(account, settings) {
  const platform = PLATFORMS[account.platform];
  if (!platform) throw new Error('Unknown platform');
  if (!account.handle && !account.feedUrl) throw new Error('No account name set');

  let resolvedChannelId = account.channelId;
  if (platform.direct && !account.feedUrl && !resolvedChannelId) {
    resolvedChannelId = await resolveYouTubeChannelId(account.handle);
    if (!resolvedChannelId) throw new Error('Could not find that YouTube channel');
  }

  const urls = feedUrlsFor({ ...account, channelId: resolvedChannelId }, settings);
  if (!urls.length) throw new Error('No feed address for that account');

  const tried = [];
  for (const url of urls) {
    try {
      const items = parseFeed(await getText(url));
      if (!items.length) { tried.push({ url, why: 'came back empty' }); continue; }
      return {
        items, url, channelId: resolvedChannelId,
        // Which one worked, so the next check goes straight there.
        feedPath: account.feedUrl ? null : new URL(url).pathname,
        tried,
      };
    } catch (err) {
      tried.push({ url, why: err.message || String(err) });
    }
  }

  const error = new Error(explain(platform, tried, settings));
  error.tried = tried;
  throw error;
}

/**
 * What to say when nothing worked.
 *
 * "HTTP 404" is true and useless. Every one of these failures has a different
 * thing to do about it, and the panel has room for a sentence.
 */
function explain(platform, tried, settings = null) {
  const codes = tried.map(t => t.why);
  const all = code => codes.length > 0 && codes.every(c => c.includes(code));
  const any = code => codes.some(c => c.includes(code));

  if (platform.direct) {
    return `Could not read that channel — ${codes[0] || 'no reply'}.`;
  }

  // Whether this is the shared address everyone gets by default. Its operator
  // has said in as many words that it is for testing and that they are
  // restricting readers, so on that bridge a refusal is the expected answer
  // rather than a puzzle — and no amount of retrying or renaming will change
  // it. Saying so beats sending someone off to check their spelling.
  const onSharedBridge = !settings
    || !settings.bridgeUrl
    || String(settings.bridgeUrl).includes('rsshub.app');
  const runYourOwn = onSharedBridge
    ? ' The free shared helper is meant for testing only and turns servers away; running your own — or pointing Bridge at one that works — is the fix. https://docs.rsshub.app/deploy/'
    : '';

  // Refusal is checked before renaming, and on "any" rather than "all". A run
  // that comes back 403 from one address and 404 from another is not two
  // problems: the 404 is just a path that bridge does not carry, and the 403
  // is the thing standing in the way. Requiring every code to match meant a
  // mixed run fell through to a bare list of status numbers.
  if (any('403') || any('401')) {
    return `The helper service refused this server. Its ${platform.label} route needs a logged-in account.${runYourOwn}`;
  }
  if (all('404')) {
    return `The helper service has no ${platform.label} route at any address tried. It has probably been renamed.${runYourOwn}`;
  }
  if (any('429')) {
    return `The helper service is rate-limiting us. It is shared by everybody; checking less often will help.${runYourOwn}`;
  }
  if (all('came back empty')) {
    return `The helper service answered but had no ${platform.label} posts in it. Check the account name.`;
  }
  return `Could not read it — ${codes.join('; ')}.${runYourOwn}`;
}

/* ─── filtering ──────────────────────────────────────────────────────────── */

/**
 * Keyword filters.
 *
 * Include narrows, exclude removes, and exclude wins — someone who has said
 * both "only clips about trading" and "never anything sponsored" means the
 * second one about a sponsored trading clip.
 */
function matches(item, account) {
  const hay = `${item.title} ${item.text}`.toLowerCase();
  const inc = (account.includeKeywords || []).map(k => k.toLowerCase()).filter(Boolean);
  const exc = (account.excludeKeywords || []).map(k => k.toLowerCase()).filter(Boolean);
  if (exc.some(k => hay.includes(k))) return false;
  if (inc.length && !inc.some(k => hay.includes(k))) return false;
  return true;
}

/**
 * The items posted since the cursor.
 *
 * With no cursor at all nothing is posted — the account has just been added
 * and the point is what happens next, not a dump of everything already on the
 * profile. The cursor is set to the newest item so the following check has a
 * baseline.
 */
function newItems(items, account, maxPerCheck) {
  if (!account.lastId) return [];
  const idx = items.findIndex(i => i.id === account.lastId);
  const fresh = idx === -1 ? items.slice(0, maxPerCheck) : items.slice(0, idx);
  return fresh.slice(0, maxPerCheck).filter(i => matches(i, account));
}

module.exports = {
  FILE, PLATFORMS, PLATFORM_KEYS, DEFAULTS, LIMITS,
  getSettings, setSettings, patchAccount, normaliseAccount,
  feedUrlFor, feedUrlsFor, fetchAccount, parseFeed, explain, resolveYouTubeChannelId, checkBridge,
  matches, newItems, htmlToText, clamp,
  sharpestImage, widenTwitterImage,
};
