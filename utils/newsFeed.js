'use strict';

// Polls Financial Juice's public RSS feed (financialjuice.com/feed.ashx) for
// real-time market-moving headlines and relays new ones into each guild's
// configured news channel as they're published. No API key / paid tier
// needed — it's a free, public feed that updates within seconds of a
// headline going out.

const { readJson, writeJson } = require('./jsonStorage');
const { AttachmentBuilder } = require('discord.js');
const { isValidUrl } = require('./embedBuilder');
const messageStyle = require('./messageStyle');
const { TOPICS, expandTopicKeywords } = require('./newsTopics');
const { generateNewsCard } = require('./newsCardVisual');
const { isFeatureEnabled } = require('./featureToggles');

// The address Financial Juice publishes as its RSS link. The same endpoint
// as the bare feed.ashx this used to request, with the query string their
// own published link carries.
const FEED_URL          = 'https://www.financialjuice.com/feed.ashx?xy=rss';
/**
 * How often the feed is read.
 *
 * Twenty seconds by default, which is what this has always aimed for. It is
 * a knob rather than a constant because the only thing that can say whether
 * a faster cadence is safe is the endpoint itself: Financial Juice's front
 * end rate-limits this URL, and polling past the limit gets the bot paused
 * and delivers news *later*, not sooner. Turning it down is therefore an
 * experiment to run against the real thing while watching for
 * "Rate-limited by Financial Juice" in the log — and if that appears, the
 * 429 handling below already honours their retry-after exactly, so the cost
 * of finding the floor is a pause, not lost headlines.
 *
 * Clamped: below a few seconds is certain to be refused, and beyond a few
 * minutes this has stopped being a news feed.
 */
const POLL_INTERVAL_MS = Math.min(
  300_000,
  Math.max(5_000, Number(process.env.NEWSFEED_POLL_MS) || 20_000),
);
const MAX_POST_PER_TICK = 8; // safety cap so a feed gap never dumps a huge backlog at once
const BREAKING_PATTERN  = /\b(breaking|urgent)\b/i;

/**
 * How long a headline will wait for a picture before going out without one.
 *
 * The banner is decoration; the headline is the product. Every lookup behind
 * it has its own generous timeout — 4s for a YouTube thumbnail, twice over,
 * then 5s for a linked page's share image, then 4s more for the article's own
 * picture — and they run one after another, so a single item pointing at a
 * slow or dead host could sit here for seventeen seconds before it was sent.
 * A market headline that arrives seventeen seconds late has stopped being
 * news. This caps the whole chain: whatever has been found by then is used,
 * and what has not is simply left out.
 */
const PICTURE_BUDGET_MS = 2500;

// Financial Juice's own feed double-encodes entities in places (raw XML has
// literally "S&amp;amp;P 500" for "S&P 500" — the HTML-escaped "&amp;" got
// XML-escaped again on top). A single decode pass leaves "S&amp;P 500"
// behind as literal text, so decode repeatedly until nothing changes.
function decodeEntities(str) {
  let prev = str;
  for (let i = 0; i < 5; i++) {
    const next = prev
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      // Feeds that encode curly quotes/dashes numerically (&#x2019; &#x201c;
      // &#x2014; …) would otherwise show that markup literally mid-headline.
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&amp;/g, '&');
    if (next === prev) break;
    prev = next;
  }
  return prev.trim();
}

// Strips a CDATA wrapper if the feed uses one. Financial Juice doesn't today,
// but it costs nothing to be tolerant and it's a silent, ugly failure when
// missing.
function stripCdata(str) {
  const m = str.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : str;
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeEntities(stripCdata(m[1])) : '';
}


