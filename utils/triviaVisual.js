'use strict';

/**
 * Renders the /trivia question as a PNG — same visual language as
 * riskVisual.js (flat glassmorphism panel, pixel font, no gradients): the
 * question and all four answer choices live in the image, the embed around
 * it stays to a short title/category line.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, hexToRgb,
  drawText, drawTextCentered, wrapText, GLYPH_H,
} = require('./pixelArt');

const CATEGORY_META = {
  trading:   { label: 'TRADING TRIVIA', color: 0x1D9BF0 },
  economics: { label: 'ECONOMICS TRIVIA', color: 0xF59E0B },
  politics:  { label: 'CIVICS TRIVIA', color: 0x9B59B6 },
  sports:    { label: 'SPORTS TRIVIA', color: 0x2ECC71 },
};

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * @param {{category: string, question: string, choices: string[]}} data
 * @returns {Buffer} PNG image data
 */
function generateTriviaImage(data) {
  const { category, question, choices } = data;
  const meta = CATEGORY_META[category] || { label: category.toUpperCase(), color: 0x5865F2 };
  const accent = hexToRgb(meta.color);

  const W = 900, H = 500;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  flatBg(png, [15, 18, 28, 255]);

  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: accent, tintAlpha: 0.05, border: accent, borderAlpha: 0.35 });

  drawTextCentered(png, meta.label, W / 2, 40, 3, accent);
  for (let x = 70; x < W - 70; x++) setPxBlend(png, x, 40 + 3 * GLYPH_H + 14, accent, 0.4);

  const qLines = wrapText(question.toUpperCase(), 3, W - 140);
  let qy = 96;
  for (const line of qLines) {
    drawTextCentered(png, line, W / 2, qy, 3, [255, 255, 255, 255]);
    qy += 3 * GLYPH_H + 10;
  }

  const gridTop = qy + 20;
  const gridH = H - gridTop - 30;
  const cellGap = 20;
  const cellW = (W - 60 - cellGap) / 2;
  const cellH = (gridH - cellGap) / 2;

  choices.forEach((choice, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const cx0 = 30 + col * (cellW + cellGap);
    const cy0 = gridTop + row * (cellH + cellGap);

    glassPanel(png, cx0, cy0, cellW, cellH, { radius: 16, tint: accent, tintAlpha: 0.06, border: accent, borderAlpha: 0.3 });
    drawText(png, LETTERS[i], cx0 + 14, cy0 + 12, 2, accent);

    const choiceLines = wrapText(choice.toUpperCase(), 2, cellW - 50);
    let cy = cy0 + Math.max(14, (cellH - choiceLines.length * (2 * GLYPH_H + 6)) / 2);
    for (const line of choiceLines.slice(0, 3)) {
      drawText(png, line, cx0 + 44, cy, 2, [235, 238, 242, 255]);
      cy += 2 * GLYPH_H + 6;
    }
  });

  return PNG.sync.write(png);
}

module.exports = { generateTriviaImage, CATEGORY_META };
