'use strict';

/**
 * tradingViewVisual.js
 *
 * A brand-styled banner for posting TradingView indicators — dark chart-app
 * background, TradingView's signature blue, a rounded-square app-icon-style
 * badge with a hand-drawn ascending chart mark, matching the layout other
 * "guide" banners use (badge left, wordmark + tagline right). The template
 * this feeds leaves the embed description empty so a mod can drop in the
 * actual indicator write-up each time they post one.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dot, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, GLYPH_H,
} = require('./pixelArt');

const BLUE  = [41, 98, 255, 255];
const WHITE = [255, 255, 255, 255];
const DARK  = [19, 23, 34, 255];

// Faint horizontal chart gridlines across the whole canvas — a subtle nod
// to a charting surface without competing with the content on top.
function drawGrid(png, W, H, color) {
  for (let y = 60; y < H - 20; y += 46) {
    for (let x = 20; x < W - 20; x++) setPxBlend(png, x, y, color, 0.05);
  }
}

// TradingView's real app icon is a solid rounded-square badge with a white
// abstract chart mark — reused here as an ascending trendline with an
// arrowhead, plus two small candlesticks along the base for extra detail.
function drawChartMark(png, cx, cy, size, badgeColor, markColor) {
  fillRoundedRectBlend(png, cx - size, cy - size, size * 2, size * 2, size * 0.42, badgeColor, 1);

  const pts = [[-0.55, 0.35], [-0.18, 0.02], [0.15, 0.22], [0.5, -0.28], [0.8, -0.55]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    line(png, cx + ax * size, cy + ay * size, cx + bx * size, cy + by * size, markColor, 4);
  }
  const [tipX, tipY] = pts[pts.length - 1];
  const [prevX, prevY] = pts[pts.length - 2];
  const ang = Math.atan2(tipY - prevY, tipX - prevX);
  for (const off of [ang + 2.4, ang - 2.4]) {
    line(png, cx + tipX * size, cy + tipY * size,
      cx + tipX * size + Math.cos(off) * size * 0.22, cy + tipY * size + Math.sin(off) * size * 0.22,
      markColor, 4);
  }

  const candles = [[-0.62, 0.55, 0.18], [-0.32, 0.4, 0.28]];
  for (const [dx, bodyH, top] of candles) {
    const bw = size * 0.16, bh = bodyH * size;
    line(png, cx + dx * size, cy + top * size - 4, cx + dx * size, cy + top * size + bh + 4, markColor, 2);
    fillRoundedRectBlend(png, cx + dx * size - bw / 2, cy + top * size, bw, bh, 1, markColor, 0.85);
  }
}

/**
 * @returns {Buffer} PNG image data
 */
function generateTradingViewBannerImage() {
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  flatBg(png, DARK);
  drawGrid(png, W, H, BLUE);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: BLUE, tintAlpha: 0.06, border: BLUE, borderAlpha: 0.4 });

  // ── Status pill, top-right ────────────────────────────────────────────────
  const pillText = 'INDICATOR';
  const pillW = 40 + textWidth(pillText, 2);
  const pillX = W - 44 - pillW, pillY = 40;
  fillRoundedRectBlend(png, pillX, pillY, pillW, 42, 10, BLUE, 0.9);
  dot(png, pillX + 20, pillY + 21, 6, WHITE);
  drawText(png, pillText, pillX + 34, pillY + 13, 2, WHITE);

  // ── App-icon-style badge, left ────────────────────────────────────────────
  const bcx = 176, bcy = 200;
  drawChartMark(png, bcx, bcy, 92, BLUE, WHITE);

  // ── Wordmark + subtitle ──────────────────────────────────────────────────
  const contentCx = (356 + (W - 44)) / 2;
  drawTextCentered(png, 'TRADINGVIEW', contentCx, 90, 6, WHITE);
  drawTextCentered(png, 'CHART INDICATOR', contentCx, 90 + 6 * GLYPH_H + 16, 2, BLUE);

  // ── Tagline ───────────────────────────────────────────────────────────────
  const contentLeft = 356, contentRight = W - 44, contentWidth = contentRight - contentLeft;
  for (let x = contentLeft; x < contentRight; x++) setPxBlend(png, x, 260, BLUE, 0.3);
  const lines = wrapText('PRECISION INDICATORS FOR SMARTER ENTRIES AND EXITS.', 2, contentWidth);
  let ty = 282;
  for (const l of lines.slice(0, 2)) { drawTextCentered(png, l, contentCx, ty, 2, [210, 220, 240, 255]); ty += GLYPH_H * 2 + 10; }

  return PNG.sync.write(png);
}

module.exports = { generateTradingViewBannerImage };