// Some items ship a picture either as a standard RSS <enclosure> (the usual
// way a feed attaches media) or as an <img> inside the HTML description —
// Financial Juice has used both depending on item type, so check either.
function extractEnclosureImage(block) {
  const m = block.match(/<enclosure\b[^>]*\/?>/i);
  if (!m) return null;
  const urlMatch  = m[0].match(/url="([^"]+)"/i);
  const typeMatch = m[0].match(/type="([^"]+)"/i);
  if (!urlMatch) return null;
  if (typeMatch && !/^image\//i.test(typeMatch[1])) return null;
  return urlMatch[1];
}

function extractImageFromHtml(html) {
  if (!html) return null;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

// ── YouTube coverage ─────────────────────────────────────────────────────────
// Financial Juice attaches live pressers / stream coverage as a YouTube link
// on the item — sometimes as an <a href>, sometimes as a bare URL in the
// description text, sometimes as the item's own <link>. Discord only
// auto-unfurls a URL sitting in the *message content*, which would hang a
// second, separate card underneath ours. So instead of leaking the raw URL
// into the message, we pull the video's own thumbnail into this embed and
// keep the whole thing as one card.
const YOUTUBE_URL_RE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^\s"'<>]*&)?v=|live\/|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

function extractYouTube(...sources) {
  for (const src of sources) {
    if (!src) continue;
    const m = String(src).match(YOUTUBE_URL_RE);
    if (m) return { id: m[1], url: `https://youtu.be/${m[1]}` };
  }
  return null;
}

// ── Other outbound links ─────────────────────────────────────────────────────
// Items also link out to the original source (Reuters, Bloomberg, an official
// release, an X post, …). Those get the same treatment as a video: pull the
// page's own share banner (Open Graph) into this embed rather than leaking a
// raw URL into the message content and letting Discord hang a second card.
// Financial Juice's own article URLs are deliberately excluded — every one of
// those would scrape back the same site-wide logo, which is noise, and
// resolveArticleImage() already handles their real per-article pictures.
const ANY_URL_RE   = /https?:\/\/[^\s"'<>)\]]+/gi;
const SELF_HOST_RE = /(^|\.)financialjuice\.com$/i;

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

// A trailing ")" or "." is far more often sentence punctuation than part of
// the URL, so trim those rather than shipping a link that 404s.
function tidyUrl(url) {
  return url.replace(/[.,;:!]+$/, '');
}

function extractExternalLink(...sources) {
  for (const src of sources) {
    if (!src) continue;
    for (const raw of String(src).match(ANY_URL_RE) || []) {
      const url = tidyUrl(raw);
      const host = hostOf(url);
      if (!host || SELF_HOST_RE.test(host)) continue;
      if (YOUTUBE_URL_RE.test(url)) continue; // handled by the video path above
      return { url, host: host.replace(/^www\./i, '') };
    }
  }
  return null;
}

// Once a link is surfaced as a banner + labelled link, the bare URL left
// sitting in the body text is just noise — drop it (plus any trailing
// ?si=… share params) so the description stays clean.
// A line that introduced it ("Watch here:") is left dangling once the URL
// goes, so drop those too — but only when the whole line is a bare label,
// never a real data line like "• **Rates:** unchanged". Same for the lone
// connector left behind when one sentence held two links ("<url> and <url>").
const DANGLING_LABEL_RE     = /^[^\n*•]{0,40}:$/;
const DANGLING_CONNECTOR_RE = /^(?:and|or|via|by|at|from|the|a|&|[-–—+])$/i;

function stripUrls(text) {
  if (!text) return text;
  return text
    .replace(ANY_URL_RE, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !DANGLING_LABEL_RE.test(line) && !DANGLING_CONNECTOR_RE.test(line))
    .join('\n')
    .trim();
}

const MAX_BODY_LEN = 1500; // well under Discord's 4096 embed-description limit

// Financial Juice's descriptions carry the actual detail (bullet lists of
// figures, bolded labels, etc.) as HTML — that's the content missing from
// the plain one-line headline. Converts it to Discord markdown instead of
// dropping it.
function htmlToDiscordText(html) {
  if (!html) return '';
  let text = html
    // Elements whose contents are code, not prose, go with their tags.
    // Stripping tags alone leaves what was between them, and Financial Juice
    // embeds TradingView charts by putting a <script> in the description — so
    // those items posted a line of JavaScript into the channel as the story:
    //   new TradingView.chart({width:"100%",height:"400",chart:"E9L5ybe0"…});
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // An unclosed one would otherwise survive the pass above and leak the
    // rest of the description as source.
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<(strong|b)[^>]*>/gi, '**').replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)[^>]*>/gi, '*').replace(/<\/(em|i)>/gi, '*')
    .replace(/<[^>]+>/g, '');

  text = text
    // Placeholders their own templating did not fill in — {{NewsID}} and the
    // like. Nobody reading a headline wants to see the template.
    .replace(/\{\{\s*\w+\s*\}\}/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  if (text.length > MAX_BODY_LEN) text = `${text.slice(0, MAX_BODY_LEN - 1).trimEnd()}…`;
  return text;
}

