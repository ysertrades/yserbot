'use strict';

/**
 * leaderboardVisual.js — Top-10 XP board in QuantLab dark Phantom style.
 * Top 3 podium with real Discord avatars (community-style cards).
 * Ranks 4–10 as a clean list with avatars + XP bars.
 */

const {
  PNG, setPxBlend,
  drawText, drawTextCentered, textWidth, fillRoundedRectBlend, ringStroke, GLYPH_H,
} = require('./pixelArt');
const { RGBA: LIGHT, RGBA_DARK: DARK, darkCard, fillCanvas } = require('./brandTheme');
const { drawAvatarCircle } = require('./avatarUtil');

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
  const raw = String(name || 'Unknown');
  while (scale > minScale && textWidth(raw.toUpperCase(), scale) > maxW) scale -= 1;
  let out = raw;
  while (textWidth(out.toUpperCase(), scale) > maxW && out.length > 3) {
    out = out.slice(0, out.length - 1);
  }
  if (out !== raw && out.length > 2) out = out.slice(0, -1) + '.';
  return { text: out, scale };
}

function ringColor(rank) {
  if (rank === 1) return LIGHT.purple;
  if (rank === 2) return LIGHT.cyan;
  if (rank === 3) return LIGHT.sky;
  return LIGHT.purple;
}

/** Simple crown glyph above #1 avatar */
function drawCrown(png, cx, cy, color) {
  for (let x = -18; x <= 18; x++) {
    for (let y = 8; y <= 14; y++) setPxBlend(png, cx + x, cy + y, color, 0.95);
  }
  const peaks = [[-14, 8], [0, 8], [14, 8]];
  for (const [px, py] of peaks) {
    for (let t = 0; t <= 12; t++) {
      const w = Math.max(1, 6 - Math.floor(t / 2));
      for (let dx = -w; dx <= w; dx++) {
        setPxBlend(png, cx + px + dx, cy + py - t, color, 0.95);
      }
    }
    setPxBlend(png, cx + px, cy + py - 14, color, 1);
  }
}

