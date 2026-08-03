'use strict';

/**
 * cardVisual.js
 *
 * Renders /cards drops and reveals as a tall pixel-art "trading card" in the
 * same flat-glassmorphism house style as /risk and /mine — a rarity-tiered
 * emblem (escalating in complexity from a plain ring at common up to a
 * crown at mythic), a star-pip row, and the card's name/description/flavor
 * baked into the image. Deliberately self-contained (its own rarity/color
 * table) rather than importing from cardsManager.js, matching the existing
 * fishVisual.js/mineVisual.js pattern — cardsManager.js requires this
 * module to attach images to the embeds it builds, so the reverse import
 * would be circular.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, GLYPH_H,
} = require('./pixelArt');
const { artFor } = require('./cardArt');

const RARITY_ACCENT = {
  common:    [158, 158, 158, 255],
  uncommon:  [67, 160, 71, 255],
  rare:      [30, 136, 229, 255],
  epic:      [142, 36, 170, 255],
  legendary: [255, 215, 0, 255],
  mythic:    [255, 23, 68, 255],
};
const WHITE = [255, 255, 255, 255];
const GRAY  = [150, 156, 168, 255];

/* ─── Rarity emblems — escalating visual complexity so a card's tier reads
       at a glance even before the name is revealed ────────────────────── */

function drawCommonEmblem(png, cx, cy, size, color) {
  dotBlend(png, cx, cy, size * 0.55, color, 0.22);
  ringStroke(png, cx, cy, size * 0.55, color, 3);
  dot(png, cx, cy, size * 0.18, color);
}

function drawUncommonEmblem(png, cx, cy, size, color) {
  line(png, cx - size * 0.5, cy + size * 0.15, cx, cy - size * 0.5, color, 5);
  line(png, cx, cy - size * 0.5, cx + size * 0.5, cy + size * 0.15, color, 5);
  line(png, cx - size * 0.28, cy + size * 0.55, cx, cy - size * 0.02, color, 5);
  line(png, cx, cy - size * 0.02, cx + size * 0.28, cy + size * 0.55, color, 5);
}

function drawRareEmblem(png, cx, cy, size, color) {
  const rx = size * 0.5, ry = size * 0.68;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if (Math.abs(dx) / rx + Math.abs(dy) / ry <= 1) setPxBlend(png, cx + dx, cy + dy, color, 1);
    }
  }
  const facet = [20, 18, 28, 160];
  line(png, cx, cy - ry, cx - rx * 0.5, cy, facet, 2);
  line(png, cx, cy - ry, cx + rx * 0.5, cy, facet, 2);
}

function drawEpicEmblem(png, cx, cy, size, color) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push([cx + Math.cos(a) * size * 0.62, cy + Math.sin(a) * size * 0.62]);
  }
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % 6];
    line(png, x1, y1, x2, y2, color, 4);
  }
  dot(png, cx, cy, size * 0.16, color);
}

function drawLegendaryEmblem(png, cx, cy, size, color) {
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    const len = i % 2 === 0 ? size * 0.65 : size * 0.32;
    line(png, cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, color, 4);
  }
  dot(png, cx, cy, size * 0.16, color);
}

function drawMythicEmblem(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.5, cy + size * 0.12, size, size * 0.36, 3, color, 1);
  for (const dx of [-0.4, 0, 0.4]) line(png, cx + dx * size, cy + size * 0.12, cx + dx * size, cy - size * 0.35, color, 4);
  line(png, cx - size * 0.5, cy + size * 0.12, cx - size * 0.15, cy - size * 0.15, color, 3);
  line(png, cx - size * 0.15, cy - size * 0.15, cx + size * 0.15, cy + size * 0.05, color, 3);
  line(png, cx + size * 0.15, cy + size * 0.05, cx + size * 0.5, cy + size * 0.12, color, 3);
  for (const dx of [-0.4, 0, 0.4]) dot(png, cx + dx * size, cy - size * 0.4, size * 0.09, color);
}

const EMBLEMS = {
  common: drawCommonEmblem, uncommon: drawUncommonEmblem, rare: drawRareEmblem,
  epic: drawEpicEmblem, legendary: drawLegendaryEmblem, mythic: drawMythicEmblem,
};