// Returns items newest-first, matching the feed's own order.
function parseFeedItems(xml) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const items = [];
  for (const block of blocks) {
    const guid = extractTag(block, 'guid');
    const rawTitle = extractTag(block, 'title');
    if (!guid || !rawTitle) continue;
    const title = rawTitle.replace(/^FinancialJuice:\s*/i, '').trim();
    const link = extractTag(block, 'link');
    const pubDateRaw = extractTag(block, 'pubDate');
    const pubDate = pubDateRaw ? new Date(pubDateRaw) : new Date();
    const description = extractTag(block, 'description');
    const imageUrl = extractEnclosureImage(block) || extractImageFromHtml(description);
    const video = extractYouTube(description, link, rawTitle);
    const source = video ? null : extractExternalLink(description, link);
    const rawBody = htmlToDiscordText(description);
    const body = (video || source) ? stripUrls(rawBody) : rawBody;
    items.push({ guid, title, link, pubDate: isNaN(pubDate) ? new Date() : pubDate, imageUrl, body, video, source });
  }
  return items;
}


// Financial Juice's Cloudflare front-end enforces its own rate limit on this
// endpoint (confirmed: a request too soon after the last one gets a 429 with
// a `retry-after` header). Polling faster than that limit doesn't get
// headlines out any sooner — it just gets the bot locked out, which makes
// delivery slower. So instead of guessing an interval, we poll on
// POLL_INTERVAL_MS and, if the server ever does hand back a 429, honor its
// `retry-after` exactly and go quiet until it lifts rather than hammering it.
let blockedUntil = 0;

async function fetchFeedItems() {
  if (Date.now() < blockedUntil) return null;

  const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)' } });

  if (res.status === 429) {
    const retryAfterSec = parseInt(res.headers.get('retry-after'), 10);
    const waitMs = (Number.isFinite(retryAfterSec) ? retryAfterSec : 60) * 1000 + 2000;
    blockedUntil = Date.now() + waitMs;
    console.warn(`[NEWSFEED] Rate-limited by Financial Juice — pausing polling for ${Math.round(waitMs / 1000)}s`);
    return null;
  }

  if (!res.ok) throw new Error(`Financial Juice feed request failed: ${res.status}`);
  const xml = await res.text();
  return parseFeedItems(xml);
}


// ── Source registry ──────────────────────────────────────────────────────────
// Each source owns its endpoint, its own polling cadence and its own embed
// branding, so adding another later is one entry here rather than surgery on
// the runner. Financial Juice keeps exactly the behaviour it always had.
const SOURCES = {
  financialjuice: {
    key: 'financialjuice',
    label: 'Financial Juice',
    blurb: 'Real-time market-moving headlines, seconds after they break',
    emoji: '⚡',
    pollMs: POLL_INTERVAL_MS,
    fetch: fetchFeedItems,
    // The heading, footer and colour used to live here as a `brand` block.
    // They are entries in the Appearance catalogue now (news.headline /
    // news.breaking) so a server can change them, and `label` is what feeds
    // the {source} token in both.
  },
};

