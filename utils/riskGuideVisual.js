'use strict';

/**
 * riskGuideVisual.js
 *
 * A large "how to use /risk" walkthrough poster in the same flat-
 * glassmorphism house style as /risk itself — five numbered steps, listed
 * vertically so each title/description reads clearly at a glance (no
 * zooming into the image needed), plus a worked example strip showing a
 * real command turning into a real contract count. Purely decorative —
 * meant to be embedded once as a saved /embed template.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, textWidth, GLYPH_H,
} = require('./pixelArt');

const ACCENT = [52, 152, 219, 255];
const WHITE = [255, 255, 255, 255];
const GOOD = [46, 204, 113, 255];

function drawSlashIcon(png, cx, cy, size, color) {
  drawTextCentered(png, '/', cx, cy - size * 0.7, 3, color);
}

function drawDollarIcon(png, cx, cy, size, color) {
  drawTextCentered(png, '$', cx, cy - size * 0.7, 3, color);
}

function drawRulerIcon(png, cx, cy, size, color) {
  line(png, cx - size * 0.7, cy, cx + size * 0.7, cy, color, 4);
  for (let i = -3; i <= 3; i++) {
    const x = cx + i * size * 0.2;
    line(png, x, cy - (i % 2 === 0 ? size * 0.35 : size * 0.2), x, cy, color, 2);
  }
}

function drawStackIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.6, cy + size * 0.15, size * 1.2, size * 0.32, 2, color, 1);
  fillRoundedRectBlend(png, cx - size * 0.5, cy - size * 0.25, size, size * 0.32, 2, color, 0.85);
  fillRoundedRectBlend(png, cx - size * 0.38, cy - size * 0.65, size * 0.76, size * 0.32, 2, color, 0.7);
}

function drawCheckIcon(png, cx, cy, size, color) {
  line(png, cx - size * 0.5, cy, cx - size * 0.1, cy + size * 0.45, color, 5);
  line(png, cx - size * 0.1, cy + size * 0.45, cx + size * 0.55, cy - size * 0.45, color, 5);
}

const STEPS = [
  { icon: drawSlashIcon, title: 'RUN /RISK', desc: 'Pick a futures symbol — ES, NQ, GC & more' },
  { icon: drawDollarIcon, title: 'SET YOUR RISK', desc: "How much you're willing to lose, in USD" },
  { icon: drawRulerIcon, title: 'SET YOUR STOP', desc: 'Your stop distance, in points' },
  { icon: drawStackIcon, title: 'GET YOUR SIZE', desc: 'Standard & micro contract counts, instantly' },
  { icon: drawCheckIcon, title: 'TRADE WITH A PLAN', desc: 'Never guess your position size again' },
];

function generateRiskGuideImage() {
  const W = 1000, H = 870;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  flatBg(png, [12, 15, 20, 255]);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 26, tint: ACCENT, tintAlpha: 0.05, border: ACCENT, borderAlpha: 0.35 });

  drawTextCentered(png, 'HOW TO USE THE RISK CALCULATOR', W / 2, 44, 4, WHITE);
  drawTextCentered(png, 'FIVE STEPS FROM SYMBOL TO POSITION SIZE', W / 2, 44 + 4 * GLYPH_H + 14, 2, [150, 190, 220, 255]);
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, 130, ACCENT, 0.3);

  // ── Vertical step list — big icon badges on the left, bold left-aligned
  //    title/description text on the right with plenty of room, so nothing
  //    needs to be zoomed into to read ──────────────────────────────────────
  const iconCx = 116;
  const rowTop = 162, rowH = 92;
  const textLeft = 200;

  STEPS.forEach((step, i) => {
    const cy = rowTop + i * rowH + rowH / 2;

    ringStroke(png, iconCx, cy, 40, ACCENT, 3);
    dotBlend(png, iconCx, cy, 35, ACCENT, 0.12);
    step.icon(png, iconCx, cy, 21, ACCENT);

    const nCx = iconCx + 36, nCy = cy - 36;
    dotBlend(png, nCx, nCy, 17, ACCENT, 0.9);
    drawTextCentered(png, `${i + 1}`, nCx, nCy - GLYPH_H, 2, WHITE);

    drawText(png, step.title, textLeft, cy - 26, 2, WHITE);
    drawText(png, step.desc, textLeft, cy - 26 + 2 * GLYPH_H + 10, 2, [172, 182, 198, 255]);

    if (i < STEPS.length - 1) {
      const nextCy = rowTop + (i + 1) * rowH + rowH / 2;
      for (let y = cy + 46; y < nextCy - 46; y += 10) setPxBlend(png, iconCx, y, ACCENT, 0.35);
    }
  });

  // ── Worked example strip ──────────────────────────────────────────────────
  const exY = rowTop + STEPS.length * rowH + 36;
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, exY, ACCENT, 0.3);
  drawTextCentered(png, 'A REAL EXAMPLE', W / 2, exY + 20, 2, [150, 190, 220, 255]);

  const cmdText = '/RISK ES 100 2.5';
  const resText = '2 CONTRACTS';
  const cmdW = 40 + textWidth(cmdText, 2);
  const resW = 40 + textWidth(resText, 2);
  const gap = 90;
  const totalW = cmdW + gap + resW;
  const startX = (W - totalW) / 2;
  const chipY = exY + 60;

  fillRoundedRectBlend(png, startX, chipY, cmdW, 50, 10, WHITE, 0.1);
  drawTextCentered(png, cmdText, startX + cmdW / 2, chipY + 16, 2, WHITE);

  const arrowCx = startX + cmdW + gap / 2;
  line(png, arrowCx - 22, chipY + 25, arrowCx + 14, chipY + 25, GOOD, 4);
  line(png, arrowCx + 14, chipY + 25, arrowCx + 2, chipY + 13, GOOD, 4);
  line(png, arrowCx + 14, chipY + 25, arrowCx + 2, chipY + 37, GOOD, 4);

  fillRoundedRectBlend(png, startX + cmdW + gap, chipY, resW, 50, 10, GOOD, 0.2);
  drawTextCentered(png, resText, startX + cmdW + gap + resW / 2, chipY + 16, 2, GOOD);

  drawTextCentered(png, 'RISK $100 WITH A 2.5-POINT STOP ON ES', W / 2, chipY + 82, 1, [140, 146, 158, 255]);

  return PNG.sync.write(png);
}

module.exports = { generateRiskGuideImage };
