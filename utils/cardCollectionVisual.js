'use strict';

/**
 * cardCollectionVisual.js
 *
 * Renders a user's /cards collection as a single fixed board — always
 * exactly 3 rows, with columns extending to fit the full card catalog (so
 * the same layout keeps applying no matter the catalog size). Every
 * catalog slot gets a cell: owned cards show their rarity emblem, name,
 * and a duplicate-count badge; unowned slots render as a dim locked
 * silhouette that still hints at the rarity tier waiting behind it — so
 * the board visibly fills in as more cards are collected instead of
 * growing indefinitely with duplicates.
 *
 * Deliberately decoupled from cardsManager.js — the caller passes in the
 * catalog + owned counts as plain data, matching the fishVisual.js /
 * mineVisual.js pattern of visual modules never importing business-logic
 * modules directly.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, GLYPH_H,
} = require('./pixelArt');
const { EMBLEMS, RARITY_ACCENT } = require('./cardVisual');

const ROWS = 3;
const CELL_W = 168, CELL_H = 216, GAP = 18, MARGIN = 28, HEADER_H = 84;
const WHITE = [255, 255, 255, 255];
const GRAY  = [160, 166, 178, 255];

function drawLockIcon(png, cx, cy, size, color) {
  ringStroke(png, cx, cy - size * 0.15, size * 0.4, color, 4);
  fillRoundedRectBlend(png, cx - size * 0.5, cy, size, size * 0.65, 5, color, 0.85);
}

/**
 * @param {object} opts
 * @param {{id:string,name:string,rarity:string}[]} opts.catalog - fixed, ordered card list (e.g. common → mythic)
 * @param {Record<string, number>} opts.ownedCounts - cardId → copies owned
 * @param {string} opts.title - e.g. "USERNAME'S COLLECTION"
 * @returns {Buffer} PNG image data
 */
function generateCollectionBoard({ catalog, ownedCounts, title }) {
  const cols = Math.max(1, Math.ceil(catalog.length / ROWS));
  const W = MARGIN * 2 + cols * CELL_W + (cols - 1) * GAP;
  const H = MARGIN * 2 + HEADER_H + ROWS * CELL_H + (ROWS - 1) * GAP;

  const png = new PNG({ width: W, height: H, colorType: 6 });
  flatBg(png, [14, 13, 20, 255]);
  glassPanel(png, 14, 14, W - 28, H - 28, { radius: 26, tint: [233, 30, 99, 255], tintAlpha: 0.04, border: [233, 30, 99, 255], borderAlpha: 0.3 });

  const ownedTotal = Object.values(ownedCounts).reduce((s, n) => s + (n > 0 ? 1 : 0), 0);
  drawText(png, title.toUpperCase(), MARGIN + 8, 30, 3, WHITE);
  const pct = `${ownedTotal}/${catalog.length}`;
  const pctW = textWidth(pct, 3);
  drawText(png, pct, W - MARGIN - 8 - pctW, 30, 3, [255, 215, 0, 255]);

  const gridTop = MARGIN + HEADER_H;

  catalog.forEach((card, i) => {
    const col = Math.floor(i / ROWS), row = i % ROWS;
    const x = MARGIN + col * (CELL_W + GAP);
    const y = gridTop + row * (CELL_H + GAP);
    const accent = RARITY_ACCENT[card.rarity] || RARITY_ACCENT.common;
    const count = ownedCounts[card.id] || 0;
    const owned = count > 0;

    fillRoundedRectBlend(png, x, y, CELL_W, CELL_H, 12, accent, owned ? 0.12 : 0.04);
    for (let px = x; px < x + CELL_W; px++) {
      setPxBlend(png, px, y, accent, owned ? 0.5 : 0.15);
      setPxBlend(png, px, y + CELL_H - 1, accent, owned ? 0.5 : 0.15);
    }
    for (let py = y; py < y + CELL_H; py++) {
      setPxBlend(png, x, py, accent, owned ? 0.5 : 0.15);
      setPxBlend(png, x + CELL_W - 1, py, accent, owned ? 0.5 : 0.15);
    }

    const cx = x + CELL_W / 2, cy = y + 62;
    ringStroke(png, cx, cy, 40, accent, owned ? 4 : 3);
    if (owned) {
      dotBlend(png, cx, cy, 35, accent, 0.18);
      (EMBLEMS[card.rarity] || EMBLEMS.common)(png, cx, cy, 23, accent);
    } else {
      dotBlend(png, cx, cy, 35, [40, 40, 46, 255], 0.6);
      drawLockIcon(png, cx, cy, 19, [95, 98, 108, 255]);
    }

    if (owned) {
      const lines = wrapText(card.name.toUpperCase(), 2, CELL_W - 16);
      let ty = y + 122;
      for (const l of lines.slice(0, 2)) { drawTextCentered(png, l, cx, ty, 2, WHITE); ty += GLYPH_H * 2 + 8; }
    } else {
      drawTextCentered(png, '???', cx, y + 128, 2, GRAY);
    }

    if (count > 1) {
      const badge = `x${count}`;
      const bw = textWidth(badge, 2) + 12;
      fillRoundedRectBlend(png, x + CELL_W - bw - 6, y + 6, bw, 20, 5, accent, 0.9);
      drawText(png, badge, x + CELL_W - bw, y + 9, 2, [20, 18, 26, 255]);
    }
  });

  return PNG.sync.write(png);
}

module.exports = { generateCollectionBoard };
