'use strict';

// Polls Financial Juice's public RSS feed (financialjuice.com/feed.ashx) for
// real-time market-moving headlines and relays new ones into each guild's
// configured news channel as they're published. No API key / paid tier
// needed — it's a free, public feed that updates within seconds of a
// headline going out.

const { readJson, writeJson } = require('./jsonStorage');
const { TOPICS, expandTopicKeywords, textMatchesKeywords } = require('./newsTopics');
const { isFeatureEnabled } = require('./featureToggles');
// NOTE: do not top-level require newsCardVisual / embedBuilder / messageStyle —
// they are unused on the Components V2 path. A missing or circular dep there
// used to make this module load as {} and blow up ready.js with
// "startNewsFeedRunner is not a function".

const FEED_URL = 'https://www.financialjuice.com/feed.ashx?xy=rss';
const POLL_INTERVAL_MS = Math.min(300_000, Math.max(10_000, Number(process.env.NEWSFEED_POLL_MS) || 10_000));
const MAX_POST_PER_TICK = 20;
const BREAKING_PATTERN = /\b(breaking|urgent)\b/i;
const DATA_PRINT_PATTERN = /\b(actual|forecast|previous|mom|yoy|y\/y|m\/m|cpi|ppi|nfp|nonfarm|gdp|retail sales|jobless|claims|pmi|ism|fomc|rate decision)\b/i;
function isDataPrintHeadline(item) {
  const title = (item && item.title) ? String(item.title) : '';
  return DATA_PRINT_PATTERN.test(title);
}
const PICTURE_BUDGET_MS = 1200;

function decodeEntities(str) {
  let prev = str;
  for (let i = 0; i < 5; i++) {
    const next = prev
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      .replace(/&amp;/g, '&');
    if (next === prev) break;
    prev = next;
  }
  return prev.trim();
}
function stripCdata(str) {
  const m = str.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : str;
}
function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeEntities(stripCdata(m[1])) : '';
}
function extractEnclosureImage(block) {
  const m = block.match(/<enclosure\b[^>]*\/?>/i);
  if (!m) return null;
  const urlMatch = m[0].match(/\burl=["']([^"']+)["']/i);
  const typeMatch = m[0].match(/\btype=["']([^"']+)["']/i);
  if (typeMatch && !/^image\//i.test(typeMatch[1])) return null;
  return urlMatch ? decodeEntities(urlMatch[1]) : null;
}
function extractImageFromHtml(html) {
  const m = html && html.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  return m ? decodeEntities(m[1]) : null;
}
function extractAllImages(block, description) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    if (!u || typeof u !== 'string') return;
    const url = u.trim().replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  const enc = extractEnclosureImage(block);
  if (enc) push(enc);
  const fromHtml = extractImageFromHtml(description || '');
  if (fromHtml) push(fromHtml);
  const encRe = /<enclosure\b[^>]*\/?>/gi;
  let em;
  while ((em = encRe.exec(block))) {
    const urlMatch = em[0].match(/\burl=["']([^"']+)["']/i);
    const typeMatch = em[0].match(/\btype=["']([^"']+)["']/i);
    if (typeMatch && !/^image\//i.test(typeMatch[1])) continue;
    if (urlMatch) push(decodeEntities(urlMatch[1]));
  }
  return out;
}
function extractVideo(block, description) {
  const text = `${block || ''}\n${description || ''}`;
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/i);
  if (!m) return null;
  return { id: m[1], url: `https://www.youtube.com/watch?v=${m[1]}` };
}
const SELF_HOST_RE = /(^|\.)financialjuice\.com$/i;
function extractSourceLink(block, description, itemLink) {
  const candidates = [];
  const hrefRe = /href=["'](https?:\/\/[^"']+)["']/gi;
  let hm;
  const hay = `${block || ''}\n${description || ''}`;
  while ((hm = hrefRe.exec(hay))) candidates.push(decodeEntities(hm[1]));
  if (itemLink) candidates.push(itemLink);
  for (const u of candidates) {
    try {
      const host = new URL(u).hostname;
      if (!SELF_HOST_RE.test(host)) return { url: u };
    } catch (_) {}
  }
  return null;
}
function parseFeedItems(xml) {
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[0];
    const guid = extractTag(block, 'guid') || extractTag(block, 'link') || extractTag(block, 'title');
    if (!guid) continue;
    const rawTitle = extractTag(block, 'title');
    const title = rawTitle.replace(/^FinancialJuice:\s*/i, '').trim();
    const link = extractTag(block, 'link');
    const pubRaw = extractTag(block, 'pubDate');
    const pubDate = pubRaw ? new Date(pubRaw) : new Date();
    const description = extractTag(block, 'description');
    const body = description
      ? description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    const images = extractAllImages(block, description);
    const imageUrl = images[0] || null;
    const video = extractVideo(block, description);
    const source = extractSourceLink(block, description, link);
    items.push({ guid, title, link, pubDate: isNaN(pubDate) ? new Date() : pubDate, imageUrl, images, body, video, source, truthSocial: false });
  }
  return items;
}

