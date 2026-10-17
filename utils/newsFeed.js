'use strict';

const { readJson, writeJson } = require('./jsonStorage');
const { TOPICS, expandTopicKeywords, textMatchesKeywords } = require('./newsTopics');
const { isFeatureEnabled } = require('./featureToggles');

const FEED_URL = 'https://www.financialjuice.com/feed.ashx?xy=rss';
// Where polling starts. The runner then adapts between MIN and MAX below.
const POLL_INTERVAL_MS = Math.min(300_000, Math.max(5_000, Number(process.env.NEWSFEED_POLL_MS) || 10_000));
// The fastest the runner will ever ask. Financial Juice sits behind Cloudflare,
// which answers 429 when an IP asks too often; asking faster than it allows
// only gets every request refused (see pace below).
const MIN_POLL_MS = Math.min(POLL_INTERVAL_MS, Math.max(3_000, Number(process.env.NEWSFEED_MIN_POLL_MS) || 5_000));
const MAX_POLL_MS = 90_000;
const MAX_POST_PER_TICK = 20;
const BREAKING_PATTERN = /\b(breaking|urgent)\b/i;
const DATA_PRINT_PATTERN = /\b(actual|forecast|previous|mom|yoy|y\/y|m\/m|cpi|ppi|nfp|nonfarm|gdp|retail sales|jobless|claims|pmi|ism|fomc|rate decision)\b/i;
const PICTURE_BUDGET_MS = 1200;

function isDataPrintHeadline(item) {
  const title = (item && item.title) ? String(item.title) : '';
  return DATA_PRINT_PATTERN.test(title);
}

// The entity names are built from char codes on purpose. This function was
// once run through something that decoded entities in the source itself, so
// every pattern became a no-op like /</g -> '<' and headlines showed
// "S&amp;P". Spelled this way the source cannot be "fixed" like that again.
const AMP = String.fromCharCode(38);
const ENTITY = (name) => new RegExp(AMP + name + ';', 'gi');
const RE_LT = ENTITY('lt'), RE_GT = ENTITY('gt'), RE_QUOT = ENTITY('quot');
const RE_APOS = ENTITY('apos'), RE_NBSP = ENTITY('nbsp'), RE_AMP = ENTITY('amp');

function decodeEntities(str) {
  let prev = String(str == null ? '' : str);
  for (let i = 0; i < 5; i++) {
    const next = prev
      .replace(RE_LT, '<').replace(RE_GT, '>').replace(RE_QUOT, '"')
      .replace(RE_APOS, "'").replace(RE_NBSP, ' ')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
      // Last, so "&amp;lt;" becomes "&lt;" this pass and "<" the next.
      .replace(RE_AMP, AMP);
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
    // "&amp;" left in a query string breaks the image link.
    const url = u.trim().replace(RE_AMP, AMP);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  const enc = extractEnclosureImage(block);
  if (enc) push(enc);
  const fromHtml = extractImageFromHtml(description || '');
  if (fromHtml) push(fromHtml);
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
    const body = description ? description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const images = extractAllImages(block, description);
    const imageUrl = images[0] || null;
    const video = extractVideo(block, description);
    const source = extractSourceLink(block, description, link);
    items.push({ guid, title, link, pubDate: isNaN(pubDate) ? new Date() : pubDate, imageUrl, images, body, video, source, truthSocial: false });
  }
  return items;
}

/**
 * Polling pace, adjusted to what Cloudflare in front of Financial Juice
 * actually allows from this IP.
 *
 * It used to poll every 10s no matter what, and on a 429 wait at most 45s —
 * less than the Retry-After it was often given. So it came back early, was
 * refused again (which extends the block), and nearly every request failed:
 * headlines got through only now and then, about a minute late.
 *
 * Now: a refusal waits the full Retry-After (never less) and slows the pace;
 * a run of successful fetches speeds it back up. That settles just under the
 * real limit, which is the fastest headlines can actually arrive.
 */
