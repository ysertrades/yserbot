'use strict';

/**
 * tradingViewVisual.js
 *
 * Banner for posting TradingView indicators — dark styling, matching how
 * TradingView present their own mark: white on black, with their signature
 * blue as the only accent. The logo itself is redrawn in utils/brandMarks.js
 * so it renders as a PNG at any size.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dot,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, GLYPH_H,
} = require('./pixelArt');
const { drawTradingViewMark, TV_ASPECT } = require('./brandMarks');

const BLUE  = [41, 98, 255, 255];    // TradingView's brand blue
const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];
const BG    = [8, 9, 12, 255];
const MUTED = [150, 162, 186, 255];

// Faint horizontal gridlines — a chart surface, kept well under the content.
function drawGrid(png, W, H, color) {
  for (let y = 60; y < H - 20; y += 46) {
    for (let x = 20; x < W - 20; x++) setPxBlend(png, x, y, color, 0.05);
  }
}

/**
 * @returns {Buffer} PNG image data
 */
function generateTradingViewBannerImage() {
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  flatBg(png, BG);
  drawGrid(png, W, H, BLUE);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: BLUE, tintAlpha: 0.05, border: BLUE, borderAlpha: 0.38 });

  // ── Status pill, top-right ────────────────────────────────────────────────
  const pillText = 'INDICATOR';
  const pillW = 40 + textWidth(pillText, 2);
  const pillX = W - 44 - pillW, pillY = 40;
  fillRoundedRectBlend(png, pillX, pillY, pillW, 42, 10, BLUE, 0.95);
  dot(png, pillX + 20, pillY + 21, 6, WHITE);
  drawText(png, pillText, pillX + 34, pillY + 13, 2, WHITE);

  // ── Logo on its own black tile, the way TradingView show the mark ─────────
  const tileX = 62, tileY = 128, tileW = 254, tileH = 148;
  fillRoundedRectBlend(png, tileX, tileY, tileW, tileH, 30, BLACK, 1);
  fillRoundedRectBlend(png, tileX, tileY, tileW, tileH, 30, WHITE, 0.05);

  const markW = 176;
  drawTradingViewMark(png, tileX + (tileW - markW) / 2, tileY + (tileH - markW / TV_ASPECT) / 2, markW, WHITE);

  // ── Wordmark + subtitle ──────────────────────────────────────────────────
  const contentLeft = 356, contentRight = W - 44;
  const contentCx = (contentLeft + contentRight) / 2;
  drawTextCentered(png, 'TRADINGVIEW', contentCx, 96, 6, WHITE);
  drawTextCentered(png, 'CHART INDICATOR', contentCx, 96 + 6 * GLYPH_H + 16, 2, BLUE);

  // ── Tagline ───────────────────────────────────────────────────────────────
  for (let x = contentLeft; x < contentRight; x++) setPxBlend(png, x, 262, BLUE, 0.3);
  const lines = wrapText('PRECISION SETUPS FOR SMARTER ENTRIES AND EXITS.', 2, contentRight - contentLeft);
  let ty = 284;
  for (const l of lines.slice(0, 2)) { drawTextCentered(png, l, contentCx, ty, 2, MUTED); ty += GLYPH_H * 2 + 10; }

  return PNG.sync.write(png);
}

module.exports = { generateTradingViewBannerImage };
