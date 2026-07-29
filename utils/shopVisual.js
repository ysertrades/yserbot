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
 */

const { PNG, glassPanel, flatBg, drawTextCentered, dot, dotBlend, ringStroke, line, GLYPH_H } = require('./pixelArt');
const { BADGE_DEFS } = require('./badges');
const { drawChestIcon } = require('./mysteryBoxVisual');

function drawCoinIcon(png, cx, cy, size, color) {
  dot(png, cx, cy, size, color);
  ringStroke(png, cx, cy, size * 0.62, [255, 255, 255, 200], 2);
  line(png, cx - size * 0.22, cy, cx + size * 0.22, cy, [255, 255, 255, 230], 3);
  line(png, cx, cy - size * 0.22, cx, cy + size * 0.22, [255, 255, 255, 230], 3);
}

const CATEGORIES = [
  { label: 'BOOSTS', color: [255, 215, 0, 255],   icon: (p, x, y) => drawCoinIcon(p, x, y, 24, [255, 215, 0, 255]) },
  { label: 'BADGES', color: [52, 152, 219, 255],  icon: (p, x, y) => BADGE_DEFS.star.draw(p, x, y, 19, [52, 152, 219, 255]) },
  { label: 'MYSTERY', color: [155, 89, 182, 255], icon: (p, x, y) => drawChestIcon(p, x, y, 20, [155, 89, 182, 255]) },
  { label: 'VIP',     color: [241, 196, 15, 255], icon: (p, x, y) => BADGE_DEFS.crown.draw(p, x, y, 19, [241, 196, 15, 255]) },
];

/**
 * @param {{itemCount: number}} data
 * @returns {Buffer} PNG image data
 */
function generateShopBanner(data) {
  const { itemCount } = data;
  const W = 900, H = 280;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const accent = [230, 200, 90, 255];
  flatBg(png, [16, 14, 24, 255]);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 24, tint: accent, tintAlpha: 0.05, border: accent, borderAlpha: 0.35 });

  drawTextCentered(png, 'SERVER SHOP', W / 2, 40, 5, [255, 255, 255, 255]);
  drawTextCentered(png, `${itemCount} ITEM${itemCount !== 1 ? 'S' : ''} AVAILABLE`, W / 2, 40 + 5 * GLYPH_H + 14, 2, [190, 180, 150, 255]);

  const gap = 190;
  const startX = W / 2 - gap * 1.5;
  const iy = H - 92;
  CATEGORIES.forEach((c, i) => {
    const cx = startX + i * gap;
    ringStroke(png, cx, iy, 38, c.color, 3);
    dotBlend(png, cx, iy, 34, c.color, 0.12);
    c.icon(png, cx, iy);
    drawTextCentered(png, c.label, cx, iy + 50, 1, [200, 200, 210, 255]);
  });

  return PNG.sync.write(png);
}

module.exports = { generateShopBanner };
