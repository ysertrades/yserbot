'use strict';

/**
 * marketSessionVisual.js
 *
 * A large "trading session open" poster in the same flat-glassmorphism
 * house style as the economic calendar cards — a skyline badge, a bold
 * status pill, big session name, and a bold time chip (legible at a
 * glance, not fine print) plus a tagline banner. `generateMarketSessionImage`
 * is the reusable template; `generateNyseOpenImage` is the concrete NYSE
 * poster requested, so adding another session later (London/Tokyo/Sydney)
 * is just another thin wrapper.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, GLYPH_H,
} = require('./pixelArt');

const GOOD = [46, 204, 113, 255];
const WHITE = [255, 255, 255, 255];
const DARK = [10, 16, 13, 255];

function drawSkylineIcon(png, cx, cy, size, color) {
  const buildings = [
    { dx: -0.95, w: 0.32, h: 0.85 },
    { dx: -0.55, w: 0.38, h: 1.25 },
    { dx: -0.08, w: 0.42, h: 1.65 },
    { dx: 0.42, w: 0.34, h: 1.05 },
    { dx: 0.82, w: 0.3, h: 0.72 },
  ];
  const baseY = cy + size * 0.9;
  for (const b of buildings) {
    const bx = cx + b.dx * size, bw = b.w * size, bh = b.h * size;
    fillRoundedRectBlend(png, bx - bw / 2, baseY - bh, bw, bh, 3, color, 1);
    for (let wy = baseY - bh + 10; wy < baseY - 6; wy += 12) {
      for (let wx = bx - bw / 2 + 6; wx < bx + bw / 2 - 6; wx += 10) {
        setPxBlend(png, wx, wy, DARK, 0.55);
      }
    }
  }
  const flagX = cx - 0.08 * size, flagTopY = baseY - 1.65 * size;
  line(png, flagX, flagTopY, flagX, flagTopY - size * 0.28, color, 2);
  fillRoundedRectBlend(png, flagX, flagTopY - size * 0.28, size * 0.2, size * 0.11, 1, color, 0.9);
}

function drawBgBars(png, W, H, color) {
  const bars = 16;
  const colW = W / bars;
  for (let i = 0; i < bars; i++) {
    const bw = colW * 0.5;
    const bx = colW * i + (colW - bw) / 2;
    const bh = 24 + (i % 5) * 14 + i * 2.5;
    fillRoundedRectBlend(png, bx, H - 30 - bh, bw, bh, 2, color, 0.05);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.sessionLabel - e.g. "NYSE OPEN"
 * @param {string} opts.exchangeName - e.g. "NEW YORK STOCK EXCHANGE"
 * @param {string} opts.time - e.g. "9:30 AM EST"
 * @param {string} opts.tagline - e.g. "Markets are live. Follow your strategy and manage risk."
 * @param {[number,number,number,number]} [opts.accent] - RGBA accent color, defaults to green
 * @returns {Buffer} PNG image data
 */
function generateMarketSessionImage(opts) {
  const { sessionLabel, exchangeName, time, tagline, accent = GOOD } = opts;
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  flatBg(png, [11, 16, 13, 255]);
  drawBgBars(png, W, H, accent);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: accent, tintAlpha: 0.06, border: accent, borderAlpha: 0.4 });

  // ── Status pill, top-right ────────────────────────────────────────────────
  const pillText = 'LIVE';
  const pillW = 40 + textWidth(pillText, 2);
  const pillX = W - 44 - pillW, pillY = 40;
  fillRoundedRectBlend(png, pillX, pillY, pillW, 42, 10, accent, 0.9);
  dot(png, pillX + 20, pillY + 21, 6, WHITE);
  drawText(png, pillText, pillX + 34, pillY + 13, 2, DARK);

  // ── Skyline badge, left ────────────────────────────────────────────────────
  const bcx = 176, bcy = 230;
  ringStroke(png, bcx, bcy, 132, accent, 4);
  dotBlend(png, bcx, bcy, 118, accent, 0.12);
  drawSkylineIcon(png, bcx, bcy, 78, accent);

  // ── Session name + exchange subtitle ────────────────────────────────────────
  const contentCx = (356 + (W - 44)) / 2;
  drawTextCentered(png, sessionLabel.toUpperCase(), contentCx, 68, 6, WHITE);
  drawTextCentered(png, exchangeName.toUpperCase(), contentCx, 68 + 6 * GLYPH_H + 16, 2, accent);

  // ── Bold time chip ──────────────────────────────────────────────────────────
  const timeText = time.toUpperCase();
  const chipW = 48 + textWidth(timeText, 3);
  const chipX = contentCx - chipW / 2, chipY = 190;
  fillRoundedRectBlend(png, chipX, chipY, chipW, 56, 12, WHITE, 0.12);
  drawTextCentered(png, timeText, contentCx, chipY + 16, 3, WHITE);

  // ── Tagline banner ──────────────────────────────────────────────────────────
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, 288, accent, 0.3);
  const lines = wrapText(tagline.toUpperCase(), 2, W - 120);
  let ty = 310;
  for (const l of lines.slice(0, 2)) { drawTextCentered(png, l, W / 2, ty, 2, [220, 226, 220, 255]); ty += GLYPH_H * 2 + 10; }

  return PNG.sync.write(png);
}

function generateNyseOpenImage() {
  return generateMarketSessionImage({
    sessionLabel: 'NYSE OPEN',
    exchangeName: 'New York Stock Exchange',
    time: '9:30 AM EST',
    tagline: 'Markets are live. Follow your strategy and manage risk.',
  });
}

module.exports = { generateMarketSessionImage, generateNyseOpenImage };
