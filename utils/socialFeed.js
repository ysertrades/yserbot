'use strict';

/**
 * socialFeed.js
 *
 * Watching accounts on YouTube, TikTok, Instagram and X, and posting what
 * they put out into a Discord channel.
 *
 * ── How each one is actually reached ─────────────────────────────────────
 *
 * This is the part worth being straight about, because only one of the four
 * has a door left open.
 *
 *   YouTube  — publishes a real Atom feed per channel, no key, no limits:
 *              /feeds/videos.xml?channel_id=UC…  This one just works, and it
 *              works for as long as YouTube keeps it up. A handle (@name) is
 *              resolved to the channel id once and remembered, because nobody
 *              knows their own UC… id off the top of their head.
 *
 *   X, Instagram, TikTok
 *            — none of them will hand a feed to a program any more without a
 *              paid key or a logged-in session. What everybody actually does
 *              is put a bridge in between: a service that logs in, reads the
 *              page and re-publishes it as RSS. RSSHub is the usual one and is
 *              the default here, but the address is a setting, so a server
 *              that runs its own bridge points at that instead — which is the
 *              only arrangement that is genuinely reliable, since the public
 *              instance is shared by everyone and rate-limits accordingly.
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
 * X's actual brand colour is black, which on Discord's dark theme is a spine
 * you cannot see — the embed reads as broken rather than as X. The old
 * Twitter blue is what people still recognise, so that is the default; the
 * colour is editable on the Appearance screen like every other, so anyone who
 * wants the black can have it.
 */
const PLATFORMS = {
  youtube: {
    key: 'youtube',
    label: 'YouTube',
    emoji: '▶️',
    color: '#FF0000',
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
    styleKey: 'social.tiktok',
    direct: false,
    handleHint: '@username',
    verb: 'posted on TikTok',
    profileUrl: h => `https://www.tiktok.com/@${h.replace(/^@/, '')}`,
    bridgePath: h => `/tiktok/user/@${h.replace(/^@/, '')}`,
  },
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    emoji: '📸',
    color: '#E1306C',
    styleKey: 'social.instagram',
    direct: false,
    handleHint: '@username',
    verb: 'posted on Instagram',
    profileUrl: h => `https://www.instagram.com/${h.replace(/^@/, '')}/`,
    bridgePath: h => `/instagram/user/${h.replace(/^@/, '')}`,
  },
  twitter: {
    key: 'twitter',
    label: 'X',
    emoji: '𝕏',
    color: '#1D9BF0',
    styleKey: 'social.twitter',
    direct: false,
    handleHint: '@username',
    verb: 'posted on X',
    profileUrl: h => `https://x.com/${h.replace(/^@/, '')}`,
    // /twitter/… rather than /x/…, which is what newer RSSHub calls it. The
    // old path is kept as a redirect on the new builds and is the only path on
    // the older ones, so pointing at it works against both — and fetch follows
    // the redirect without being asked.
    bridgePath: h => `/twitter/user/${h.replace(/^@/, '')}`,
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
  // Discord unfurls a link in the message text into a second card underneath
  // ours. Off by default because two cards for one post is what it looks like.
  showLinkPreview: false,
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
    accounts: (Array.isArray(stored.accounts) ? stored.accounts : []).map(normaliseAccount),
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
 * The address to poll, in order of preference:
 *   1. whatever the account was told to use,
 *   2. the platform's own feed if it has one,
 *   3. the bridge.
 */
function feedUrlFor(account, settings) {
  if (account.feedUrl) return account.feedUrl;
  const platform = PLATFORMS[account.platform];
  if (!platform) return null;

  if (platform.direct) {
    return platform.feedUrl(account.handle, { channelId: account.channelId });
  }

  const base = String(settings.bridgeUrl || DEFAULTS.bridgeUrl).replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}${platform.bridgePath(account.handle)}`;
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

  const url = feedUrlFor({ ...account, channelId: resolvedChannelId }, settings);
  if (!url) throw new Error('No feed address for that account');

  const xml = await getText(url);
  const items = parseFeed(xml);
  if (!items.length) throw new Error('The feed came back empty');
  return { items, url, channelId: resolvedChannelId };
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
  feedUrlFor, fetchAccount, parseFeed, resolveYouTubeChannelId, checkBridge,
  matches, newItems, htmlToText, clamp,
};
