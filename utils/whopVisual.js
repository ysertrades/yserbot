'use strict';

/**
 * whopVisual.js
 *
 * A brand-styled banner for promoting a Whop storefront/membership — near-
 * black background, Whop's signature vivid green, a rounded app-icon-style
 * badge with a bold "W" monogram, same layout family as tradingViewVisual.js
 * (badge left, wordmark + tagline right) so both read as one system.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dot, dotBlend, line,
  fillRoundedRectBlend, drawText, drawTextCentered, drawChar, wrapText, textWidth, GLYPH_H, GLYPH_W,
} = require('./pixelArt');

const GREEN = [22, 222, 128, 255];
const WHITE = [255, 255, 255, 255];
const DARK  = [9, 11, 10, 255];

function star(png, cx, cy, size, color) {
  const spikes = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [dx, dy] of spikes) line(png, cx, cy, cx + dx * size, cy + dy * size, color, 2);
  dotBlend(png, cx, cy, Math.max(1, size * 0.22), color, 1);
}

// A rounded-square app-icon badge with a big bold "W" monogram and a small
// sparkle accent — an original mark in Whop's signature green, evoking the
// same "colored rounded-square app icon" identity TradingView's badge uses.
function drawMonogramBadge(png, cx, cy, size, badgeColor, markColor) {
  fillRoundedRectBlend(png, cx - size, cy - size, size * 2, size * 2, size * 0.42, badgeColor, 1);
  const scale = (size * 1.5) / GLYPH_H;
  drawChar(png, 'W', cx - (GLYPH_W * scale) / 2, cy - (GLYPH_H * scale) / 2, scale, markColor);
  star(png, cx + size * 0.72, cy - size * 0.68, size * 0.22, WHITE);
}

/**
 * @returns {Buffer} PNG image data
 */
function generateWhopBannerImage() {
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  flatBg(png, DARK);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: GREEN, tintAlpha: 0.06, border: GREEN, borderAlpha: 0.4 });

  // ── Status pill, top-right ────────────────────────────────────────────────
  const pillText = 'PREMIUM';
  const pillW = 40 + textWidth(pillText, 2);
  const pillX = W - 44 - pillW, pillY = 40;
  fillRoundedRectBlend(png, pillX, pillY, pillW, 42, 10, GREEN, 0.9);
  dot(png, pillX + 20, pillY + 21, 6, DARK);
  drawText(png, pillText, pillX + 34, pillY + 13, 2, DARK);

  // ── App-icon-style badge, left ────────────────────────────────────────────
  const bcx = 176, bcy = 200;
  drawMonogramBadge(png, bcx, bcy, 92, GREEN, DARK);

  // ── Wordmark + subtitle ──────────────────────────────────────────────────
  const contentCx = (356 + (W - 44)) / 2;
  drawTextCentered(png, 'WHOP', contentCx, 90, 6, WHITE);
  drawTextCentered(png, 'MEMBERSHIP & PREMIUM ACCESS', contentCx, 90 + 6 * GLYPH_H + 16, 2, GREEN);

  // ── Tagline ───────────────────────────────────────────────────────────────
  const contentLeft = 356, contentRight = W - 44, contentWidth = contentRight - contentLeft;
  for (let x = contentLeft; x < contentRight; x++) setPxBlend(png, x, 260, GREEN, 0.3);
  const lines = wrapText('UNLOCK COURSES, COMMUNITY AND PREMIUM PERKS - ALL IN ONE PLACE.', 2, contentWidth);
  let ty = 282;
  for (const l of lines.slice(0, 2)) { drawTextCentered(png, l, contentCx, ty, 2, [220, 240, 230, 255]); ty += GLYPH_H * 2 + 10; }

  return PNG.sync.write(png);
}

module.exports = { generateWhopBannerImage };
