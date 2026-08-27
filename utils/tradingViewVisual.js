'use strict';

/**
 * tradingViewVisual.js
 *
 * Banner for posting TradingView indicators. The card itself is QuantLab's
 * own — dark Phantom surface, purple accents, the signature gradient rule —
 * since this is QuantLab presenting its own product. Only the small logo
 * tile keeps TradingView's own blue-on-black, the same way the YouTube feed
 * card keeps YouTube's red: it's actually displaying that platform's mark,
 * not decorating QuantLab's own chrome with it. The logo itself is redrawn
 * in utils/brandMarks.js so it renders as a PNG at any size.
 */

const {
  PNG, setPxBlend, dot,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, fitScale, GLYPH_H,
} = require('./pixelArt');
const { drawTradingViewMark, TV_ASPECT } = require('./brandMarks');
const { drawFlowLattice, drawFlowSignature, signatureWidth } = require('./brandSignature');
const { RGBA: LIGHT, RGBA_DARK: DARK, gradientRect, darkCard, fillCanvas } = require('./brandTheme');

const TV_BLUE = [41, 98, 255, 255]; // TradingView's own brand blue — logo tile only
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const TEXT = DARK.ink;
const SUBTLE = DARK.grey1;
const PURPLE = LIGHT.purple;
const PURPLE_L = LIGHT.purpleLight;

// Faint horizontal gridlines — a chart surface, kept well under the content.
function drawGrid(png, W, H, color) {
  for (let y = 60; y < H - 20; y += 46) {
    for (let x = 20; x < W - 20; x++) setPxBlend(png, x, y, color, 0.05);
  }
}

// The copy as it has always been. Passing nothing still produces exactly this
// image, which matters twice over: existing callers don't change, and the
// render cache keys on the arguments, so the no-arg call keeps its entry.
const TV_DEFAULTS = {
  pill:     'INDICATOR',
  heading:  'TRADINGVIEW',
  subtitle: 'CHART INDICATOR',
  tagline:  'PRECISION SETUPS FOR SMARTER ENTRIES AND EXITS.',
};

/**
 * @param {object} [copy] pill / heading / subtitle / tagline overrides
 * @returns {Buffer} PNG image data
 */
function generateTradingViewBannerImage(copy = {}) {
  const { pill, heading, subtitle, tagline } = { ...TV_DEFAULTS, ...copy };
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  fillCanvas(png, DARK.bg);
  // Woven straight into the background, so it runs under the panel and out to
  // every edge rather than sitting on top as a removable stamp.
  drawFlowLattice(png, { color: PURPLE_L, alpha: 0.035 });
  drawGrid(png, W, H, PURPLE);
  darkCard(png, 20, 20, W - 40, H - 40, { radius: 28 });

  // ── Status pill, top-right ────────────────────────────────────────────────
  const pillText = pill;
  const pillW = 40 + textWidth(pillText, 2);
  const pillX = W - 44 - pillW, pillY = 40;
  fillRoundedRectBlend(png, pillX, pillY, pillW, 42, 10, PURPLE, 1);
  dot(png, pillX + 20, pillY + 21, 6, WHITE);
  drawText(png, pillText, pillX + 34, pillY + 13, 2, WHITE);

  // ── Logo on its own black tile, the way TradingView show the mark ─────────
  const tileX = 62, tileY = 128, tileW = 254, tileH = 148;
  fillRoundedRectBlend(png, tileX, tileY, tileW, tileH, 30, BLACK, 1);
  fillRoundedRectBlend(png, tileX, tileY, tileW, tileH, 30, WHITE, 0.05);

  const markW = 176;
  drawTradingViewMark(png, tileX + (tileW - markW) / 2, tileY + (tileH - markW / TV_ASPECT) / 2, markW, WHITE);

  // ── Signature, centred under the logo tile ───────────────────────────────
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
  // The one signature gradient rule, sparingly, as everywhere else.
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

module.exports = { generateTradingViewBannerImage, TV_DEFAULTS };
