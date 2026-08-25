'use strict';

/**
 * economyShowcaseVisual.js
 *
 * A large, static "what can I do here" poster for the whole economy system
 * (fish/mine/trivia/daily/work/jobs/bank/shop/casino/lottery), in the same
 * flat-glassmorphism house style as /risk. Purely decorative/informational
 * — no live user data — so it's meant to be embedded once as a saved
 * /embed template and (re)sent to a channel whenever wanted.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, GLYPH_H,
} = require('./pixelArt');
const { BADGE_DEFS } = require('./badges');
const { drawChestIcon } = require('./mysteryBoxVisual');

function drawWaveIcon(png, cx, cy, size, color) {
  for (let i = -1; i <= 1; i++) {
    const y = cy + i * size * 0.4;
    for (let x = -size; x <= size; x += 2) {
      const yy = y + Math.sin((x + i * 8) * 0.25) * size * 0.18;
      dot(png, cx + x, yy, 2, color);
    }
  }
}

function drawBriefcaseIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size, cy - size * 0.5, size * 2, size * 1.1, 6, color, 1);
  line(png, cx - size * 0.35, cy - size * 0.5, cx - size * 0.35, cy - size * 0.75, color, 3);
  line(png, cx + size * 0.35, cy - size * 0.5, cx + size * 0.35, cy - size * 0.75, color, 3);
  line(png, cx - size * 0.35, cy - size * 0.75, cx + size * 0.35, cy - size * 0.75, color, 3);
  line(png, cx - size, cy, cx + size, cy, [20, 18, 28, 255], 3);
}

function drawBankIcon(png, cx, cy, size, color) {
  line(png, cx - size, cy + size * 0.5, cx + size, cy + size * 0.5, color, 4);
  for (let i = -1; i <= 1; i++) {
    const x = cx + i * size * 0.7;
    line(png, x, cy - size * 0.3, x, cy + size * 0.4, color, 5);
  }
  line(png, cx - size * 1.1, cy - size * 0.5, cx, cy - size * 1.0, color, 3);
  line(png, cx, cy - size * 1.0, cx + size * 1.1, cy - size * 0.5, color, 3);
}

function drawCartIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size, cy - size * 0.4, size * 1.8, size * 0.9, 5, color, 1);
  line(png, cx - size * 1.1, cy - size * 0.7, cx - size, cy - size * 0.4, color, 2);
  dot(png, cx - size * 0.5, cy + size * 0.65, size * 0.16, color);
  dot(png, cx + size * 0.5, cy + size * 0.65, size * 0.16, color);
}

function drawDiceIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size, cy - size, size * 0.9, size * 0.9, 6, color, 1);
  fillRoundedRectBlend(png, cx + size * 0.1, cy + size * 0.1, size * 0.9, size * 0.9, 6, color, 1);
  const pip = [20, 18, 28, 255];
  dot(png, cx - size * 0.55, cy - size * 0.55, 3, pip);
  dot(png, cx + size * 0.55, cy + size * 0.55, 3, pip);
  dot(png, cx + size * 0.55 - size * 0.4, cy + size * 0.55 + size * 0.4, 3, pip);
  dot(png, cx + size * 0.55 + size * 0.4, cy + size * 0.55 - size * 0.4, 3, pip);
}

const TILES = [
  { label: 'FISHING',       sub: '/fish', color: [61, 156, 240, 255],  icon: drawWaveIcon },
  { label: 'MINING',        sub: '/mine', color: [176, 106, 230, 255], icon: (p, x, y, s) => BADGE_DEFS.diamond.draw(p, x, y, s, [110, 200, 255, 255]) },
  { label: 'TRIVIA',        sub: '/trivia', color: [46, 204, 113, 255], icon: (p, x, y, s, c) => drawTextCentered(p, '?', x, y - s * 0.75, 4, c) },
  { label: 'DAILY REWARD',  sub: '/daily', color: [255, 200, 60, 255], icon: (p, x, y, s) => BADGE_DEFS.star.draw(p, x, y, s, [255, 215, 0, 255]) },
  { label: 'WORK & JOBS',   sub: '/work · /jobs', color: [230, 126, 34, 255], icon: drawBriefcaseIcon },
  { label: 'BANK',          sub: '/bank', color: [52, 152, 219, 255], icon: drawBankIcon },
  { label: 'SHOP',          sub: '/shop', color: [230, 200, 90, 255], icon: drawCartIcon },
  { label: 'CASINO',        sub: '/casino', color: [231, 76, 60, 255], icon: drawDiceIcon },
  { label: 'LOTTERY & MYSTERY', sub: '/lottery · /shop', color: [155, 89, 182, 255], icon: (p, x, y, s) => drawChestIcon(p, x, y, s * 0.85, [155, 89, 182, 255]) },
];

function generateEconomyShowcaseImage() {
  const W = 1000, H = 720;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const brand = [90, 200, 170, 255];
  flatBg(png, [12, 14, 20, 255]);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 26, tint: brand, tintAlpha: 0.05, border: brand, borderAlpha: 0.35 });

  drawTextCentered(png, 'QUANTLAB ECONOMY', W / 2, 46, 5, [255, 255, 255, 255]);
  drawTextCentered(png, 'EVERY WAY TO EARN, PLAY, AND SPEND COINS', W / 2, 46 + 5 * GLYPH_H + 14, 2, [160, 200, 190, 255]);
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, 132, brand, 0.3);

  const cols = 3, rows = 3;
  const gridTop = 158, gridBottom = H - 46;
  const cellW = (W - 120) / cols, cellH = (gridBottom - gridTop) / rows;

  TILES.forEach((tile, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = 60 + col * cellW + cellW / 2;
    const cy = gridTop + row * cellH + cellH / 2;

    ringStroke(png, cx, cy - 28, 46, tile.color, 3);
    dotBlend(png, cx, cy - 28, 41, tile.color, 0.12);
    tile.icon(png, cx, cy - 28, 22, tile.color);

    drawTextCentered(png, tile.label, cx, cy + 32, 2, [255, 255, 255, 255]);
    drawTextCentered(png, tile.sub, cx, cy + 32 + 2 * GLYPH_H + 8, 1, [150, 158, 172, 255]);
  });

  return PNG.sync.write(png);
}

module.exports = { generateEconomyShowcaseImage };
