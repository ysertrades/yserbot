'use strict';

/**
 * web/preview.js
 *
 * On-demand banner rendering for the Studio screen.
 *
 * The thing to keep in mind here: these renders are synchronous and block the
 * same thread that answers Discord. A preview redrawing on every keystroke
 * would freeze buttons and commands for the whole time someone is editing
 * copy — which is exactly the stall the render cache was built to remove, so
 * reintroducing it through the front door would be a poor trade.
 *
 * Three things keep that from happening:
 *   1. Identical copy is memoised, so re-rendering an unchanged banner is a
 *      Map lookup rather than 70 ms of blocked event loop.
 *   2. A minimum gap between distinct renders, enforced server-side. Hitting
 *      it returns 429 rather than queueing, so a burst can't build a backlog.
 *   3. The client debounces typing on top of both.
 */

const { memoizeRender } = require('../utils/renderCache');
const { generateTradingViewBannerImage, TV_DEFAULTS } = require('../utils/tradingViewVisual');
const { generateWhopBannerImage, WHOP_DEFAULTS } = require('../utils/whopVisual');
const { generatePrizeGiveawayBannerImage, PRIZE_DEFAULTS } = require('../utils/prizeGiveawayVisual');
const { generateGiveawayBannerImage } = require('../utils/giveawayVisual');
const { LIMITS, normalise, getBannerCopy, copyForDynamicKey } = require('../utils/bannerCopy');
const { DYNAMIC_IMAGES } = require('../utils/dynamicEmbedImages');

const TEMPLATES = {
  tradingview: {
    label: 'TradingView indicator',
    filename: 'tradingview_banner.png',
    defaults: TV_DEFAULTS,
    render: memoizeRender(generateTradingViewBannerImage, { name: 'preview:tradingview', max: 24 }),
  },
  whop: {
    label: 'Whop membership',
    filename: 'whop_banner.png',
    defaults: WHOP_DEFAULTS,
    render: memoizeRender(generateWhopBannerImage, { name: 'preview:whop', max: 24 }),
  },
  prize: {
    label: 'Prize giveaway',
    filename: 'prize_giveaway_banner.png',
    defaults: PRIZE_DEFAULTS,
    render: memoizeRender(generatePrizeGiveawayBannerImage, { name: 'preview:prize', max: 24 }),
  },
};

// The giveaway banner takes labels rather than copy fields, so it is not in
// TEMPLATES — the Studio form would not know what to do with it. It still goes
// through the same memoiser and the same pacing.
const giveawayBanner = memoizeRender(generateGiveawayBannerImage, { name: 'preview:giveaway', max: 24 });

/**
 * Preview of what a giveaway will look like before it is posted, built from
 * the same generator coinsgiveaway.js uses when it actually launches one.
 */
function renderGiveaway(params) {
  const amount = Math.max(0, Math.min(1e8, Number(params.get('amount')) || 0));
  const winners = Math.max(1, Math.min(50, Number(params.get('winners')) || 1));
  const opts = {
    amountLabel: `${amount.toLocaleString()} COINS EACH`,
    subLabel: `${winners} WINNER${winners !== 1 ? 'S' : ''} • HIT ENTER BELOW`,
  };

  const cached = giveawayBanner.peek(opts);
  if (cached) return { png: cached, cached: true, filename: 'giveaway_preview.png' };

  const since = Date.now() - lastRenderAt;
  if (since < MIN_GAP_MS) return { retryAfterMs: MIN_GAP_MS - since };

  const png = giveawayBanner(opts);
  lastRenderAt = Date.now();
  return { png, cached: false, filename: 'giveaway_preview.png' };
}

/**
 * Any dynamic embed image, by its `dynamic:<key>` key.
 *
 * Studio only edits the two banners, but the composer's preview has to be able
 * to show whichever generated image a template actually references — otherwise
 * previewing an embed built on the economy showcase shows a gap where the
 * artwork will be, which is worse than not offering a preview.
 */
function renderDynamicImage(key, guildId = null) {
  const entry = DYNAMIC_IMAGES[key];
  if (!entry) return null;

  const args = entry.takesCopy ? [copyForDynamicKey(guildId, key)] : [];
  const cached = entry.generate.peek(...args);
  if (cached) return { png: cached, cached: true, filename: entry.filename };

  const since = Date.now() - lastRenderAt;
  if (since < MIN_GAP_MS) return { retryAfterMs: MIN_GAP_MS - since };

  const png = entry.generate(...args);
  lastRenderAt = Date.now();
  return { png, cached: false, filename: entry.filename };
}

/** What the Studio screen needs to build its form. */
function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key, label: t.label, defaults: t.defaults, limits: LIMITS,
  }));
}

/**
 * Cleans copy coming off the form.
 *
 * Deliberately the same normalise() the save path uses, rather than a second
 * copy of the rules — if the two ever disagreed, Studio would preview one
 * thing and Discord would send another.
 */
function normaliseCopy(templateKey, template, params) {
  const input = {};
  for (const field of Object.keys(template.defaults)) {
    const raw = params.get(field);
    if (raw !== null) input[field] = raw;
  }
  return normalise(templateKey, input);
}

/* ─── pacing ─────────────────────────────────────────────────────────────── */

const MIN_GAP_MS = 250;
let lastRenderAt = 0;

/**
 * @returns {{png: Buffer, cached: boolean} | {retryAfterMs: number}}
 */
function render(key, params, guildId = null) {
  if (key === 'giveaway') return renderGiveaway(params);
  const template = TEMPLATES[key];
  if (!template) return null;

  // With no fields on the query string at all, show what is actually saved
  // rather than the factory defaults — that is what the embed would send, so
  // it is what opening Studio should display.
  const copy = [...params.keys()].some(k => k in template.defaults)
    ? normaliseCopy(key, template, params)
    : getBannerCopy(guildId, key);

  // A cache hit costs nothing, so it is never paced — only a call that would
  // genuinely block the thread has to wait its turn, and it has to be
  // identified before the work happens rather than after.
  const cached = template.render.peek(copy);
  if (cached) return { png: cached, cached: true, filename: template.filename };

  const since = Date.now() - lastRenderAt;
  if (since < MIN_GAP_MS) return { retryAfterMs: MIN_GAP_MS - since };

  const png = template.render(copy);
  lastRenderAt = Date.now();
  return { png, cached: false, filename: template.filename };
}

module.exports = { listTemplates, render, renderGiveaway, renderDynamicImage, TEMPLATES, LIMITS };
