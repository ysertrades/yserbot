'use strict';

/**
 * newsfeedGuideVisual.js
 *
 * A large "introducing the news feed" poster in the same flat-
 * glassmorphism house style as the economy showcase — a tile grid of every
 * topic bundle /newsfeed can filter by (matching utils/newsTopics.js), plus
 * a call-to-action strip. Purely decorative — meant to be embedded once as
 * a saved /embed template.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawTextCentered, wrapText, GLYPH_H,
} = require('./pixelArt');

const BRAND = [29, 155, 240, 255]; // matches embedBuilder.js's 'news' color
const WHITE = [255, 255, 255, 255];
const DARK  = [10, 14, 20, 255];

function drawForexIcon(png, cx, cy, size, color) {
  line(png, cx - size * 0.6, cy - size * 0.25, cx + size * 0.35, cy - size * 0.25, color, 3);
  line(png, cx + size * 0.35, cy - size * 0.25, cx + size * 0.1, cy - size * 0.5, color, 3);
  line(png, cx + size * 0.35, cy - size * 0.25, cx + size * 0.1, cy, color, 3);
  line(png, cx + size * 0.6, cy + size * 0.25, cx - size * 0.35, cy + size * 0.25, color, 3);
  line(png, cx - size * 0.35, cy + size * 0.25, cx - size * 0.1, cy, color, 3);
  line(png, cx - size * 0.35, cy + size * 0.25, cx - size * 0.1, cy + size * 0.5, color, 3);
}

function drawBankIcon(png, cx, cy, size, color) {
  line(png, cx - size, cy + size * 0.5, cx + size, cy + size * 0.5, color, 4);
  for (let i = -1; i <= 1; i++) {
    const x = cx + i * size * 0.7;
    line(png, x, cy - size * 0.3, x, cy + size * 0.4, color, 5);
  }
  line(png, cx - size * 1.1, cy - size * 0.5, cx, cy - size, color, 3);
  line(png, cx, cy - size, cx + size * 1.1, cy - size * 0.5, color, 3);
}

function drawBarrelIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.55, cy - size, size * 1.1, size * 2, 12, color, 1);
  for (const dy of [-size * 0.4, 0, size * 0.4]) line(png, cx - size * 0.55, cy + dy, cx + size * 0.55, cy + dy, DARK, 2);
}

function drawChartUpIcon(png, cx, cy, size, color) {
  const bars = [0.4, 0.7, 0.55, 1.0];
  bars.forEach((h, i) => {
    const bx = cx - size * 0.75 + i * size * 0.5;
    fillRoundedRectBlend(png, bx, cy + size - h * size * 2, size * 0.32, h * size * 2, 2, color, 1);
  });
}

function drawPercentIcon(png, cx, cy, size, color) {
  drawTextCentered(png, '%', cx, cy - size * 0.7, 3, color);
}

function drawCoinIcon(png, cx, cy, size, color) {
  dotBlend(png, cx, cy, size * 0.85, color, 0.2);
  ringStroke(png, cx, cy, size * 0.85, color, 3);
  drawTextCentered(png, 'B', cx, cy - size * 0.5, 2, color);
}

function drawDataIcon(png, cx, cy, size, color) {
  const bars = [0.4, 0.9, 0.6];
  bars.forEach((h, i) => {
    const bx = cx - size * 0.55 + i * size * 0.55;
    fillRoundedRectBlend(png, bx, cy + size * 0.6 - h * size, size * 0.32, h * size, 2, color, 0.5);
  });
  line(png, cx - size * 0.55, cy + size * 0.1, cx, cy - size * 0.3, color, 3);
  line(png, cx, cy - size * 0.3, cx + size * 0.7, cy + size * 0.5, color, 3);
}

function drawGlobeIcon(png, cx, cy, size, color) {
  ringStroke(png, cx, cy, size * 0.85, color, 3);
  line(png, cx - size * 0.85, cy, cx + size * 0.85, cy, color, 2);
  ringStroke(png, cx, cy, size * 0.4, color, 2);
}

const TOPICS_DISPLAY = [
  { label: 'FOREX',          sub: 'Currency pairs & FX',      icon: drawForexIcon },
  { label: 'CENTRAL BANKS',  sub: 'Fed, ECB, BoE, BoJ',       icon: drawBankIcon },
  { label: 'COMMODITIES',    sub: 'Oil, gold, gas & metals',  icon: drawBarrelIcon },
  { label: 'STOCKS & INDICES', sub: 'S&P, Nasdaq, earnings',  icon: drawChartUpIcon },
  { label: 'BONDS & YIELDS', sub: 'Treasuries & auctions',    icon: drawPercentIcon },
  { label: 'CRYPTO',         sub: 'Bitcoin, Ethereum & more', icon: drawCoinIcon },
  { label: 'ECONOMIC DATA',  sub: 'CPI, GDP, jobs & PMI',     icon: drawDataIcon },
  { label: 'GEOPOLITICS',    sub: 'Conflicts & diplomacy',    icon: drawGlobeIcon },
];

function generateNewsfeedGuideImage() {
  // Same 4x2 grid, same topic order — just a wider/taller canvas so the
  // bumped-up label/sub text fits without crowding neighboring tiles (the
  // longer subtitles wrap to a second line inside their own tile instead).
  const cols = 4, rows = 2;
  const W = 1200;
  const gridTop = 160, cellH = 190;
  const gridBottom = gridTop + rows * cellH;
  const H = gridBottom + 60;

  const png = new PNG({ width: W, height: H, colorType: 6 });
  flatBg(png, [10, 14, 20, 255]);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 26, tint: BRAND, tintAlpha: 0.06, border: BRAND, borderAlpha: 0.4 });

  drawTextCentered(png, 'FINANCIAL JUICE NEWS FEED', W / 2, 44, 4, WHITE);
  drawTextCentered(png, 'LIVE MARKET-MOVING HEADLINES, DELIVERED TO YOUR CHANNEL', W / 2, 44 + 4 * GLYPH_H + 14, 2, [140, 200, 240, 255]);
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, 130, BRAND, 0.3);

  const cellW = (W - 120) / cols;

  TOPICS_DISPLAY.forEach((topic, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = 60 + col * cellW + cellW / 2;
    const cy = gridTop + row * cellH + cellH / 2;

    ringStroke(png, cx, cy - 30, 42, BRAND, 3);
    dotBlend(png, cx, cy - 30, 37, BRAND, 0.12);
    topic.icon(png, cx, cy - 30, 20, BRAND);

    drawTextCentered(png, topic.label, cx, cy + 26, 2, WHITE);
    const subLines = wrapText(topic.sub.toUpperCase(), 2, cellW - 24);
    let sy = cy + 26 + 2 * GLYPH_H + 10;
    for (const l of subLines) {
      drawTextCentered(png, l, cx, sy, 2, [160, 168, 184, 255]);
      sy += 2 * GLYPH_H + 6;
    }
  });

  return PNG.sync.write(png);
}

module.exports = { generateNewsfeedGuideImage };