function drawStarRow(png, cx, y, filled, total, color) {
  const spacing = 26;
  const startX = cx - ((total - 1) * spacing) / 2;
  for (let i = 0; i < total; i++) {
    const x = startX + i * spacing;
    if (i < filled) dot(png, x, y, 8, color);
    else ringStroke(png, x, y, 8, color, 2);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.rarity - 'common'|'uncommon'|'rare'|'epic'|'legendary'|'mythic'
 * @param {number} opts.starsFilled - how many of 6 star pips are lit
 * @param {boolean} [opts.mystery] - true for an unclaimed drop (name/desc hidden)
 * @param {boolean} [opts.expired] - true for "nobody grabbed it" (grayscale, mystery layout)
 * @param {string} [opts.name]
 * @param {string} [opts.desc]
 * @param {string} [opts.flavor]
 * @param {string} [opts.art] - the card's own emblem key; falls back to its rarity's
 * @returns {Buffer} PNG image data
 */
function generateCardImage(opts) {
  const { rarity, starsFilled = 0, mystery = false, expired = false, name = '', desc = '', flavor = '', art = null } = opts;
  const W = 520, H = 700;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const accent = expired ? [110, 114, 122, 255] : (RARITY_ACCENT[rarity] || RARITY_ACCENT.common);

  flatBg(png, [15, 13, 20, 255]);
  glassPanel(png, 18, 18, W - 36, H - 36, { radius: 30, tint: accent, tintAlpha: 0.07, border: accent, borderAlpha: 0.45 });
  glassPanel(png, 34, 34, W - 68, H - 68, { radius: 22, tint: accent, tintAlpha: 0.03, border: accent, borderAlpha: 0.2 });

  const headerLabel = expired ? 'VANISHED' : mystery ? 'MYSTERY CARD' : rarity.toUpperCase();
  drawTextCentered(png, headerLabel, W / 2, 56, 3, accent);
  drawStarRow(png, W / 2, 100, starsFilled, 6, accent);

  const cx = W / 2, cy = 260;
  ringStroke(png, cx, cy, 118, accent, 4);
  dotBlend(png, cx, cy, 105, accent, 0.15);
  if (mystery || expired) {
    drawTextCentered(png, '?', cx, cy - 45, 9, accent);
  } else {
    // The card's own emblem when it has one, its rarity's when it does not —
    // an unknown art key costs one card its picture, never the drop.
    const own = artFor(art);
    if (own) own(png, cx, cy, 62, accent);
    else (EMBLEMS[rarity] || drawCommonEmblem)(png, cx, cy, 66, accent);
  }

  if (mystery && !expired) {
    drawTextCentered(png, '???', W / 2, 410, 5, WHITE);
    const lines = wrapText('CAN YOU GRAB IT IN TIME?', 1, W - 140);
    let ty = 470;
    for (const l of lines) { drawTextCentered(png, l, W / 2, ty, 1, GRAY); ty += GLYPH_H + 8; }
  } else if (expired) {
    drawTextCentered(png, 'TOO SLOW', W / 2, 410, 4, accent);
    drawTextCentered(png, 'NOBODY GRABBED IT IN TIME', W / 2, 460, 1, GRAY);
  } else {
    const nameLines = wrapText(name.toUpperCase(), 3, W - 100);
    let ty = 400;
    for (const l of nameLines.slice(0, 2)) { drawTextCentered(png, l, W / 2, ty, 3, WHITE); ty += GLYPH_H * 3 + 10; }

    ty += 14;
    const descLines = wrapText(desc, 1, W - 120);
    for (const l of descLines.slice(0, 2)) { drawTextCentered(png, l, W / 2, ty, 1, GRAY); ty += GLYPH_H + 8; }

    ty += 18;
    for (let x = 70; x < W - 70; x++) setPxBlend(png, x, ty, accent, 0.3);
    ty += 24;
    const flavorLines = wrapText(flavor.replace(/["“”]/g, ''), 1, W - 130);
    for (const l of flavorLines.slice(0, 3)) { drawTextCentered(png, l, W / 2, ty, 1, accent); ty += GLYPH_H + 8; }
  }

  return PNG.sync.write(png);
}

module.exports = { generateCardImage, RARITY_ACCENT, EMBLEMS };
