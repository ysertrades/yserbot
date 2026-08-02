'use strict';

/**
 * dynamicEmbedImages.js
 *
 * Embed templates (utils/jsonStorage → embeds.json) normally store a plain
 * image URL. A template can instead store `dynamic:<key>` in its image
 * field to mean "regenerate this pixel-art image fresh every time the
 * template is sent/previewed" — the same AttachmentBuilder + attachment://
 * trick /fish, /mine, etc. already use, just wired into the reusable
 * template system so a template stays live (edit/delete/re-send whenever)
 * without needing a permanently-hosted image URL this environment has no
 * way to produce.
 */

const { AttachmentBuilder } = require('discord.js');
const { generateEconomyShowcaseImage } = require('./economyShowcaseVisual');
const { generateReportGuideImage } = require('./reportGuideVisual');
const { generateNyseOpenImage, generateFuturesOpenImage } = require('./marketSessionVisual');
const { generateRiskGuideImage } = require('./riskGuideVisual');
const { generateNewsfeedGuideImage } = require('./newsfeedGuideVisual');
const { generateTradingViewBannerImage } = require('./tradingViewVisual');
const { generateWhopBannerImage } = require('./whopVisual');
const { generatePrizeGiveawayBannerImage } = require('./prizeGiveawayVisual');
const { memoizeRender } = require('./renderCache');
const { copyForDynamicKey } = require('./bannerCopy');

// Most of these take no arguments, so each call was redrawing a byte-identical
// image — 875 ms of blocked event loop across the seven, every time one was
// sent or previewed. They're memoised, and warm() renders them once at boot so
// no interaction ever pays for the first one either.
//
// The banners are the exception: `takesCopy` marks them as accepting the
// per-guild wording edited in Studio, so they get a slightly larger cache to
// hold a few guilds' variants side by side.
const DYNAMIC_IMAGES = {
  economyShowcase: { filename: 'economy_showcase.png', generate: memoizeRender(generateEconomyShowcaseImage, { name: 'economyShowcase', max: 1 }) },
  reportGuide:      { filename: 'report_guide.png',     generate: memoizeRender(generateReportGuideImage,     { name: 'reportGuide',      max: 1 }) },
  nyseOpen:         { filename: 'nyse_open.png',        generate: memoizeRender(generateNyseOpenImage,        { name: 'nyseOpen',         max: 1 }) },
  futuresOpen:      { filename: 'futures_open.png',      generate: memoizeRender(generateFuturesOpenImage,     { name: 'futuresOpen',      max: 1 }) },
  riskGuide:        { filename: 'risk_guide.png',       generate: memoizeRender(generateRiskGuideImage,       { name: 'riskGuide',        max: 1 }) },
  newsfeedGuide:    { filename: 'newsfeed_guide.png',   generate: memoizeRender(generateNewsfeedGuideImage,   { name: 'newsfeedGuide',    max: 1 }) },
  tradingViewBanner: { filename: 'tradingview_banner.png', takesCopy: true, generate: memoizeRender(generateTradingViewBannerImage, { name: 'tradingViewBanner', max: 8 }) },
  whopBanner:        { filename: 'whop_banner.png',        takesCopy: true, generate: memoizeRender(generateWhopBannerImage,        { name: 'whopBanner',        max: 8 }) },
  prizeGiveawayBanner: { filename: 'prize_giveaway_banner.png', takesCopy: true, generate: memoizeRender(generatePrizeGiveawayBannerImage, { name: 'prizeGiveawayBanner', max: 8 }) },
};

/**
 * Renders one dynamic image, applying the guild's saved banner wording when
 * the generator accepts it.
 *
 * The argument list has to stay byte-identical between warm() and the send
 * path or the warm render is a cache miss and the first send pays for it
 * anyway — hence the single helper rather than each caller deciding.
 */
function renderDynamic(key, entry, guildId) {
  if (!entry.takesCopy) return entry.generate();
  return entry.generate(copyForDynamicKey(guildId, key));
}

/**
 * Renders every template image once, yielding to the event loop between each
 * so a slow boot never looks like a hang. Called from index.js before login.
 */
async function warm() {
  const started = Date.now();
  for (const [key, entry] of Object.entries(DYNAMIC_IMAGES)) {
    try {
      // No guild at boot, so the banners warm their default wording. A guild
      // that has customised one pays a single render on first send and is
      // cached from then on.
      renderDynamic(key, entry, null);
    } catch (err) {
      // A broken generator must not stop the bot from starting — it just
      // means that one template pays for its render on first use, as before.
      console.error(`[RenderCache] failed to warm "${key}":`, err.message);
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  console.log(`[RenderCache] warmed ${Object.keys(DYNAMIC_IMAGES).length} template images in ${Date.now() - started}ms`);
}

const DYNAMIC_PREFIX = 'dynamic:';

function isDynamicImage(value) {
  return typeof value === 'string' && value.startsWith(DYNAMIC_PREFIX);
}

function dynamicImageKey(value) {
  return value.slice(DYNAMIC_PREFIX.length);
}

function dynamicAttachmentRef(value) {
  const key = dynamicImageKey(value);
  // hasOwn: `dynamic:__proto__` would otherwise find Object.prototype, read as
  // a real entry, and produce `attachment://undefined` — an embed pointing at
  // a file that does not exist.
  if (!Object.hasOwn(DYNAMIC_IMAGES, key)) return null;
  return `attachment://${DYNAMIC_IMAGES[key].filename}`;
}

// One AttachmentBuilder per distinct dynamic image referenced anywhere in
// the template (usually just one), so a multi-embed template referencing
// the same dynamic image twice doesn't generate/attach it twice.
//
// `guildId` is optional so any caller that has no guild in scope keeps the
// previous behaviour — the default wording — rather than breaking. Every path
// that sends a template into a guild passes it, which is what makes a Studio
// edit show up in the embed.
function collectDynamicAttachments(template, guildId = null) {
  const seen = new Set();
  const files = [];
  for (const e of template.embeds) {
    if (!isDynamicImage(e.image)) continue;
    const key = dynamicImageKey(e.image);
    if (!Object.hasOwn(DYNAMIC_IMAGES, key) || seen.has(key)) continue;
    const entry = DYNAMIC_IMAGES[key];
    seen.add(key);
    files.push(new AttachmentBuilder(renderDynamic(key, entry, guildId), { name: entry.filename }));
  }
  return files;
}

module.exports = { DYNAMIC_IMAGES, isDynamicImage, dynamicImageKey, dynamicAttachmentRef, collectDynamicAttachments, warm };