let blockedUntil = 0;
async function fetchFeedItems() {
  if (Date.now() < blockedUntil) return null;
  const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)' } });
  if (res.status === 429) {
    const retryAfterSec = parseInt(res.headers.get('retry-after'), 10);
    const waitMs = Number.isFinite(retryAfterSec)
      ? Math.min(45_000, Math.max(12_000, retryAfterSec * 1000))
      : 15_000;
    blockedUntil = Date.now() + waitMs;
    console.warn(`[NEWSFEED] Rate-limited by Financial Juice — pausing ${Math.round(waitMs / 1000)}s`);
    return null;
  }
  blockedUntil = 0;
  if (!res.ok) throw new Error(`Financial Juice feed request failed: ${res.status}`);
  const xml = await res.text();
  return parseFeedItems(xml);
}

const SOURCES = {
  financialjuice: {
    key: 'financialjuice',
    label: 'Financial Juice',
    blurb: 'Real-time market-moving headlines, seconds after they break',
    emoji: '⚡',
    pollMs: POLL_INTERVAL_MS,
    fetch: fetchFeedItems,
  },
};
const DEFAULT_SOURCES = ['financialjuice'];
function listSources() {
  return Object.values(SOURCES);
}

const ARTICLE_IMAGE_BASE = 'https://www.financialjuice.com/images/';
const IMAGE_CHECK_TIMEOUT_MS = 4000;
const articleImageCache = new Map();
const ARTICLE_IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const ARTICLE_IMAGE_CACHE_MAX = 500;

async function resolveArticleImage(item, source = SOURCES.financialjuice) {
  if (item.imageUrl) return item.imageUrl;
  if (source.key !== 'financialjuice') return null;
  if (!item.guid) return null;
  const cached = articleImageCache.get(item.guid);
  if (cached && (Date.now() - cached.at) < ARTICLE_IMAGE_CACHE_TTL_MS) {
    item._pictureChecked = true;
    item._resolvedImage = cached.url;
    return cached.url;
  }
  if (item._pictureChecked) return item._resolvedImage;
  item._pictureChecked = true;
  item._resolvedImage = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_CHECK_TIMEOUT_MS);
    const url = `${ARTICLE_IMAGE_BASE}${encodeURIComponent(item.guid)}.png`;
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)' },
    }).finally(() => clearTimeout(timeout));
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && (!ct || ct.startsWith('image/'))) {
      item._resolvedImage = url;
    }
  } catch { /* skip */ }
  if (articleImageCache.size >= ARTICLE_IMAGE_CACHE_MAX) articleImageCache.clear();
  articleImageCache.set(item.guid, { url: item._resolvedImage, at: Date.now() });
  return item._resolvedImage;
}

const ogImageCache = new Map();
const OG_CACHE_MAX = 500;
const OG_MAX_BYTES =  Troubled truncation here intentionally not - see artifacts
