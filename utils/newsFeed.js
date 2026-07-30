'use strict';

// Polls Financial Juice's public RSS feed (financialjuice.com/feed.ashx) for
// real-time market-moving headlines and relays new ones into each guild's
// configured news channel as they're published. No API key / paid tier
// needed — it's a free, public feed that updates within seconds of a
// headline going out.

const { readJson, writeJson } = require('./jsonStorage');
const { createEmbed, isValidUrl } = require('./embedBuilder');
const { TOPICS, expandTopicKeywords } = require('./newsTopics');

const FEED_URL          = 'https://www.financialjuice.com/feed.ashx';
const POLL_INTERVAL_MS  = 20_000;
const MAX_POST_PER_TICK = 8; // safety cap so a feed gap never dumps a huge backlog at once
const BREAKING_PATTERN  = /\b(breaking|urgent)\b/i;

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
      .replace(/&amp;/g, '&');
    if (next === prev) break;
    prev = next;
  }
  return prev.trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeEntities(m[1]) : '';
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

// Once the video is surfaced as a thumbnail + "Watch on YouTube" link, the
// bare URL left sitting in the body text is just noise — drop it (plus any
// trailing ?si=… share params) so the description stays clean.
// A line that introduced the link ("Watch here:") is left dangling once the
// URL goes, so drop those too — but only when the whole line is a bare
// label, never a real data line like "• **Rates:** unchanged".
const DANGLING_LABEL_RE = /^[^\n*•]{0,40}:$/;

function stripYouTubeUrls(text) {
  if (!text) return text;
  const global = new RegExp(`${YOUTUBE_URL_RE.source}[^\\s"'<>]*`, 'gi');
  return text
    .replace(global, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !DANGLING_LABEL_RE.test(line))
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
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<(strong|b)[^>]*>/gi, '**').replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)[^>]*>/gi, '*').replace(/<\/(em|i)>/gi, '*')
    .replace(/<[^>]+>/g, '');

  text = text
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
    const body = video ? stripYouTubeUrls(htmlToDiscordText(description)) : htmlToDiscordText(description);
    items.push({ guid, title, link, pubDate: isNaN(pubDate) ? new Date() : pubDate, imageUrl, body, video });
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

// Charts / infographics (FOMC crib sheets, indicator snapshots, etc.) aren't
// linked from the RSS item at all — Financial Juice serves them at a
// predictable per-article URL instead, which 404s for plain text-only items
// and returns the real picture when one exists. Cheap to check (static,
// heavily CDN-cached — not the same rate-limited endpoint as feed.ashx) and
// memoized on the item so multiple guilds sharing one tick only check once.
const ARTICLE_IMAGE_BASE     = 'https://www.financialjuice.com/images/';
const IMAGE_CHECK_TIMEOUT_MS = 4000;

async function resolveArticleImage(item) {
  if (item.imageUrl) return item.imageUrl; // already found via RSS enclosure/description <img>
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

async function buildNewsEmbed(item) {
  const isBreaking = BREAKING_PATTERN.test(item.title);

  // For a video item the stream *is* the story, so the headline points
  // straight at it; the article link on those is only ever a stub of the
  // same thing.
  const headlineUrl = item.video?.url || item.link;
  let description = headlineUrl ? `[**${item.title}**](${headlineUrl})` : `**${item.title}**`;
  if (item.body && item.body !== item.title) description += `\n\n${item.body}`;
  // An embed image isn't clickable in Discord, so the thumbnail alone gives
  // no way into the video — this line is what makes it playable.
  if (item.video) description += `\n\n▶️ **[Watch on YouTube](${item.video.url})**`;

  // A video with no usable thumbnail still falls back to whatever picture the
  // article itself carries, rather than silently losing the image slot.
  const pictureUrl = (item.video && await resolveYouTubeThumb(item.video.id))
    || await resolveArticleImage(item);

  const embed = createEmbed(isBreaking ? 'breaking' : 'news', {
    title: isBreaking ? '🔴 BREAKING — Financial Juice' : '📰 Financial Juice',
    description,
    footer: item.video ? 'Financial Juice • Live Video' : 'Financial Juice • Live Market News',
    image: isValidUrl(pictureUrl) ? pictureUrl : undefined,
  });
  embed.setTimestamp(null); // headline age is already obvious from post order — no timestamp on these
  return embed;
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

async function runTick(client) {
  const items = await fetchFeedItems();
  if (!items || items.length === 0) return;

  const config = readJson('config.json', {});
  let changed = false;

  for (const guildId of Object.keys(config)) {
    const settings = config[guildId]?.newsFeedSettings;
    if (!settings?.enabled || !settings.channelId) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(settings.channelId);
    if (!channel || !channel.isTextBased()) continue;

    let toPost;
    if (!settings.lastGuid) {
      // Just enabled — establish a baseline silently instead of dumping the
      // whole current feed window into the channel.
      toPost = [];
    } else {
      const idx = items.findIndex(it => it.guid === settings.lastGuid);
      toPost = idx === -1 ? items.slice(0, MAX_POST_PER_TICK) : items.slice(0, idx);
    }

    if (toPost.length > MAX_POST_PER_TICK) toPost = toPost.slice(0, MAX_POST_PER_TICK);

    if (toPost.length > 0) {
      const chronological = [...toPost].reverse().filter(item => matchesFilter(item, settings));
      for (const item of chronological) {
        const embed = await buildNewsEmbed(item);
        await channel.send({ embeds: [embed] }).catch(() => {});
      }
    }

    settings.lastGuid = items[0].guid;
    changed = true;
  }

  if (changed) writeJson('config.json', config);
}

// Safe to call once after the client is ready.
function startNewsFeedRunner(client) {
  const tick = () => runTick(client).catch(err => console.error('[NEWSFEED RUNNER ERROR]', err));
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { startNewsFeedRunner, parseFeedItems, buildNewsEmbed };
