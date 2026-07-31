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
const { generateNyseOpenImage } = require('./marketSessionVisual');
const { generateRiskGuideImage } = require('./riskGuideVisual');
const { generateNewsfeedGuideImage } = require('./newsfeedGuideVisual');
const { generateTradingViewBannerImage } = require('./tradingViewVisual');
const { generateWhopBannerImage } = require('./whopVisual');
const { memoizeRender } = require('./renderCache');

// Every one of these takes no arguments, so each call was redrawing a
// byte-identical image — 875 ms of blocked event loop across the seven, every
// time one was sent or previewed. They're memoised, and warm() renders them
// once at boot so no interaction ever pays for the first one either.
const DYNAMIC_IMAGES = {
  economyShowcase: { filename: 'economy_showcase.png', generate: memoizeRender(generateEconomyShowcaseImage, { name: 'economyShowcase', max: 1 }) },
  reportGuide:      { filename: 'report_guide.png',     generate: memoizeRender(generateReportGuideImage,     { name: 'reportGuide',      max: 1 }) },
  nyseOpen:         { filename: 'nyse_open.png',        generate: memoizeRender(generateNyseOpenImage,        { name: 'nyseOpen',         max: 1 }) },
  riskGuide:        { filename: 'risk_guide.png',       generate: memoizeRender(generateRiskGuideImage,       { name: 'riskGuide',        max: 1 }) },
  newsfeedGuide:    { filename: 'newsfeed_guide.png',   generate: memoizeRender(generateNewsfeedGuideImage,   { name: 'newsfeedGuide',    max: 1 }) },
  tradingViewBanner: { filename: 'tradingview_banner.png', generate: memoizeRender(generateTradingViewBannerImage, { name: 'tradingViewBanner', max: 1 }) },
  whopBanner:        { filename: 'whop_banner.png',        generate: memoizeRender(generateWhopBannerImage,        { name: 'whopBanner',        max: 1 }) },
};

/**
 * Renders every template image once, yielding to the event loop between each
 * so a slow boot never looks like a hang. Called from index.js before login.
 */
async function warm() {
  const started = Date.now();
  for (const [key, entry] of Object.entries(DYNAMIC_IMAGES)) {
    try {
      entry.generate();
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
  const entry = DYNAMIC_IMAGES[dynamicImageKey(value)];
  return entry ? `attachment://${entry.filename}` : null;
}

// One AttachmentBuilder per distinct dynamic image referenced anywhere in
// the template (usually just one), so a multi-embed template referencing
// the same dynamic image twice doesn't generate/attach it twice.
function collectDynamicAttachments(template) {
  const seen = new Set();
  const files = [];
  for (const e of template.embeds) {
    if (!isDynamicImage(e.image)) continue;
    const key = dynamicImageKey(e.image);
    const entry = DYNAMIC_IMAGES[key];
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    files.push(new AttachmentBuilder(entry.generate(), { name: entry.filename }));
  }
  return files;
}

module.exports = { DYNAMIC_IMAGES, isDynamicImage, dynamicImageKey, dynamicAttachmentRef, collectDynamicAttachments, warm };
