'use strict';

const {
  PNG, setPxBlend, roundedMask, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered,
} = require('./pixelArt');

const TIER_COLOR = {
  dud:     [148, 155, 168, 255],
  small:   [46, 204, 113, 255],
  good:    [52, 152, 219, 255],
  rare:    [155, 89, 182, 255],
  jackpot: [241, 196, 15, 255],
};

const TIER_LABEL = {
  dud:     'JUST SOME COINS',
  small:   'NICE FIND',
  good:    'GREAT PULL',
  rare:    'RARE HAUL',
  jackpot: 'JACKPOT!!!',
};

function darken(c, f = 0.7) {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f), 255];
}

function drawChestIcon(png, cx, cy, size, color) {
  const bodyW = size * 2.0, bodyH = size * 1.15;
  const lidW  = size * 2.1, lidH  = size * 0.6;
  const darker = darken(color);

  fillRoundedRectBlend(png, cx - bodyW / 2, cy, bodyW, bodyH, 10, color, 1);
  fillRoundedRectBlend(png, cx - lidW / 2, cy - lidH, lidW, lidH, 14, darker, 1);
  fillRoundedRectBlend(png, cx - bodyW / 2 - 4, cy - 9, bodyW + 8, 18, 5, [255, 215, 60, 255], 1);
  dot(png, cx, cy + 3, size * 0.22, [255, 215, 60, 255]);
  dot(png, cx, cy + 3, size * 0.1, [45, 34, 10, 255]);

  // Sparkle bursts around the chest — bigger/more for higher tiers, drawn
  // by the caller passing a brighter/rarer color for jackpot pulls.
  const sparkles = [[-1.6, -1.3], [1.7, -1.1], [-1.4, 1.0], [1.5, 1.2]];
  for (const [dx, dy] of sparkles) {
    const sx = cx + dx * size, sy = cy + dy * size;
    line(png, sx - 8, sy, sx + 8, sy, [255, 255, 255, 220], 2);
    line(png, sx, sy - 8, sx, sy + 8, [255, 255, 255, 220], 2);
  }
}

function fmtCoins(n) {
  return `+${Number(n).toLocaleString('en-US')} COINS`;
}

/**
 * Renders the /shop use result for a mystery_box item — a chest-opening
 * reveal matching the fish/mine card scale and house style.
 * @param {{tier: string, reward: number}} data
 * @returns {Buffer} PNG image data
 */
function generateMysteryBoxImage(data) {
  const { tier, reward } = data;
  const color = TIER_COLOR[tier] || TIER_COLOR.small;

  const W = 640, H = 620;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const panelRadius = 22;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!roundedMask(W, H, panelRadius, x, y)) continue;
      setPxBlend(png, x, y, [16, 10, 26, 255], 1);
    }
  }

  // Mystical starfield texture — scattered low-alpha dots, not a gradient.
  for (let i = 0; i < 90; i++) {
    const sx = 20 + ((i * 137) % (W - 40));
    const sy = 20 + ((i * 271 + i * i * 7) % (H - 40));
    const a = 0.05 + ((i * 53) % 10) / 100;
    setPxBlend(png, sx, sy, [255, 255, 255, 255], a);
  }

  drawText(png, 'MYSTERY BOX', 30, 26, 2, [190, 170, 210, 255]);

  const cx = W / 2, cy = 250;
  ringStroke(png, cx, cy, 130, color, 4);
  dotBlend(png, cx, cy, 118, color, 0.14);
  drawChestIcon(png, cx, cy, 58, color);

  const label = TIER_LABEL[tier] || tier.toUpperCase();
  drawTextCentered(png, label, cx, cy + 165, 2, color);

  drawTextCentered(png, fmtCoins(reward), cx, cy + 200, 4, [255, 215, 0, 255]);

  return PNG.sync.write(png);
}

module.exports = { generateMysteryBoxImage, TIER_COLOR };
