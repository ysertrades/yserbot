'use strict';

/**
 * whopVisual.js
 *
 * Banner for promoting the QuantLab Whop storefront — the brand book's own
 * "Education, the on-ramp, via Whop" pillar, so this is a QuantLab surface
 * first. Restyled to the same dark Phantom card as every other banner, with
 * Whop's own orange-and-cream wing mark kept in its own tile — the same
 * "the platform's mark stays in its own colours, the chrome around it is
 * ours" rule used for the TradingView banner. The logo is redrawn in
 * utils/brandMarks.js so it renders as a PNG at any size.
 */

const {
  PNG, dot,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, fitScale, GLYPH_H,
} = require('./pixelArt');
const { drawWhopMark, WHOP_ASPECT } = require('./brandMarks');
const { drawFlowLattice, drawFlowSignature, signatureWidth } = require('./brandSignature');
const { RGBA: LIGHT, RGBA_DARK: DARK, gradientRect, darkCard, fillCanvas } = require('./brandTheme');

const ORANGE = [250, 69, 22, 255];   // Whop's own brand orange — mark tile only
const CREAM  = [255, 240, 224, 255]; // the mark's own off-white
const WHITE  = [255, 255, 255, 255];
const TEXT   = DARK.ink;
const SUBTLE = DARK.grey1;
const PURPLE = LIGHT.purple;
const PURPLE_L = LIGHT.purpleLight;

// As above: passing nothing reproduces the original card exactly, so existing
// callers are unaffected and the no-arg render keeps its cache entry.
const WHOP_DEFAULTS = {
  pill:     'PREMIUM',
  heading:  'WHOP',
  subtitle: 'MEMBERSHIP & PREMIUM ACCESS',
  tagline:  'COURSES, COMMUNITY AND PREMIUM PERKS - ALL IN ONE PLACE.',
};

/**
 * @param {object} [copy] pill / heading / subtitle / tagline overrides
 * @returns {Buffer} PNG image data
 */
function generateWhopBannerImage(copy = {}) {
  const { pill, heading, subtitle, tagline } = { ...WHOP_DEFAULTS, ...copy };
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  fillCanvas(png, DARK.bg);
  // Woven straight into the background, so it runs under the panel and out to
  // every edge rather than sitting on top as a removable stamp.
  drawFlowLattice(png, { color: PURPLE_L, alpha: 0.035 });
  darkCard(png, 20, 20, W - 40, H - 40, { radius: 28 });

  // ── Status pill, top-right ────────────────────────────────────────────────
  const pillText = pill;
  const pillW = 40 + textWidth(pillText, 2);
  const pillX = W - 44 - pillW, pillY = 40;
  fillRoundedRectBlend(png, pillX, pillY, pillW, 42, 10, PURPLE, 1);
  dot(png, pillX + 20, pillY + 21, 6, WHITE);
  drawText(png, pillText, pillX + 34, pillY + 13, 2, WHITE);

  // ── The wing mark, on its own orange tile — Whop's own identity, the way
  //    TradingView's mark keeps its own black-and-blue tile ────────────────
  const tileX = 62, tileY = 128, tileW = 254, tileH = 148;
  fillRoundedRectBlend(png, tileX, tileY, tileW, tileH, 30, ORANGE, 1);
  const markW = 176;
  drawWhopMark(png, tileX + (tileW - markW) / 2, tileY + (tileH - markW / WHOP_ASPECT) / 2, markW, CREAM);

  // ── Signature, centred under the tile ─────────────────────────────────────
  drawFlowSignature(png, Math.round(tileX + (tileW - signatureWidth()) / 2), 306, {
    chip: PURPLE, primary: TEXT, caption: SUBTLE,
    chipAlpha: 0.18, borderAlpha: 0.45, captionAlpha: 0.85,
  });

  // ── Wordmark + subtitle ──────────────────────────────────────────────────
  const contentLeft = 356, contentRight = W - 44;
  const contentCx = (contentLeft + contentRight) / 2;
  const contentW = contentRight - contentLeft;
  // Scale steps down for longer copy rather than letting it run off the card.
  const headScale = fitScale(heading, contentW, 6, 2);
  drawTextCentered(png, heading, contentCx, 96 + (6 - headScale) * GLYPH_H / 2, headScale, TEXT);
  drawTextCentered(png, subtitle, contentCx, 96 + 6 * GLYPH_H + 16, fitScale(subtitle, contentW, 2, 1), PURPLE_L);

  // ── Tagline ───────────────────────────────────────────────────────────────
  gradientRect(png, contentLeft, 260, contentW, 4, 2);
  const lines = wrapText(tagline, 2, contentW);
  // Two lines is all the card has room for. Copy that runs past it gets a
  // visible ellipsis — silently dropping the end just looked like a bug.
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] += '...';
  let ty = 284;
  for (const l of shown) { drawTextCentered(png, l, contentCx, ty, 2, SUBTLE); ty += GLYPH_H * 2 + 10; }

  return PNG.sync.write(png);
}

module.exports = { generateWhopBannerImage, WHOP_DEFAULTS };
