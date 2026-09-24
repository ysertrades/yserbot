'use strict';

/**
 * leaderboardVisual.js — Top-10 XP board in QuantLab dark Phantom style.
 * Top 3 as podium cards; ranks 4–10 as a clean list. Large PNG for Discord embed.
 */

const {
  PNG, setPxBlend,
  drawText, drawTextCentered, textWidth, fillRoundedRectBlend, ringStroke, dotBlend, GLYPH_H,
} = require('./pixelArt');
const { RGBA: LIGHT, RGBA_DARK: DARK, darkCard, fillCanvas } = require('./brandTheme');

const TEXT = DARK.ink;
const MUTED = DARK.grey1;
const DIM = DARK.grey2;

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function initials(name) {
  const s = String(name || '?').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase() || '?';
}

function fitName(name, maxW, maxScale, minScale = 1) {
  let scale = maxScale;
  const raw = String(name || 'Unknown').toUpperCase();
  while (scale > minScale && textWidth(raw, scale) > maxW) scale -= 1;
  let out = raw;
  while (textWidth(out, scale) > maxW && out.length > 3) {
    out = out.slice(0, out.length - 1);
  }
  if (out !== raw && out.length > 2) out = out.slice(0, -1) + '.';
  return { text: out, scale };
}

function podiumAccent(rank) {
  if (rank === 1) return LIGHT.purple;
  if (rank === 2) return LIGHT.cyan;
  return LIGHT.sky;
}

/**
 * @param {{
 *   entries: { rank: number, name: string, level: number, totalXp: number }[],
 *   title?: string,
 *   subtitle?: string,
 * }} data
 * @returns {Buffer}
 */
function generateLeaderboardImage(data) {
  const entries = (data.entries || []).slice(0, 10);
  const title = (data.title || 'QUANTLAB RANKS').toUpperCase();
  const subtitle = data.subtitle || 'TOP 10 BY XP';

  const W = 1200;
  const topPad = 28;
  const headerH = 72;
  const podiumH = 280;
  const listRowH = 52;
  const listPad = 24;
  const listCount = Math.max(0, entries.length - 3);
  const H = topPad + headerH + podiumH + 20 + (listCount > 0 ? 36 + listCount * listRowH + listPad : listPad) + 28;

  const png = new PNG({ width: W, height: H, colorType: 6 });
  fillCanvas(png, DARK.bg);

  darkCard(png, 16, 16, W - 32, H - 32, { radius: 28 });

  drawText(png, title, 48, 40, 3, TEXT);
  drawText(png, subtitle, 48, 40 + 3 * GLYPH_H + 12, 2, MUTED);

  for (let x = 48; x < W - 48; x++) setPxBlend(png, x, 36 + headerH, LIGHT.purple, 0.45);

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3, 10);

  const podiumY = 36 + headerH + 24;
  const cardW = 320;
  const gap = 28;
  const totalW = cardW * 3 + gap * 2;
  const startX = Math.round((W - totalW) / 2);

  const slots = [
    { rank: 2, x: startX, y: podiumY + 36, h: 220 },
    { rank: 1, x: startX + cardW + gap, y: podiumY, h: 256 },
    { rank: 3, x: startX + (cardW + gap) * 2, y: podiumY + 36, h: 220 },
  ];

  for (const slot of slots) {
    const entry = top3.find(e => e.rank === slot.rank) || top3[slot.rank - 1];
    if (!entry) continue;
    const accent = podiumAccent(slot.rank);
    const raised = slot.rank === 1;

    fillRoundedRectBlend(png, slot.x, slot.y, cardW, slot.h, 22, raised ? DARK.raised : DARK.card, 1);
    if (raised) {
      for (let i = 0; i < 3; i++) {
        for (let x = slot.x + 10; x < slot.x + cardW - 10; x++) {
          setPxBlend(png, x, slot.y + i, accent, 0.35 - i * 0.1);
        }
      }
    }

    const badgeCx = slot.x + cardW / 2;
    const badgeCy = slot.y + 42;
    ringStroke(png, badgeCx, badgeCy, 28, accent, 3);
    dotBlend(png, badgeCx, badgeCy, 24, accent, 0.18);
    drawTextCentered(png, String(slot.rank), badgeCx, badgeCy - 10, 3, accent);

    const avY = badgeCy + 58;
    ringStroke(png, badgeCx, avY, 34, accent, 2);
    dotBlend(png, badgeCx, avY, 30, accent, 0.12);
    drawTextCentered(png, initials(entry.name), badgeCx, avY - 8, 2, TEXT);

    const nameY = avY + 48;
    const fitted = fitName(entry.name, cardW - 40, 2, 1);
    drawTextCentered(png, fitted.text, badgeCx, nameY, fitted.scale, TEXT);

    const lvl = `LV ${entry.level}`;
    const lvlW = textWidth(lvl, 2) + 24;
    const lvlX = badgeCx - lvlW / 2;
    const lvlY = nameY + 2 * GLYPH_H + 14;
    fillRoundedRectBlend(png, lvlX, lvlY, lvlW, 28, 14, accent, 0.25);
    drawTextCentered(png, lvl, badgeCx, lvlY + 7, 2, accent);

    drawTextCentered(png, `${fmt(entry.totalXp)} XP`, badgeCx, lvlY + 40, 2, MUTED);
  }

  if (rest.length) {
    const listTop = podiumY + podiumH + 8;
    drawText(png, 'RANKS 4-10', 48, listTop, 2, DIM);

    const maxXp = Math.max(...entries.map(e => e.totalXp || 0), 1);
    const rowX = 40;
    const rowW = W - 80;

    rest.forEach((entry, i) => {
      const y = listTop + 28 + i * listRowH;
      fillRoundedRectBlend(png, rowX, y, rowW, listRowH - 8, 14, DARK.raised, 1);

      const rk = String(entry.rank).padStart(2, ' ');
      drawText(png, rk, rowX + 18, y + 16, 2, MUTED);

      const chipX = rowX + 70;
      const chipCy = y + (listRowH - 8) / 2;
      ringStroke(png, chipX, chipCy, 16, LIGHT.purple, 2);
      drawTextCentered(png, initials(entry.name), chipX, chipCy - 6, 1, TEXT);

      const fitted = fitName(entry.name, 280, 2, 1);
      drawText(png, fitted.text, chipX + 28, y + 16, fitted.scale, TEXT);

      drawText(png, `LV ${entry.level}`, rowX + 420, y + 16, 2, MUTED);

      const barX = rowX + 540;
      const barW = 280;
      const barH = 14;
      const barY = y + 18;
      fillRoundedRectBlend(png, barX, barY, barW, barH, 7, DARK.border, 1);
      const pct = Math.max(0.04, Math.min(1, (entry.totalXp || 0) / maxXp));
      fillRoundedRectBlend(png, barX, barY, Math.round(barW * pct), barH, 7, LIGHT.purple, 0.85);

      const xpStr = fmt(entry.totalXp);
      drawText(png, xpStr, rowX + rowW - 20 - textWidth(xpStr, 2), y + 16, 2, TEXT);
    });
  }

  return PNG.sync.write(png);
}

module.exports = { generateLeaderboardImage };
