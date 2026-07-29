'use strict';

const {
  PNG, setPxBlend, roundedMask, dot, dotBlend, ringStroke, line,
  drawText, drawTextCentered,
} = require('./pixelArt');

const RARITY_COLOR = {
  junk:      [148, 155, 168, 255],
  common:    [46, 204, 113, 255],
  uncommon:  [52, 152, 219, 255],
  rare:      [155, 89, 182, 255],
  legendary: [241, 196, 15, 255],
};

// Simple stylized pixel-fish: an ellipse body, a V-notch tail, a dorsal fin,
// and an eye — recognizable without needing a real sprite/font glyph.
function drawFishIcon(png, cx, cy, size, color) {
  const rx = size, ry = size * 0.55;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx * 0.7; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) {
        setPxBlend(png, cx + dx, cy + dy, color, 1);
      }
    }
  }
  // Tail — two fanned strokes meeting at the body's back edge
  const tailBaseX = cx - rx * 0.75;
  const tailTipX = cx - rx * 1.5;
  line(png, tailBaseX, cy - ry * 0.5, tailTipX, cy - ry * 1.3, color, 6);
  line(png, tailBaseX, cy + ry * 0.5, tailTipX, cy + ry * 1.3, color, 6);
  // Dorsal fin
  line(png, cx - rx * 0.1, cy - ry * 0.85, cx + rx * 0.1, cy - ry * 1.7, color, 5);
  // Eye — dark pupil with a small highlight for a bit of life
  const eyeX = cx + rx * 0.35, eyeY = cy - ry * 0.15, eyeR = Math.max(2, size * 0.09);
  dot(png, eyeX, eyeY, eyeR, [15, 20, 30, 255]);
  dot(png, eyeX + eyeR * 0.3, eyeY - eyeR * 0.3, Math.max(1, eyeR * 0.35), [255, 255, 255, 255]);
}

function fmtCoins(n) {
  return `+${Number(n).toLocaleString('en-US')} COINS`;
}

/**
 * Renders the /fish result as a tall PNG (matching the blackjack card
 * visual's scale/proportions) — the catch, its rarity, and the reward are
 * all drawn into the image itself; the embed around it stays to a title.
 * @param {{name: string, rarity: string, reward: number}} catchData
 * @returns {Buffer} PNG image data
 */
function generateFishImage(catchData) {
  const { name, rarity, reward } = catchData;
  const color = RARITY_COLOR[rarity] || RARITY_COLOR.common;

  const W = 640, H = 620;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const panelRadius = 22;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!roundedMask(W, H, panelRadius, x, y)) continue;
      const depth = y / H; // subtle vertical shift, deeper = darker — still flat bands, no smooth gradient
      const band = Math.floor(depth * 6);
      const shade = 22 - band * 2;
      setPxBlend(png, x, y, [8, shade + 20, shade + 38, 255], 1);
    }
  }

  // Wave texture — layered translucent horizontal bands, not a gradient.
  for (let w = 0; w < 5; w++) {
    const wy = 90 + w * 95 + Math.sin(w) * 10;
    for (let x = 20; x < W - 20; x++) {
      const yy = wy + Math.sin((x + w * 40) * 0.03) * 6;
      setPxBlend(png, x, Math.round(yy), [255, 255, 255, 255], 0.05);
    }
  }

  drawText(png, 'FISHING', 30, 26, 2, [190, 210, 230, 255]);

  const cx = W / 2, cy = 250;
  ringStroke(png, cx, cy, 130, color, 4);
  dotBlend(png, cx, cy, 118, color, 0.14);
  drawFishIcon(png, cx, cy, 70, color);

  const rarityLabel = rarity.toUpperCase();
  drawTextCentered(png, rarityLabel, cx, cy + 160, 2, color);

  const nameScale = 4;
  drawTextCentered(png, name.toUpperCase(), cx, cy + 195, nameScale, [255, 255, 255, 255]);

  drawTextCentered(png, fmtCoins(reward), cx, cy + 195 + 7 * nameScale + 26, 3, [255, 215, 0, 255]);

  return PNG.sync.write(png);
}

module.exports = { generateFishImage, RARITY_COLOR };
