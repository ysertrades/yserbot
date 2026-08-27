'use strict';

/**
 * shopVisual.js
 *
 * Renders the /shop panel's banner — house-style branding + a row of
 * category icons (reusing badge/chest icon drawers so the whole shop
 * family shares one visual language). The live, current item list stays
 * as embed text/fields alongside this image, since that's admin-editable
 * data (/shopsettings) that needs to always read correctly, not baked
 * pixel art that would go stale the moment a price changes.
 *
 * QuantLab dark Phantom house style. Category icons keep their own
 * distinguishing colour — same "brand family, distinct shades" rule as the
 * jobs hub — rather than the shopping-mall rainbow this used to be.
 */

const { PNG, drawTextCentered, dot, dotBlend, ringStroke, line, GLYPH_H } = require('./pixelArt');
const { BADGE_DEFS } = require('./badges');
const { drawChestIcon } = require('./mysteryBoxVisual');
const { RGBA: LIGHT, RGBA_DARK: DARK, darkCard, fillCanvas } = require('./brandTheme');

function drawCoinIcon(png, cx, cy, size, color) {
  dot(png, cx, cy, size, color);
  ringStroke(png, cx, cy, size * 0.62, [255, 255, 255, 200], 2);
  line(png, cx - size * 0.22, cy, cx + size * 0.22, cy, [255, 255, 255, 230], 3);
  line(png, cx, cy - size * 0.22, cx, cy + size * 0.22, [255, 255, 255, 230], 3);
}

const CATEGORIES = [
  { label: 'BOOSTS',  color: LIGHT.cyan,       icon: (p, x, y) => drawCoinIcon(p, x, y, 24, LIGHT.cyan) },
  { label: 'BADGES',  color: LIGHT.purple,     icon: (p, x, y) => BADGE_DEFS.star.draw(p, x, y, 19, LIGHT.purple) },
  { label: 'MYSTERY', color: LIGHT.purpleDeep, icon: (p, x, y) => drawChestIcon(p, x, y, 20, LIGHT.purpleDeep) },
  { label: 'VIP',     color: LIGHT.purpleLight, icon: (p, x, y) => BADGE_DEFS.crown.draw(p, x, y, 19, LIGHT.purpleLight) },
];

/**
 * @param {{itemCount: number}} data
 * @returns {Buffer} PNG image data
 */
function generateShopBanner(data) {
  const { itemCount } = data;
  const W = 900, H = 280;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  fillCanvas(png, DARK.bg);
  darkCard(png, 20, 20, W - 40, H - 40, { radius: 24 });

  drawTextCentered(png, 'SERVER SHOP', W / 2, 40, 5, DARK.ink);
  drawTextCentered(png, `${itemCount} ITEM${itemCount !== 1 ? 'S' : ''} AVAILABLE`, W / 2, 40 + 5 * GLYPH_H + 14, 2, DARK.grey1);

  const gap = 190;
  const startX = W / 2 - gap * 1.5;
  const iy = H - 92;
  CATEGORIES.forEach((c, i) => {
    const cx = startX + i * gap;
    ringStroke(png, cx, iy, 38, c.color, 3);
    dotBlend(png, cx, iy, 34, c.color, 0.14);
    c.icon(png, cx, iy);
    drawTextCentered(png, c.label, cx, iy + 50, 1, DARK.grey1);
  });

  return PNG.sync.write(png);
}

module.exports = { generateShopBanner };