const DEFAULT_SOURCES = ['financialjuice'];

function listSources() {
  return Object.values(SOURCES);
}

// Charts / infographics (FOMC crib sheets, indicator snapshots, etc.) aren't
// linked from the RSS item at all — Financial Juice serves them at a
// predictable per-article URL instead, which 404s for plain text-only items
// and returns the real picture when one exists. Cheap to check (static,
// heavily CDN-cached — not the same rate-limited endpoint as feed.ashx) and
// memoized on the item so multiple guilds sharing one tick only check once.
const ARTICLE_IMAGE_BASE     = 'https://www.financialjuice.com/images/';
const IMAGE_CHECK_TIMEOUT_MS = 4000;

async function resolveArticleImage(item, source = SOURCES.financialjuice) {
  if (item.imageUrl) return item.imageUrl; // already found via RSS enclosure/description <img>
  // The probe below is a Financial-Juice-specific URL convention — running it
  // with another source's guid would just be a guaranteed 404 per headline.
  if (source.key !== 'financialjuice') return null;
  if (item._pictureChecked) return item._resolvedImage;
  item._pictureChecked = true;
  item._resolvedImage = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_CHECK_TIMEOUT_MS);
    const url = `${ARTICLE_IMAGE_BASE}${encodeURIComponent(item.guid)}.png`;
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal }).finally(() => clearTimeout(timeout));
    if (res.ok) item._resolvedImage = url;
  } catch { /* network hiccup or no picture for this article — just skip it */ }

  return item._resolvedImage;
}

// Every other outbound link gets its banner the standard way: the share image
// the page already declares for itself (Open Graph / Twitter card) — the exact
// picture Discord would show if it unfurled the URL itself.
// Only the <head> is needed, so the response is read in chunks and abandoned
// as soon as the meta tags are in hand (or the cap is hit) rather than pulling
// down a whole multi-megabyte page.
const OG_TIMEOUT_MS   = 5000;
const OG_MAX_BYTES    = 192 * 1024;
const OG_CACHE_MAX    = 500;
const ogImageCache = new Map();

const OG_META_RE = /<meta[^>]+(?:property|name)=["'](og:image(?::secure_url|:url)?|twitter:image(?::src)?)["'][^>]*>/gi;
const CONTENT_RE = /content=["']([^"']+)["']/i;

function parseOgImage(html, baseUrl) {
  const found = { og: null, twitter: null };
  for (const tag of html.match(OG_META_RE) || []) {
    const content = tag.match(CONTENT_RE)?.[1];
    if (!content) continue;
    const isTwitter = /twitter:/i.test(tag);
    if (isTwitter) { found.twitter ||= content; } else { found.og ||= content; }
  }
  const raw = found.og || found.twitter;
  if (!raw) return null;
  try {
    // Pages legitimately declare these as protocol-relative or site-root
    // paths, so resolve against the page URL instead of discarding them.
    const abs = new URL(raw.trim(), baseUrl);
    return (abs.protocol === 'http:' || abs.protocol === 'https:') ? abs.href : null;
  } catch {
    return null;
  }
}

async function resolveLinkBanner(pageUrl) {
  if (ogImageCache.has(pageUrl)) return ogImageCache.get(pageUrl);

  let image = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OG_TIMEOUT_MS);
    const res = await fetch(pageUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)', Accept: 'text/html,*/*' },
    }).catch(err => { throw err; });

    try {
      if (res.ok && /text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) {
        let html = '';
        for await (const chunk of res.body) {
          html += Buffer.from(chunk).toString('utf8');
          if (html.length >= OG_MAX_BYTES || /<\/head>/i.test(html)) break;
        }
        image = parseOgImage(html, res.url || pageUrl);
      }
    } finally {
      clearTimeout(timeout);
      controller.abort(); // stop the body download once we have what we need
    }
  } catch { /* unreachable, timed out, or not HTML — just go without a banner */ }

  if (ogImageCache.size >= OG_CACHE_MAX) ogImageCache.clear();
  ogImageCache.set(pageUrl, image);
  return image;
}

