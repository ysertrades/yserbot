'use strict';

const {
  PNG, setPxBlend, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered,
} = require('./pixelArt');
const { RGBA: LIGHT, RGBA_DARK: DARK, darkCard, fillCanvas } = require('./brandTheme');

// Same "depth of purple/cyan" tiering as fish/mine rarity — a jackpot pull
// is the deepest purple in the family, not a shade the brand book doesn't have.
const TIER_COLOR = {
  dud:     DARK.grey2,
  small:   LIGHT.cyanDeep,
  good:    LIGHT.cyan,
  rare:    LIGHT.purple,
  jackpot: LIGHT.purpleDeep,
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
  fillRoundedRectBlend(png, cx - bodyW / 2 - 4, cy - 9, bodyW + 8, 18, 5, [255, 255, 255, 255], 0.9);
  dot(png, cx, cy + 3, size * 0.22, [255, 255, 255, 255]);
  dot(png, cx, cy + 3, size * 0.1, darker);

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
 * reveal matching the fish/mine card scale and house style. Only reachable
 * with the economy switched on (it's a shop item, and /shop is gated the
 * same as everything else economy), so unlike fish/mine there's no
 * economy-off variant to handle here.
 * @param {{tier: string, reward: number}} data
 * @returns {Buffer} PNG image data
 */
function generateMysteryBoxImage(data) {
  const { tier, reward } = data;
  const color = TIER_COLOR[tier] || TIER_COLOR.small;

  const W = 640, H = 620;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const panelRadius = 22;

  fillCanvas(png, DARK.bg);
  darkCard(png, 0, 0, W, H, { radius: panelRadius });

  // Starfield texture — scattered low-alpha dots, not a gradient.
  for (let i = 0; i < 90; i++) {
    const sx = 20 + ((i * 137) % (W - 40));
    const sy = 20 + ((i * 271 + i * i * 7) % (H - 40));
    const a = 0.05 + ((i * 53) % 10) / 100;
    setPxBlend(png, sx, sy, [255, 255, 255, 255], a);
  }

  drawText(png, 'MYSTERY BOX', 30, 26, 2, DARK.grey1);

  const cx = W / 2, cy = 250;
  ringStroke(png, cx, cy, 130, color, 4);
  dotBlend(png, cx, cy, 118, color, 0.16);
  drawChestIcon(png, cx, cy, 58, color);

  const label = TIER_LABEL[tier] || tier.toUpperCase();
  drawTextCentered(png, label, cx, cy + 165, 2, color);

  drawTextCentered(png, fmtCoins(reward), cx, cy + 200, 4, LIGHT.cyan);

  return PNG.sync.write(png);
}

module.exports = { generateMysteryBoxImage, TIER_COLOR, drawChestIcon };