/**
 * @param {{
 *   entries: { rank: number, name: string, level: number, totalXp: number, avatarPng?: object|null }[],
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
  const headerH = 70;
  const podiumH = 340;
  const listRowH = 56;
  const listCount = Math.max(0, entries.length - 3);
  const H = 24 + headerH + podiumH + (listCount > 0 ? 40 + listCount * listRowH + 20 : 20) + 24;

  const png = new PNG({ width: W, height: H, colorType: 6 });
  fillCanvas(png, DARK.bg);
  darkCard(png, 14, 14, W - 28, H - 28, { radius: 28 });

  drawText(png, title, 44, 36, 3, TEXT);
  drawText(png, subtitle, 44, 36 + 3 * GLYPH_H + 10, 2, MUTED);
  for (let x = 44; x < W - 44; x++) setPxBlend(png, x, 28 + headerH, LIGHT.purple, 0.4);

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3, 10);

  const podiumY = 28 + headerH + 18;
  const cardW = 340;
  const gap = 24;
  const totalW = cardW * 3 + gap * 2;
  const startX = Math.round((W - totalW) / 2);

  const slots = [
    { rank: 2, x: startX, y: podiumY + 28, h: 290 },
    { rank: 1, x: startX + cardW + gap, y: podiumY, h: 318 },
    { rank: 3, x: startX + (cardW + gap) * 2, y: podiumY + 28, h: 290 },
  ];

  for (const slot of slots) {
    const entry = top3.find(e => e.rank === slot.rank);
    if (!entry) continue;
    const accent = ringColor(slot.rank);
    const isFirst = slot.rank === 1;

    fillRoundedRectBlend(png, slot.x, slot.y, cardW, slot.h, 22, isFirst ? DARK.raised : DARK.card, 1);

    if (isFirst) {
      for (let i = 0; i < 3; i++) {
        const a = 0.45 - i * 0.12;
        for (let x = slot.x + 8; x < slot.x + cardW - 8; x++) {
          setPxBlend(png, x, slot.y + i, LIGHT.purple, a);
          setPxBlend(png, x, slot.y + slot.h - 1 - i, LIGHT.purple, a * 0.5);
        }
        for (let y = slot.y + 8; y < slot.y + slot.h - 8; y++) {
          setPxBlend(png, slot.x + i, y, LIGHT.purple, a * 0.6);
          setPxBlend(png, slot.x + cardW - 1 - i, y, LIGHT.purple, a * 0.6);
        }
      }
    }

    // Rank number top-left only — never on the avatar
    drawText(png, String(slot.rank), slot.x + 18, slot.y + 16, 2, isFirst ? LIGHT.purple : MUTED);

    const avR = isFirst ? 58 : 50;
    const avCx = slot.x + cardW / 2;
    const avCy = slot.y + (isFirst ? 100 : 88);

    if (isFirst) drawCrown(png, avCx, avCy - avR - 22, LIGHT.purple);

    ringStroke(png, avCx, avCy, avR + 4, accent, isFirst ? 4 : 3);
    drawAvatarCircle(
      png, avCx, avCy, avR,
      entry.avatarPng || null,
      initials(entry.name).slice(0, 1),
      accent,
    );

    const nameY = avCy + avR + 22;
    const fitted = fitName(entry.name, cardW - 48, 2, 1);
    drawTextCentered(png, fitted.text, avCx, nameY, fitted.scale, TEXT);

    const xpStr = fmt(entry.totalXp);
    let xs = isFirst ? 5 : 4;
    while (xs > 2 && textWidth(xpStr, xs) > cardW - 40) xs -= 1;
    const xpY = nameY + fitted.scale * GLYPH_H + 18;
    drawTextCentered(png, xpStr, avCx, xpY, xs, TEXT);
    drawTextCentered(png, 'XP', avCx, xpY + xs * GLYPH_H + 10, 2, MUTED);

    const lvl = `LV ${entry.level}`;
    const lvlW = textWidth(lvl, 1) + 20;
    const lvlY = xpY + xs * GLYPH_H + 10 + 2 * GLYPH_H + 12;
    fillRoundedRectBlend(png, avCx - lvlW / 2, lvlY, lvlW, 22, 11, accent, 0.22);
    drawTextCentered(png, lvl, avCx, lvlY + 6, 1, accent);
  }

  if (rest.length) {
    const listTop = podiumY + podiumH + 4;
    drawText(png, 'RANKS 4-10', 44, listTop, 2, DIM);

    const maxXp = Math.max(...entries.map(e => e.totalXp || 0), 1);
    const rowX = 36;
    const rowW = W - 72;

    rest.forEach((entry, i) => {
      const y = listTop + 28 + i * listRowH;
      fillRoundedRectBlend(png, rowX, y, rowW, listRowH - 10, 14, DARK.raised, 1);

      drawText(png, String(entry.rank).padStart(2, ' '), rowX + 16, y + 16, 2, MUTED);

      const avCx = rowX + 78;
      const avCy = y + (listRowH - 10) / 2;
      const avR = 18;
      ringStroke(png, avCx, avCy, avR + 2, LIGHT.purple, 2);
      drawAvatarCircle(
        png, avCx, avCy, avR,
        entry.avatarPng || null,
        initials(entry.name).slice(0, 1),
        LIGHT.purple,
      );

      const fitted = fitName(entry.name, 260, 2, 1);
      drawText(png, fitted.text, avCx + avR + 14, y + 16, fitted.scale, TEXT);

      drawText(png, `LV ${entry.level}`, rowX + 420, y + 16, 2, MUTED);

      const barX = rowX + 540;
      const barW = 280;
      const barH = 12;
      const barY = y + 18;
      fillRoundedRectBlend(png, barX, barY, barW, barH, 6, DARK.border, 1);
      const pct = Math.max(0.04, Math.min(1, (entry.totalXp || 0) / maxXp));
      fillRoundedRectBlend(png, barX, barY, Math.round(barW * pct), barH, 6, LIGHT.purple, 0.9);

      const xpStr = fmt(entry.totalXp);
      drawText(png, xpStr, rowX + rowW - 18 - textWidth(xpStr, 2), y + 16, 2, TEXT);
    });
  }

  return PNG.sync.write(png);
}

module.exports = { generateLeaderboardImage };
