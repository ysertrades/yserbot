'use strict';

/**
 * reportGuideVisual.js
 *
 * A large, static "how to file a report" walkthrough poster in the same
 * flat-glassmorphism house style as /risk and the economy showcase — five
 * numbered steps matching the real /report panel flow. Purely decorative
 * — meant to be embedded once as a saved /embed template.
 */

const {
  PNG, setPxBlend, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, GLYPH_H,
} = require('./pixelArt');
const { RGBA: LIGHT, RGBA_DARK: SURF, darkCard, fillCanvas } = require('./brandTheme');

function drawSlashIcon(png, cx, cy, size, color) {
  drawTextCentered(png, '/', cx, cy - size * 0.7, 3, color);
}

function drawPersonIcon(png, cx, cy, size, color) {
  dot(png, cx, cy - size * 0.5, size * 0.3, color);
  fillRoundedRectBlend(png, cx - size * 0.45, cy - size * 0.05, size * 0.9, size * 0.65, size * 0.3, color, 1);
}

function drawTagIcon(png, cx, cy, size, color) {
  for (let dy = -size * 0.5; dy <= size * 0.5; dy++) {
    const t = (dy + size * 0.5) / size;
    const w = size * 0.7 * (1 - t * 0.3);
    for (let dx = -w; dx <= w; dx++) setPxBlend(png, cx + dx, cy + dy, color, 1);
  }
  dot(png, cx, cy - size * 0.28, size * 0.12, [12, 13, 18, 255]);
}

function drawLinkIcon(png, cx, cy, size, color) {
  ringStroke(png, cx - size * 0.28, cy, size * 0.32, color, 4);
  ringStroke(png, cx + size * 0.28, cy, size * 0.32, color, 4);
}

function drawCheckIcon(png, cx, cy, size, color) {
  line(png, cx - size * 0.5, cy, cx - size * 0.1, cy + size * 0.45, color, 5);
  line(png, cx - size * 0.1, cy + size * 0.45, cx + size * 0.55, cy - size * 0.45, color, 5);
}

const STEPS = [
  { icon: drawSlashIcon, title: 'RUN /REPORT', desc: 'Opens your private report panel' },
  { icon: drawPersonIcon, title: 'PICK THE USER', desc: 'Search or scroll the member list' },
  { icon: drawTagIcon, title: 'PICK A REASON', desc: 'Spam, harassment, scam, and more' },
  { icon: drawLinkIcon, title: 'ADD A LINK', desc: 'Optional — link the message as proof' },
  { icon: drawCheckIcon, title: 'SUBMIT', desc: 'Sent straight to the mod team' },
];

function generateReportGuideImage() {
  const W = 1000, H = 560;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  // Matches messageStyle's 'reports' colour — severity as depth of purple,
  // same as everywhere else, not a literal alert red.
  const accent = LIGHT.purpleDeep;
  fillCanvas(png, SURF.bg);
  darkCard(png, 20, 20, W - 40, H - 40, { radius: 26 });

  drawTextCentered(png, 'HOW TO REPORT A USER', W / 2, 44, 4, SURF.ink);
  drawTextCentered(png, 'FIVE STEPS FROM COMMAND TO SUBMITTED', W / 2, 44 + 4 * GLYPH_H + 14, 2, LIGHT.purpleLight);
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, 130, accent, 0.3);

  const colW = (W - 80) / STEPS.length;
  const iconY = 250;

  STEPS.forEach((step, i) => {
    const cx = 40 + colW * i + colW / 2;

    ringStroke(png, cx, iconY, 52, accent, 3);
    dotBlend(png, cx, iconY, 47, accent, 0.12);
    step.icon(png, cx, iconY, 26, accent);

    dotBlend(png, cx, iconY - 84, 16, accent, 0.3);
    drawTextCentered(png, `${i + 1}`, cx, iconY - 92, 2, SURF.ink);

    drawTextCentered(png, step.title, cx, iconY + 78, 1, SURF.ink);
    const lines = wrapText(step.desc, 1, colW - 24);
    let ly = iconY + 100;
    for (const line of lines) {
      drawTextCentered(png, line, cx, ly, 1, SURF.grey1);
      ly += GLYPH_H + 6;
    }

    if (i < STEPS.length - 1) {
      const nextCx = 40 + colW * (i + 1) + colW / 2;
      for (let x = cx + 60; x < nextCx - 60; x += 10) setPxBlend(png, x, iconY, accent, 0.35);
    }
  });

  drawTextCentered(png, 'ONLY YOU CAN SEE THE PANEL UNTIL YOU HIT SUBMIT', W / 2, H - 56, 1, SURF.grey2);

  return PNG.sync.write(png);
}

module.exports = { generateReportGuideImage };