const SPEED_UP_AFTER = 6;      // successful fetches in a row before asking faster
const SPEED_UP_STEP_MS = 1_000;
const pace = { interval: POLL_INTERVAL_MS, okStreak: 0 };
const stats = { since: Date.now(), ok: 0, blocked: 0, errors: 0, posted: 0, lags: [] };

let blockedUntil = 0;
function noteBlocked(retryAfterSec) {
  const asked = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 0;
  // The full Retry-After plus a little jitter, so we are never early.
  const waitMs = Math.min(300_000, Math.max(asked, pace.interval * 2) + Math.floor(Math.random() * 1500));
  blockedUntil = Date.now() + waitMs;
  pace.interval = Math.min(MAX_POLL_MS, Math.round(pace.interval * 1.5));
  pace.okStreak = 0;
  stats.blocked++;
  if (waitMs >= 60_000) console.warn(`[NEWSFEED] Financial Juice asked us to wait ${Math.round(waitMs / 1000)}s`);
}
function noteOk() {
  stats.ok++;
  pace.okStreak++;
  if (pace.okStreak >= SPEED_UP_AFTER) {
    pace.interval = Math.max(MIN_POLL_MS, pace.interval - SPEED_UP_STEP_MS);
    pace.okStreak = 0;
  }
}

async function fetchFeedItems() {
  if (Date.now() < blockedUntil) return null;
  const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)' } });
  // 429 is the rate limit; 403/503 are Cloudflare refusing or challenging.
  // All three mean "back off", not "try again in a few seconds".
  if (res.status === 429 || res.status === 403 || res.status === 503) {
    noteBlocked(parseInt(res.headers.get('retry-after'), 10));
    res.body?.cancel?.().catch(() => {});
    return null;
  }
  blockedUntil = 0;
  if (!res.ok) { stats.errors++; throw new Error(`Financial Juice feed request failed: ${res.status}`); }
  const items = parseFeedItems(await res.text());
  noteOk();
  return items;
}

/** One line every few minutes instead of one per refused request. */
function logPaceSummary() {
  const mins = Math.max(1, Math.round((Date.now() - stats.since) / 60_000));
  const lags = stats.lags.slice().sort((a, b) => a - b);
  const median = lags.length ? lags[Math.floor(lags.length / 2)] : null;
  const max = lags.length ? lags[lags.length - 1] : null;
  console.log(`[NEWSFEED] last ${mins}m: ${stats.ok} fetched, ${stats.blocked} rate-limited, ${stats.errors} errors · pace ${Math.round(pace.interval / 1000)}s`
    + (stats.posted ? ` · ${stats.posted} posted, lag median ${median}s / max ${max}s` : ' · nothing new posted'));
  stats.since = Date.now(); stats.ok = 0; stats.blocked = 0; stats.errors = 0; stats.posted = 0; stats.lags = [];
}

const SOURCES = {
  financialjuice: {
    key: 'financialjuice',
    label: 'Financial Juice',
    blurb: 'Real-time market-moving headlines',
    emoji: '⚡',
    // The cache in getSourceItems only shares one fetch between the guilds of
    // a single tick; it must never stretch the adaptive pace, so it uses the
    // floor rather than the starting interval.
    pollMs: MIN_POLL_MS,
    fetch: fetchFeedItems,
  },
};
const DEFAULT_SOURCES = ['financialjuice'];
function listSources() { return Object.values(SOURCES); }

const ARTICLE_IMAGE_BASE = 'https://www.financialjuice.com/images/';
const IMAGE_CHECK_TIMEOUT_MS = 4000;
const articleImageCache = new Map();
const ARTICLE_IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const ARTICLE_IMAGE_CACHE_MAX = 500;

async function resolveArticleImage(item, source = SOURCES.financialjuice) {
  if (item.imageUrl) return item.imageUrl;
  if (source.key !== 'financialjuice' || !item.guid) return null;
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
      method: 'HEAD', signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)' },
    }).finally(() => clearTimeout(timeout));
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && (!ct || ct.startsWith('image/'))) item._resolvedImage = url;
  } catch { /* skip */ }
  if (articleImageCache.size >= ARTICLE_IMAGE_CACHE_MAX) articleImageCache.clear();
  articleImageCache.set(item.guid, { url: item._resolvedImage, at: Date.now() });
  return item._resolvedImage;
}

