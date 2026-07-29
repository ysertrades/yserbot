'use strict';

const {
  PNG, setPxBlend, roundedMask, dot, dotBlend, ringStroke, line,
  drawText, drawTextCentered,
} = require('./pixelArt');

const RARITY_COLOR = {
  junk:      [148, 155, 168, 255],
  common:    [180, 140, 100, 255],
  uncommon:  [52, 152, 219, 255],
  rare:      [46, 204, 113, 255],
  legendary: [185, 90, 230, 255],
};

// Faceted gem: a diamond silhouette (rhombus fill) plus a couple of facet
// lines and a corner sparkle for a bit of shine.
function drawGemIcon(png, cx, cy, size, color) {
  const rx = size, ry = size * 1.1;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if (Math.abs(dx) / rx + Math.abs(dy) / ry <= 1) {
        setPxBlend(png, cx + dx, cy + dy, color, 1);
      }
    }
  }
  const facet = [10, 14, 22, 160];
  line(png, cx, cy - ry, cx - rx * 0.5, cy, facet, 2);
  line(png, cx, cy - ry, cx + rx * 0.5, cy, facet, 2);
  line(png, cx - rx * 0.5, cy, cx, cy + ry, facet, 2);
  line(png, cx + rx * 0.5, cy, cx, cy + ry, facet, 2);

  // Sparkle glint, upper-left facet
  const sx = cx - rx * 0.35, sy = cy - ry * 0.4;
  line(png, sx - 10, sy, sx + 10, sy, [255, 255, 255, 255], 2);
  line(png, sx, sy - 10, sx, sy + 10, [255, 255, 255, 255], 2);
}

function fmtCoins(n) {
  return `+${Number(n).toLocaleString('en-US')} COINS`;
}

/**
 * Renders the /mine result as a tall PNG matching the fishing/blackjack
 * visual scale — the find, its rarity, and the reward are drawn into the
 * image itself; the embed around it stays to a title.
 * @param {{name: string, rarity: string, reward: number}} findData
 * @returns {Buffer} PNG image data
 */
function generateMineImage(findData) {
  const { name, rarity, reward } = findData;
  const color = RARITY_COLOR[rarity] || RARITY_COLOR.common;

  const W = 640, H = 620;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const panelRadius = 22;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!roundedMask(W, H, panelRadius, x, y)) continue;
      const band = Math.floor((y / H) * 8);
      const shade = 14 - band;
      setPxBlend(png, x, y, [shade + 10, shade + 8, shade + 8, 255], 1);
    }
  }

  // Rock-strata texture — jagged translucent horizontal bands, not a gradient.
  for (let s = 0; s < 6; s++) {
    const sy = 80 + s * 90;
    for (let x = 15; x < W - 15; x++) {
      const yy = sy + Math.sin((x + s * 55) * 0.045) * 8 + (Math.floor(x / 23) % 2) * 3;
      setPxBlend(png, x, Math.round(yy), [255, 255, 255, 255], 0.04);
    }
  }

  drawText(png, 'MINING', 30, 26, 2, [190, 180, 170, 255]);

  const cx = W / 2, cy = 250;
  ringStroke(png, cx, cy, 130, color, 4);
  dotBlend(png, cx, cy, 118, color, 0.14);
  drawGemIcon(png, cx, cy, 62, color);

  const rarityLabel = rarity.toUpperCase();
  drawTextCentered(png, rarityLabel, cx, cy + 160, 2, color);

  const nameScale = 4;
  drawTextCentered(png, name.toUpperCase(), cx, cy + 195, nameScale, [255, 255, 255, 255]);

  drawTextCentered(png, fmtCoins(reward), cx, cy + 195 + 7 * nameScale + 26, 3, [255, 215, 0, 255]);

  return PNG.sync.write(png);
}

module.exports = { generateMineImage, RARITY_COLOR };