// maxresdefault is the size that actually fills an embed's image slot like a
// proper banner, but plenty of videos (live streams especially) only ever get
// the smaller hqdefault. Neither is guaranteed — a pulled or private video
// 404s on both, and handing Discord a dead URL leaves a broken image in the
// card — so each candidate is verified and null means "no usable thumbnail",
// letting the caller fall back. Memoized across guilds/ticks so a headline
// posted to several servers only costs one lookup.
const YT_THUMB_TIMEOUT_MS = 4000;
const YT_THUMB_CACHE_MAX  = 500;
const ytThumbCache = new Map();

async function headOk(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), YT_THUMB_TIMEOUT_MS);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal }).finally(() => clearTimeout(timeout));
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveYouTubeThumb(videoId) {
  if (ytThumbCache.has(videoId)) return ytThumbCache.get(videoId);

  let chosen = null;
  for (const size of ['maxresdefault', 'hqdefault']) {
    const url = `https://i.ytimg.com/vi/${videoId}/${size}.jpg`;
    if (await headOk(url)) { chosen = url; break; }
  }

  if (ytThumbCache.size >= YT_THUMB_CACHE_MAX) ytThumbCache.clear();
  ytThumbCache.set(videoId, chosen);
  return chosen;
}

async function resolvePicture(item, source) {
  return (item.video && await resolveYouTubeThumb(item.video.id))
    || (item.source && await resolveLinkBanner(item.source.url))
    || await resolveArticleImage(item, source);
}

/**
 * The value if it arrives in time, null if it does not.
 *
 * The work is not cancelled — its own caches still fill, so the headline
 * after this one, or the same story going to another guild, gets the picture
 * for free. This only decides how long anyone waits for it.
 */
function withBudget(promise, ms) {
  let timer;
  const capped = new Promise(resolve => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();   // never hold the process open for a banner
  });
  return Promise.race([promise.catch(() => null), capped]).finally(() => clearTimeout(timer));
}

/**
 * One headline, as the guild has styled it.
 *
 * The wording, the colour and the heading all come from the Appearance
 * catalogue now rather than from the source's own `brand` block, so a server
 * can make breaking news shout without this file knowing anything about it.
 * Returns null when that kind of headline is switched off — the caller skips
 * the send rather than posting an empty card.
 */
