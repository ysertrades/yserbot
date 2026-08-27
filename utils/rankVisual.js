'use strict';

/**
 * rankVisual.js
 *
 * Renders /rank as a PNG in QuantLab's dark Phantom house style — level, XP
 * progress, and stats live in the image itself. Equipped badges
 * (utils/badgeManager.js) render into three fixed slots so a purchased
 * badge always lands in a consistent, "designed for it" spot rather than
 * being appended ad hoc.
 *
 * Tier reads as depth of purple — the same "significance deepens the
 * colour" rule used for moderation severity elsewhere in the bot — rather
 * than the old gold/purple/blue/green spread, so a level card belongs to
 * the same visual family as everything else instead of reaching outside it.
 */

const {
  PNG, setPxBlend,
  drawText, drawTextCentered, textWidth, fillRoundedRectBlend, ringStroke, dotBlend, GLYPH_H,
} = require('./pixelArt');
const { BADGE_DEFS } = require('./badges');
const { RGBA: LIGHT, RGBA_DARK: DARK, darkCard, fillCanvas } = require('./brandTheme');

const TEXT = DARK.ink;
const SUBTLE = DARK.grey1;
const BADGE_SLOTS = 3;
const EMPTY_SLOT_COLOR = DARK.border;

function tierColor(level) {
  if (level >= 50) return LIGHT.purpleDeep;   // legendary — deepest purple
  if (level >= 25) return LIGHT.purple;       // veteran
  if (level >= 10) return LIGHT.cyan;         // established
  return LIGHT.sky;                           // rising
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
  fillCanvas(png, DARK.bg);

  darkCard(png, 20, 20, W - 40, H - 40, { radius: 26 });

  // Header — username left, level badge right
  drawText(png, username.toUpperCase().slice(0, 22), 56, 46, 3, TEXT);
  drawText(png, 'TRADER RANK', 56, 46 + 3 * GLYPH_H + 10, 2, SUBTLE);

  const levelLabel = `LEVEL ${level}`;
  const lvlScale = 5;
  drawText(png, levelLabel, W - 56 - textWidth(levelLabel, lvlScale), 38, lvlScale, accent);

  for (let x = 56; x < W - 56; x++) setPxBlend(png, x, 112, accent, 0.35);

  // XP progress bar
  const barX = 56, barY = 150, barW = W - 112, barH = 40;
  fillRoundedRectBlend(png, barX, barY, barW, barH, barH / 2, DARK.raised, 1);
  const pct = neededXp > 0 ? Math.max(0, Math.min(1, xp / neededXp)) : 0;
  const fillW = Math.max(barH, Math.round(barW * pct));
  fillRoundedRectBlend(png, barX, barY, fillW, barH, barH / 2, accent, 0.9);
  drawTextCentered(png, `${fmt(xp)} / ${fmt(neededXp)} XP`, W / 2, barY + barH / 2 - 3, 2, TEXT);

  // Stat cards
  const cardY = barY + barH + 40, cardH = 92;
  const cardW = (W - 112 - 28) / 2;
  const cards = [
    { x: 56, label: 'TOTAL XP', value: fmt(totalXp) },
    { x: 56 + cardW + 28, label: 'MESSAGES', value: fmt(messages) },
  ];
  for (const c of cards) {
    fillRoundedRectBlend(png, c.x, cardY, cardW, cardH, 16, DARK.raised, 1);
    drawText(png, c.label, c.x + 22, cardY + 20, 2, SUBTLE);
    drawText(png, c.value, c.x + 22, cardY + 20 + 2 * GLYPH_H + 12, 3, TEXT);
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
      dotBlend(png, cx, badgeY, 30, color, 0.14);
      def?.draw(png, cx, badgeY, 17, color);
      drawTextCentered(png, equipped.label.toUpperCase().slice(0, 14), cx, badgeY + 48, 1, SUBTLE);
    } else {
      ringStroke(png, cx, badgeY, 34, EMPTY_SLOT_COLOR, 2);
      dotBlend(png, cx, badgeY, 3, EMPTY_SLOT_COLOR, 1);
      drawTextCentered(png, 'EMPTY', cx, badgeY + 48, 1, DARK.grey2);
    }
  }

  return PNG.sync.write(png);
}

module.exports = { generateRankImage, tierColor };