const ogImageCache = new Map();
const OG_CACHE_MAX = 500;
const OG_MAX_BYTES = 65536;
const OG_TIMEOUT_MS = 5000;
const OG_META_RE = /<meta[^>]+(?:property|name)=["'](og:image(?::secure_url|:url)?|twitter:image(?::src)?)["'][^>]*>/gi;

function parseOgImage(html, baseUrl) {
  OG_META_RE.lastIndex = 0;
  let m;
  while ((m = OG_META_RE.exec(html))) {
    const tag = m[0];
    const content = tag.match(/\bcontent=["']([^"']+)["']/i);
    if (!content) continue;
    try {
      return new URL(content[1].trim(), baseUrl).href;
    } catch (_) {}
  }
  return null;
}

async function resolveLinkBanner(pageUrl) {
  if (!pageUrl || !/^https:\/\//i.test(pageUrl)) return null;
  if (ogImageCache.has(pageUrl)) return ogImageCache.get(pageUrl);
  let image = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OG_TIMEOUT_MS);
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)', Accept: 'text/html' },
      redirect: 'follow',
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
      controller.abort();
    }
  } catch { /* no banner */ }
  if (ogImageCache.size >= OG_CACHE_MAX) ogImageCache.clear();
  ogImageCache.set(pageUrl, image);
  return image;
}

const YT_THUMB_TIMEOUT_MS = 4000;
const YT_THUMB_CACHE_MAX = 500;
const ytThumbCache = new Map();
async function headOk(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), YT_THUMB_TIMEOUT_MS);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal }).finally(() => clearTimeout(timeout));
    return res.ok;
  } catch { return false; }
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
  const fjImg = await resolveArticleImage(item, source || SOURCES.financialjuice);
  if (fjImg) return fjImg;
  return (item.video && await resolveYouTubeThumb(item.video.id))
    || (item.source && await resolveLinkBanner(item.source.url))
    || null;
}