async function buildNewsEmbed(item, source = SOURCES.financialjuice, guildId = null) {
  const isBreaking = BREAKING_PATTERN.test(item.title);
  const key = isBreaking ? 'news.breaking' : 'news.headline';

  // When the item carries a video or an outbound source, that *is* the story
  // — the headline points straight at it; the Financial Juice article link on
  // those is only ever a stub of the same thing.
  const headlineUrl = item.video?.url || item.source?.url || item.link;

  // An embed image isn't clickable in Discord, so the banner alone gives no
  // way through to the link — this line is what makes it followable. It is a
  // whole composed line rather than separate tokens because a "Read on {via}"
  // written out in the catalogue would still render its link markup on the
  // headlines that have nowhere to point.
  const readmore = item.video ? `▶️ **[Watch on YouTube](${item.video.url})**`
    : item.source ? `🔗 **[Read on ${item.source.host}](${item.source.url})**`
    : '';
  const context = item.video ? 'Live Video'
    : item.source ? `via ${item.source.host}`
    : 'Live Market News';

  // Banner priority: the video's thumbnail, then the linked page's own share
  // image, then whatever picture the article itself carries — so a link that
  // turns out to have no banner never loses the image slot. Capped, because
  // none of it is worth making the headline late; see PICTURE_BUDGET_MS.
  const pictureUrl = await withBudget(resolvePicture(item, source), PICTURE_BUDGET_MS);
  const picture = isValidUrl(pictureUrl) ? pictureUrl : null;

  const embed = messageStyle.build(guildId, key, {
    thumbnailURL: picture,
    tokens: {
      headline: item.title,
      text: item.body && item.body !== item.title ? item.body : '',
      url: headlineUrl || '',
      source: source.label,
      via: item.source?.host || '',
      readmore, context,
    },
  });
  if (!embed) return null;

  // The picture belongs across the card unless the catalogue's thumbnail
  // switch says otherwise — a chart or a video still is the story, not
  // decoration in the corner.
  let attachment = null;
  if (picture && !messageStyle.styleFor(guildId, key).thumbnail) {
    try { embed.setImage(picture); } catch { /* a URL Discord refuses is not worth the card */ }
  } else if (!picture) {
    // Most headlines carry no picture at all — a live feed is mostly plain
    // text — so those get QuantLab's own browser-frame card instead of
    // going out as a bare colour bar. Built fresh per headline (title and
    // breaking-state both vary), unlike the other banners in the bot, which
    // stay the same until Studio changes them.
    try {
      const buf = generateNewsCard({
        headline: item.title,
        source: source.label,
        urlLabel: item.source?.host || 'financialjuice.com',
        breaking: isBreaking,
      });
      attachment = new AttachmentBuilder(buf, { name: 'news-card.png' });
      embed.setImage('attachment://news-card.png');
    } catch { /* the text embed alone still carries the headline */ }
  }
  return { embed, attachment };
}

// Picking topics via /newsfeed topics is the only filter — no picked topics
// means everything posts; picking any means only headlines matching one of
// them do.
function matchesFilter(item, settings) {
  const picked = settings.filterTopics || [];
  // Picking nothing, or picking every topic there is, both mean "everything"
  // — selecting all topics shouldn't behave as a narrower filter than
  // selecting none, since keyword bundles can never cover every possible
  // headline (e.g. a plain stock-price item with no topic keyword in it).
  if (picked.length === 0 || picked.length >= TOPICS.length) return true;
  const words = expandTopicKeywords(picked);
  const haystack = `${item.title} ${item.body || ''}`.toLowerCase();
  return words.some(w => haystack.includes(w));
}

// One fetch per source per tick at most, shared across every guild — and only
// re-fetched once that source's own cadence has elapsed. The registry is kept
// (rather than collapsed back to a single hard-coded feed) so another source
// can be added later as one entry instead of reworking the runner.
const sourceCache = new Map(); // key -> { items, fetchedAt }

/**
 * Slack on the freshness window, so a poll is never skipped outright.
 *
 * The runner ticks on the same interval this cache holds for, which makes the
 * comparison a photo finish the cache used to win. `fetchedAt` was stamped
 * when the request *finished*, so a fetch taking any time at all — 50ms was
 * enough — pushed the stamp past the next tick, that tick found the cache
 * still fresh, and the poll was dropped. The feed was being read every forty
 * seconds instead of twenty, and nothing said so.
 *
 * Stamping the start of the request removes the drift; this margin absorbs
 * the remaining timer jitter, since setInterval is free to fire a hair early.
 */
const POLL_SLACK_MS = 2000;

async function getSourceItems(source) {
  const cached = sourceCache.get(source.key);
  if (cached && Date.now() - cached.fetchedAt < source.pollMs - POLL_SLACK_MS) return cached.items;
  // Taken before the request, not after: the cadence is measured from when we
  // asked, so how long the answer takes cannot move the next poll.
  const startedAt = Date.now();
  try {
    const items = await source.fetch();
    if (items && items.length) {
      sourceCache.set(source.key, { items, fetchedAt: startedAt });
      return items;
    }
    // A null return is the rate-limit/backoff path — keep serving the last
    // good snapshot rather than treating it as "no news".
    return cached?.items ?? null;
  } catch (err) {
    console.error(`[NEWSFEED] ${source.label} fetch failed:`, err.message ?? err);
    return cached?.items ?? null;
  }
}

