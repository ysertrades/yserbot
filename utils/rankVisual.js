'use strict';

/**
 * rankVisual.js
 *
 * Renders /rank as a PNG in the same flat-glassmorphism house style as
 * riskVisual.js/pixelArt.js — level, XP progress, and stats live in the
 * image itself. Equipped badges (utils/badgeManager.js) render into three
 * fixed slots so a purchased badge always lands in a consistent, "designed
 * for it" spot rather than being appended ad hoc.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg,
  drawText, drawTextCentered, textWidth, fillRoundedRectBlend, ringStroke, dotBlend, GLYPH_H,
} = require('./pixelArt');
const { BADGE_DEFS } = require('./badges');

const BADGE_SLOTS = 3;
const EMPTY_SLOT_COLOR = [80, 86, 102, 255];

function tierColor(level) {
  if (level >= 50) return [255, 200, 60, 255];  // gold — legendary
  if (level >= 25) return [176, 106, 230, 255]; // purple — veteran
  if (level >= 10) return [61, 156, 240, 255];  // blue — established
  return [80, 210, 130, 255];                   // green — rising
}

function fmt(n) {
  return Number(n).toLocaleString('en-US');
}

/**
 * @param {{
 *   username: string, level: number, xp: number, neededXp: number,
 *   totalXp: number, messages: number,
 *   equippedBadges: {icon: string, label: string}[],
 * }} data
 * @returns {Buffer} PNG image data
 */
function generateRankImage(data) {
  const { username, level, xp, neededXp, totalXp, messages, equippedBadges = [] } = data;
  const accent = tierColor(level);

  const W = 900, H = 460;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  flatBg(png, [13, 15, 23, 255]);

  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 26, tint: accent, tintAlpha: 0.05, border: accent, borderAlpha: 0.35 });

  // Header — username left, level badge right
  drawText(png, username.toUpperCase().slice(0, 22), 56, 46, 3, [255, 255, 255, 255]);
  drawText(png, 'TRADER RANK', 56, 46 + 3 * GLYPH_H + 10, 2, [150, 158, 172, 255]);

  const levelLabel = `LEVEL ${level}`;
  const lvlScale = 5;
  drawText(png, levelLabel, W - 56 - textWidth(levelLabel, lvlScale), 38, lvlScale, accent);

  for (let x = 56; x < W - 56; x++) setPxBlend(png, x, 112, accent, 0.3);

  // XP progress bar
  const barX = 56, barY = 150, barW = W - 112, barH = 40;
  fillRoundedRectBlend(png, barX, barY, barW, barH, barH / 2, [255, 255, 255], 0.08);
  const pct = neededXp > 0 ? Math.max(0, Math.min(1, xp / neededXp)) : 0;
  const fillW = Math.max(barH, Math.round(barW * pct));
  fillRoundedRectBlend(png, barX, barY, fillW, barH, barH / 2, accent, 0.85);
  drawTextCentered(png, `${fmt(xp)} / ${fmt(neededXp)} XP`, W / 2, barY + barH / 2 - 3, 2, [255, 255, 255, 255]);

  // Stat cards
  const cardY = barY + barH + 40, cardH = 92;
  const cardW = (W - 112 - 28) / 2;
  const cards = [
    { x: 56, label: 'TOTAL XP', value: fmt(totalXp) },
    { x: 56 + cardW + 28, label: 'MESSAGES', value: fmt(messages) },
  ];
  for (const c of cards) {
    glassPanel(png, c.x, cardY, cardW, cardH, { radius: 16, tint: accent, tintAlpha: 0.05, border: accent, borderAlpha: 0.25 });
    drawText(png, c.label, c.x + 22, cardY + 20, 2, [150, 158, 172, 255]);
    drawText(png, c.value, c.x + 22, cardY + 20 + 2 * GLYPH_H + 12, 3, [255, 255, 255, 255]);
  }

  // Badge row — 3 fixed slots so a badge always renders in the same spot
  const badgeY = cardY + cardH + 58;
  const slotGap = 190;
  const startX = W / 2 - slotGap;
  for (let i = 0; i < BADGE_SLOTS; i++) {
    const cx = startX + i * slotGap;
    const equipped = equippedBadges[i];
    if (equipped) {
      const def = BADGE_DEFS[equipped.icon];
      const color = def?.color || accent;
      ringStroke(png, cx, badgeY, 34, color, 3);
      dotBlend(png, cx, badgeY, 30, color, 0.12);
      def?.draw(png, cx, badgeY, 17, color);
      drawTextCentered(png, equipped.label.toUpperCase().slice(0, 14), cx, badgeY + 48, 1, [200, 205, 214, 255]);
    } else {
      ringStroke(png, cx, badgeY, 34, EMPTY_SLOT_COLOR, 2);
      dotBlend(png, cx, badgeY, 3, EMPTY_SLOT_COLOR, 1);
      drawTextCentered(png, 'EMPTY', cx, badgeY + 48, 1, [90, 96, 110, 255]);
    }
  }

  return PNG.sync.write(png);
}

module.exports = { generateRankImage, tierColor };