function withBudget(promise, ms) {
  let timer;
  const capped = new Promise(resolve => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  return Promise.race([promise.catch(() => null), capped]).finally(() => clearTimeout(timer));
}

function isTruthSocialItem(item) {
  return !!(item && (item.truthSocial || /truth\s*social/i.test(item.title || '') || /truthsocial\.com/i.test(item.link || '')));
}

async function buildNewsEmbed(item, source = SOURCES.financialjuice, guildId = null) {
  const v2 = await buildNewsV2(item, source, guildId);
  if (!v2) return null;
  return { embed: null, v2, attachment: null };
}

async function buildNewsV2(item, source = SOURCES.financialjuice, guildId = null) {
  const { IS_COMPONENTS_V2, text, separator, button, row, container } = require('./componentsV2');
  const isBreaking = BREAKING_PATTERN.test(item.title || '');
  const isTruth = item.truthSocial || isTruthSocialItem(item);
  const fjLink = (item.link && /^https:\/\//i.test(item.link)) ? item.link : null;
  const headlineUrl = item.video?.url || fjLink || item.source?.url || null;

  const imageList = [];
  const seen = new Set();
  const pushImg = (u) => {
    if (!u || typeof u !== 'string') return;
    const url = u.trim().replace(RE_AMP, AMP);
    if (!/^https:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    imageList.push(url);
  };
  for (const u of [...(item.images || []), item.imageUrl].filter(Boolean)) pushImg(u);
  if (!imageList.length) {
    try {
      const resolved = await withBudget(resolvePicture(item, source), Math.min(PICTURE_BUDGET_MS, 1200));
      pushImg(resolved);
    } catch (_) {}
  }
  const galleryUrls = imageList.slice(0, 1);

  let accent = 0x5865F2;
  if (isBreaking) accent = 0xED4245;
  if (isTruth) accent = 0xF0B232;

  const kids = [];
  let badge;
  if (isBreaking) badge = '🔴 **BREAKING**';
  else if (isTruth) badge = '🟡 **TRUTH SOCIAL**';
  else badge = '⚡ **LIVE**';
  kids.push(text(`${badge} · ${source.label || 'Financial Juice'}`));
  kids.push(separator({ divider: true, spacing: 1 }));
  kids.push(text(isTruth ? `### ${item.title}` : `## ${item.title}`));
  if (item.body && item.body !== item.title) {
    const body = String(item.body).slice(0, 1800).trim();
    if (body) kids.push(text(body));
  }
  if (galleryUrls.length) {
    kids.push({ type: 12, items: galleryUrls.map((url) => ({ media: { url } })) });
  }
  kids.push(separator({ divider: true, spacing: 1 }));
  const buttons = [];
  if (headlineUrl && /^https:\/\//i.test(headlineUrl)) {
    buttons.push(button({ label: 'Financial Juice', style: 5, url: fjLink || headlineUrl }));
  }
  if (item.link && item.link !== headlineUrl && /^https:\/\//i.test(item.link)) {
    buttons.push(button({ label: 'Financial Juice', style: 5, url: item.link }));
  }
  if (buttons.length) kids.push(row(...buttons.slice(0, 5)));
  const when = item.pubDate ? new Date(item.pubDate) : new Date();
  const ts = when.toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
  kids.push(text(`-# ${ts} ET · via Financial Juice${isTruth ? ' · Trump / Truth Social' : ''}`));
  return { flags: IS_COMPONENTS_V2, components: [container(kids, accent)] };
}

const sourceCache = new Map();
const POLL_SLACK_MS = 1500;

async function getSourceItems(source) {
  const cached = sourceCache.get(source.key);
  if (cached && Date.now() - cached.fetchedAt < source.pollMs - POLL_SLACK_MS) return cached.items;
  const startedAt = Date.now();
  try {
    const items = await source.fetch();
    if (items) sourceCache.set(source.key, { items, fetchedAt: startedAt });
    return items;
  } catch (err) {
    console.error(`[NEWSFEED] ${source.key} fetch failed:`, err.message);
    return cached ? cached.items : null;
  }
}

function cursorFor(settings, key) {
  if (settings.lastGuids && settings.lastGuids[key]) return settings.lastGuids[key];
  if (key === 'financialjuice' && settings.lastGuid) return settings.lastGuid;
  return null;
}

function topicAllows(item, settings) {
  // Stored as filterTopics (web/writes.js, modConfig defaults); `topics` is
  // only the name the panel's read uses, so the filter never applied.
  const picked = Array.isArray(settings.filterTopics) ? settings.filterTopics
    : Array.isArray(settings.topics) ? settings.topics : [];
  if (picked.length === 0 || picked.length >= TOPICS.length) return true;
  const words = expandTopicKeywords(picked);
  return textMatchesKeywords(item.title, item.body, words);
}

function sourcesFor(settings) {
  const picked = Array.isArray(settings.sources) ? settings.sources : DEFAULT_SOURCES;
  return picked.filter(k => SOURCES[k]);
}

async function runTick(client) {
  const config = readJson('config.json', {});
  let changed = false;
  for (const guildId of Object.keys(config)) {
    // This server's brand for everything drawn below (utils/brand.js).
    require('./brand').enter(guildId);
    if (!isFeatureEnabled(guildId, 'newsfeed')) continue;
    const settings = config[guildId]?.newsFeedSettings;
    if (!settings || !settings.channelId) continue;
    // The panel's "Post live headlines" switch. It was never read, so a feed
    // turned off kept posting as long as a channel was set. A guild that
    // predates the switch (no key at all) stays on — see getNewsFeedSettings.
    if (settings.enabled === false) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(settings.channelId);
    if (!channel || !channel.isTextBased?.()) continue;

    for (const key of sourcesFor(settings)) {
      const source = SOURCES[key];
      const items = await getSourceItems(source);
      if (!items || items.length === 0) continue;

      const cursor = cursorFor(settings, key);
      let newer;
      if (!cursor) {
        newer = [];
      } else {
        const idx = items.findIndex(it => it.guid === cursor);
        newer = idx < 0 ? items.slice(0, 5) : items.slice(0, idx);
      }

      const matched = newer.filter(it => topicAllows(it, settings));
      const chronological = matched.slice().reverse();
      if (chronological.length === 0) {
        if (!cursor && items[0]) {
          if (!settings.lastGuids) settings.lastGuids = {};
          settings.lastGuids[key] = items[0].guid;
          if (key === 'financialjuice') settings.lastGuid = items[0].guid;
          changed = true;
        }
        continue;
      }

      const batch = chronological.slice(0, MAX_POST_PER_TICK);
      const cards = await Promise.all(
        batch.map(async (item) => {
          try {
            return await buildNewsV2(item, source, guildId);
          } catch (err) {
            console.warn('[NEWSFEED] build failed:', err.message);
            return null;
          }
        }),
      );
      for (let i = 0; i < cards.length; i++) {
        const payload = cards[i];
        if (!payload || !payload.components) continue;
        const sent = await channel.send({
          flags: payload.flags,
          components: payload.components,
        }).catch((err) => { console.warn('[NEWSFEED] send failed:', err.message); return null; });
        // How late it landed, from Financial Juice's own timestamp — what the
        // pace summary reports, so speed can be checked rather than guessed.
        const pub = batch[i]?.pubDate ? new Date(batch[i].pubDate).getTime() : NaN;
        if (sent && Number.isFinite(pub)) {
          stats.posted++;
          if (stats.lags.length < 500) stats.lags.push(Math.max(0, Math.round((Date.now() - pub) / 1000)));
        }
      }

      if (!settings.lastGuids) settings.lastGuids = {};
      if (chronological.length > batch.length && batch.length > 0) {
        const lastPosted = batch[batch.length - 1];
        settings.lastGuids[key] = lastPosted.guid;
        if (key === 'financialjuice') settings.lastGuid = lastPosted.guid;
      } else {
        settings.lastGuids[key] = items[0].guid;
        if (key === 'financialjuice') settings.lastGuid = items[0].guid;
      }
      changed = true;
    }
  }
  if (changed) writeJson('config.json', config);
}

const SUMMARY_EVERY_MS = 5 * 60_000;

function startNewsFeedRunner(client) {
  console.log(`[NEWSFEED] Adaptive polling from ${POLL_INTERVAL_MS / 1000}s (fastest ${MIN_POLL_MS / 1000}s, slowest ${MAX_POLL_MS / 1000}s) — summary every ${SUMMARY_EVERY_MS / 60_000}m`);
  let timer = null;
  let running = false;
  const schedule = (ms) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, Math.max(500, ms));
  };
  const summary = setInterval(logPaceSummary, SUMMARY_EVERY_MS);
  summary.unref?.();
  const tick = async () => {
    if (running) {
      schedule(pace.interval);
      return;
    }
    running = true;
    const t0 = Date.now();
    try {
      await runTick(client);
    } catch (err) {
      console.error('[NEWSFEED RUNNER ERROR]', err);
    } finally {
      running = false;
      const elapsed = Date.now() - t0;
      // ±10% jitter so the requests do not fall into a fixed rhythm that
      // lines up with a rate-limit window edge every time.
      const jitter = Math.round(pace.interval * (Math.random() * 0.2 - 0.1));
      const wait = Math.max(500, pace.interval + jitter - elapsed);
      const blockedLeft = blockedUntil - Date.now();
      schedule(blockedLeft > 0 ? blockedLeft : wait);
    }
  };
  tick();
}

module.exports = {
  startNewsFeedRunner, runTick, parseFeedItems, buildNewsEmbed, buildNewsV2,
  SOURCES, listSources, DEFAULT_SOURCES,
};