// Which sources this guild wants. Guilds configured before multi-source
// existed have no `sources` key at all and must keep getting Financial Juice.
function enabledSourceKeys(settings) {
  const picked = Array.isArray(settings.sources) ? settings.sources : DEFAULT_SOURCES;
  return picked.filter(k => SOURCES[k]);
}

// Per-source read cursor, falling back to the single legacy `lastGuid` for
// Financial Juice so upgrading doesn't replay or skip a backlog.
function cursorFor(settings, key) {
  if (settings.lastGuids && settings.lastGuids[key] !== undefined) return settings.lastGuids[key];
  if (key === 'financialjuice') return settings.lastGuid ?? null;
  return null;
}

async function runTick(client) {
  const config = readJson('config.json', {});
  let changed = false;

  for (const guildId of Object.keys(config)) {
    const settings = config[guildId]?.newsFeedSettings;
    if (!settings?.enabled || !settings.channelId) continue;
    // The Settings-tab master switch — off means the scheduler stays quiet
    // here too, not just the /newsfeed command.
    if (!isFeatureEnabled(guildId, 'newsfeed')) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(settings.channelId);
    if (!channel || !channel.isTextBased()) continue;

    for (const key of enabledSourceKeys(settings)) {
      const source = SOURCES[key];
      const items  = await getSourceItems(source);
      if (!items || items.length === 0) continue;

      const cursor = cursorFor(settings, key);
      let toPost;
      if (!cursor) {
        // Just enabled — establish a baseline silently instead of dumping the
        // whole current feed window into the channel.
        toPost = [];
      } else {
        const idx = items.findIndex(it => it.guid === cursor);
        toPost = idx === -1 ? items.slice(0, MAX_POST_PER_TICK) : items.slice(0, idx);
      }
      if (toPost.length > MAX_POST_PER_TICK) toPost = toPost.slice(0, MAX_POST_PER_TICK);

      if (toPost.length > 0) {
        const chronological = [...toPost].reverse().filter(item => matchesFilter(item, settings));
        // Built together, sent in order. Building is all network reads with no
        // side effects, and doing it one headline at a time meant every
        // picture lookup in the batch was paid end to end — the eighth
        // headline in a burst waited for the seven in front of it to finish
        // theirs before its own even started. Now the batch costs what its
        // slowest single item costs.
        const embeds = await Promise.all(
          chronological.map(item => buildNewsEmbed(item, source, guildId).catch(() => null)),
        );
        for (const result of embeds) {
          // Null means this kind of headline is switched off in Appearance.
          // The cursor still advances below, so re-enabling it starts from the
          // headlines after this one rather than replaying the backlog.
          if (!result || !result.embed) continue;
          const payload = { embeds: [result.embed] };
          if (result.attachment) payload.files = [result.attachment];
          await channel.send(payload).catch(() => {});
        }
      }

      if (!settings.lastGuids) settings.lastGuids = {};
      settings.lastGuids[key] = items[0].guid;
      if (key === 'financialjuice') settings.lastGuid = items[0].guid; // keep the legacy field in step
      changed = true;
    }
  }

  if (changed) writeJson('config.json', config);
}

// Safe to call once after the client is ready.
function startNewsFeedRunner(client) {
  // Said out loud, because the cadence is the single biggest thing standing
  // between a headline being published and it being in a channel — and
  // because it silently ran at half this for a long time without anything
  // in the log to show for it.
  console.log(`[NEWSFEED] Polling every ${POLL_INTERVAL_MS / 1000}s (set NEWSFEED_POLL_MS to change)`);
  const tick = () => runTick(client).catch(err => console.error('[NEWSFEED RUNNER ERROR]', err));
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = {
  startNewsFeedRunner, runTick, parseFeedItems, buildNewsEmbed,
  SOURCES, listSources, DEFAULT_SOURCES,
};
