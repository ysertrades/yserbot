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
const CELL_W = 110, CELL_H = 145, GAP = 12, MARGIN = 22, HEADER_H = 64;
const WHITE = [255, 255, 255, 255];
const GRAY  = [150, 156, 168, 255];

function drawLockIcon(png, cx, cy, size, color) {
  ringStroke(png, cx, cy - size * 0.15, size * 0.4, color, 3);
  fillRoundedRectBlend(png, cx - size * 0.5, cy, size, size * 0.65, 4, color, 0.85);
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
  glassPanel(png, 12, 12, W - 24, H - 24, { radius: 22, tint: [233, 30, 99, 255], tintAlpha: 0.04, border: [233, 30, 99, 255], borderAlpha: 0.3 });

  const ownedTotal = Object.values(ownedCounts).reduce((s, n) => s + (n > 0 ? 1 : 0), 0);
  drawText(png, title.toUpperCase(), MARGIN + 6, 24, 2, WHITE);
  const pct = `${ownedTotal}/${catalog.length}`;
  const pctW = textWidth(pct, 2);
  drawText(png, pct, W - MARGIN - 6 - pctW, 24, 2, [255, 215, 0, 255]);

  const gridTop = MARGIN + HEADER_H;

  catalog.forEach((card, i) => {
    const col = Math.floor(i / ROWS), row = i % ROWS;
    const x = MARGIN + col * (CELL_W + GAP);
    const y = gridTop + row * (CELL_H + GAP);
    const accent = RARITY_ACCENT[card.rarity] || RARITY_ACCENT.common;
    const count = ownedCounts[card.id] || 0;
    const owned = count > 0;

    fillRoundedRectBlend(png, x, y, CELL_W, CELL_H, 10, accent, owned ? 0.12 : 0.04);
    for (let px = x; px < x + CELL_W; px++) {
      setPxBlend(png, px, y, accent, owned ? 0.5 : 0.15);
      setPxBlend(png, px, y + CELL_H - 1, accent, owned ? 0.5 : 0.15);
    }
    for (let py = y; py < y + CELL_H; py++) {
      setPxBlend(png, x, py, accent, owned ? 0.5 : 0.15);
      setPxBlend(png, x + CELL_W - 1, py, accent, owned ? 0.5 : 0.15);
    }

    const cx = x + CELL_W / 2, cy = y + 46;
    ringStroke(png, cx, cy, 28, accent, owned ? 3 : 2);
    if (owned) {
      dotBlend(png, cx, cy, 24, accent, 0.18);
      (EMBLEMS[card.rarity] || EMBLEMS.common)(png, cx, cy, 16, accent);
    } else {
      dotBlend(png, cx, cy, 24, [40, 40, 46, 255], 0.6);
      drawLockIcon(png, cx, cy, 13, [90, 92, 100, 255]);
    }

    if (owned) {
      const lines = wrapText(card.name.toUpperCase(), 1, CELL_W - 12);
      let ty = y + 84;
      for (const l of lines.slice(0, 2)) { drawTextCentered(png, l, cx, ty, 1, WHITE); ty += GLYPH_H + 4; }
    } else {
      drawTextCentered(png, '???', cx, y + 88, 1, GRAY);
    }

    if (count > 1) {
      const badge = `x${count}`;
      const bw = textWidth(badge, 1) + 8;
      fillRoundedRectBlend(png, x + CELL_W - bw - 4, y + 4, bw, 12, 3, accent, 0.9);
      drawText(png, badge, x + CELL_W - bw, y + 6, 1, [20, 18, 26, 255]);
    }
  });

  return PNG.sync.write(png);
}

module.exports = { generateCollectionBoard };
