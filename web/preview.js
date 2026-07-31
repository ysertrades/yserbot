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
const { generateGiveawayBannerImage } = require('../utils/giveawayVisual');

// Caps chosen from what the card can actually show: past these the renderer
// starts shrinking type toward unreadable rather than laying out badly.
const LIMITS = { pill: 16, heading: 28, subtitle: 44, tagline: 130 };

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

/** What the Studio screen needs to build its form. */
function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key, label: t.label, defaults: t.defaults, limits: LIMITS,
  }));
}

/**
 * Cleans copy coming off the form.
 *
 * The pixel font has no lower case — drawChar upper-cases anyway — and
 * silently skips any character it has no glyph for. Upper-casing here means
 * what the field shows is what the image will say.
 */
function normaliseCopy(template, params) {
  const out = {};
  for (const field of Object.keys(template.defaults)) {
    const raw = params.get(field);
    if (raw === null) continue;
    const clean = raw.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, LIMITS[field]);
    // An emptied field falls back to the default rather than rendering a gap,
    // so a half-filled form still produces a usable card.
    if (clean) out[field] = clean;
  }
  return out;
}

/* ─── pacing ─────────────────────────────────────────────────────────────── */

const MIN_GAP_MS = 250;
let lastRenderAt = 0;

/**
 * @returns {{png: Buffer, cached: boolean} | {retryAfterMs: number}}
 */
function render(key, params) {
  if (key === 'giveaway') return renderGiveaway(params);
  const template = TEMPLATES[key];
  if (!template) return null;

  const copy = normaliseCopy(template, params);

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

module.exports = { listTemplates, render, renderGiveaway, TEMPLATES, LIMITS };
