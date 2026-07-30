'use strict';

/**
 * giveawayVisual.js
 *
 * A large, bold banner for casino-coin giveaways — a jackpot-style hero
 * image (spotlight rays, a giant poker-chip coin, flanking chip stacks,
 * scattered sparkles) instead of a plain text embed.
 */

const {
  PNG, setPxBlend, line, dot, dotBlend, ringStroke,
  flatBg, glassPanel, GLYPH_H, drawTextCentered, textWidth,
} = require('./pixelArt');
const { drawAvatarCircle } = require('./avatarUtil');

const GOLD    = [255, 215, 0, 255];
const GOLD_DK = [180, 140, 20, 255];
const RED     = [220, 60, 60, 255];
const GREEN   = [40, 180, 100, 255];
const CREAM   = [255, 244, 214, 255];
const BG      = [12, 16, 14, 255];

function star(png, cx, cy, size, color, alpha = 1) {
  const spikes = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [dx, dy] of spikes) line(png, cx, cy, cx + dx * size, cy + dy * size, color, 2);
  dotBlend(png, cx, cy, Math.max(1, size * 0.22), color, alpha);
}

// Starburst of radiating lines behind the coin, fading with distance from center.
function spotlightRays(png, cx, cy, innerR, outerR, color, count = 28) {
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2;
    const x1 = cx + Math.cos(ang) * innerR, y1 = cy + Math.sin(ang) * innerR;
    const x2 = cx + Math.cos(ang) * outerR, y2 = cy + Math.sin(ang) * outerR;
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      const alpha = 0.22 * (1 - t);
      dotBlend(png, x, y, 2, color, alpha);
    }
  }
}

// A big coin drawn like a poker chip: alternating rim segments, an inner
// face, and a bold "$" through the middle — reads as "casino coin" at a glance.
function jackpotCoin(png, cx, cy, r) {
  dotBlend(png, cx, cy + 6, r + 6, [0, 0, 0, 255], 0.35); // soft ground shadow/depth
  dot(png, cx, cy, r, GOLD);
  ringStroke(png, cx, cy, r, GOLD_DK, 5);

  const segs = 16;
  for (let i = 0; i < segs; i++) {
    if (i % 2 !== 0) continue;
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    for (let t = 0; t <= 1; t += 0.05) {
      const ang = a0 + (a1 - a0) * t;
      for (let rr = r - 10; rr <= r - 2; rr++) {
        dot(png, cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, 2, RED);
      }
    }
  }

  ringStroke(png, cx, cy, r - 16, GOLD_DK, 3);
  dotBlend(png, cx, cy, r - 20, [255, 231, 150, 255], 1);
  drawTextCentered(png, '$', cx, cy - Math.round(3.5 * GLYPH_H), 7, [150, 105, 10, 255]);
}

function chipStack(png, cx, cy, size, colors) {
  colors.forEach((color, i) => {
    const y = cy - i * size * 0.42;
    dot(png, cx, y, size, color);
    ringStroke(png, cx, y, size, [0, 0, 0, 255], 2);
    dotBlend(png, cx, y - size * 0.25, size * 0.22, CREAM, 0.8);
  });
}

const SPARKLE_COLORS = [GOLD, CREAM, [255, 255, 255, 255]];

/**
 * @param {object} [opts]
 * @param {string} [opts.amountLabel] - e.g. "50,000 COINS" — the big prize line
 * @param {string} [opts.subLabel] - e.g. "3 WINNERS • ENTER BELOW"
 * @returns {Buffer} PNG image data
 */
function generateGiveawayBannerImage(opts = {}) {
  const { amountLabel = 'COINS GIVEAWAY', subLabel = 'HIT ENTER FOR YOUR SHOT AT THE JACKPOT' } = opts;

  const W = 1200, H = 500;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  flatBg(png, BG);

  glassPanel(png, 16, 16, W - 32, H - 32, { radius: 30, tint: GOLD, tintAlpha: 0.05, border: GOLD, borderAlpha: 0.45 });

  const cx = W / 2, cy = 172, coinR = 102;
  spotlightRays(png, cx, cy, 50, 220, GOLD, 32);

  // Scattered sparkles/confetti — kept clear of the coin and the text block below it.
  const seedPositions = [
    [90, 55], [140, 150], [230, 90], [1080, 60], [1010, 150], [940, 95],
    [55, 250], [1150, 250], [70, 430], [1130, 430], [150, 460], [1050, 460],
  ];
  seedPositions.forEach(([x, y], i) => star(png, x, y, 9 + (i % 3) * 3, SPARKLE_COLORS[i % SPARKLE_COLORS.length], 0.85));

  chipStack(png, cx - 340, cy + 55, 32, [RED, GOLD, GREEN]);
  chipStack(png, cx + 340, cy + 55, 32, [GREEN, RED, GOLD]);

  jackpotCoin(png, cx, cy, coinR);

  const kickerY = cy + coinR + 32;
  drawTextCentered(png, 'CASINO', W / 2, kickerY, 3, [200, 190, 170, 255]);

  const amountY = kickerY + 3 * GLYPH_H + 16;
  drawTextCentered(png, amountLabel.toUpperCase(), W / 2, amountY, 5, GOLD);

  const dividerY = amountY + 5 * GLYPH_H + 24;
  for (let x = 140; x < W - 140; x++) setPxBlend(png, x, dividerY, GOLD, 0.35);

  drawTextCentered(png, subLabel.toUpperCase(), W / 2, dividerY + 18, 2, CREAM);

  return PNG.sync.write(png);
}

function truncate(text, scale, maxWidth) {
  if (textWidth(text, scale) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}...`, scale) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}

const MAX_SHOWN_AVATARS = 6;

/**
 * The "winners revealed" banner — shown once a coins giveaway ends with at
 * least one entrant. Reuses the same jackpot-coin/spotlight/sparkle language
 * as the launch banner so the two read as one continuous story.
 * @param {object} opts
 * @param {Array<{avatarPng: Buffer|null, username: string}>} opts.winners
 * @param {number} opts.amountEach - coins auto-credited to each winner
 * @param {number} opts.totalPaid - amountEach * winners.length
 * @returns {Buffer} PNG image data
 */
function generateGiveawayResultImage(opts) {
  const { winners, amountEach, totalPaid } = opts;
  const W = 1200, H = 560;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  flatBg(png, BG);

  glassPanel(png, 16, 16, W - 32, H - 32, { radius: 30, tint: GOLD, tintAlpha: 0.05, border: GOLD, borderAlpha: 0.45 });

  const cx = W / 2;
  spotlightRays(png, cx, 100, 30, 200, GOLD, 28);

  const seedPositions = [
    [80, 50], [1120, 50], [50, 200], [1150, 200], [70, 470], [1130, 470],
    [150, 500], [1050, 500],
  ];
  seedPositions.forEach(([x, y], i) => star(png, x, y, 8 + (i % 3) * 3, SPARKLE_COLORS[i % SPARKLE_COLORS.length], 0.85));

  drawTextCentered(png, 'WINNERS ANNOUNCED', cx, 42, 4, GOLD);

  const shown = winners.slice(0, MAX_SHOWN_AVATARS);
  const extra = winners.length - shown.length;
  const totalSlots = shown.length + (extra > 0 ? 1 : 0);
  const maxRowWidth = W - 220;
  const spacing = totalSlots > 1 ? Math.min(170, maxRowWidth / (totalSlots - 1)) : 0;
  const rowY = 200;
  const startX = cx - ((totalSlots - 1) / 2) * spacing;

  shown.forEach((w, i) => {
    const x = startX + i * spacing;
    ringStroke(png, x, rowY, 58, GOLD, 4);
    drawAvatarCircle(png, x, rowY, 54, w.avatarPng, (w.username || '?')[0].toUpperCase(), GOLD);
    drawTextCentered(png, truncate(w.username.toUpperCase(), 2, spacing - 10), x, rowY + 74, 2, [230, 220, 200, 255]);
  });

  if (extra > 0) {
    const x = startX + shown.length * spacing;
    ringStroke(png, x, rowY, 58, GOLD_DK, 4);
    dotBlend(png, x, rowY, 54, GOLD_DK, 0.3);
    drawTextCentered(png, `+${extra}`, x, rowY - 21, 6, CREAM);
  }

  const amountY = rowY + 74 + 2 * GLYPH_H + 40;
  drawTextCentered(png, `${amountEach.toLocaleString()} COINS EACH`, cx, amountY, 5, GOLD);

  const dividerY = amountY + 5 * GLYPH_H + 24;
  for (let x = 140; x < W - 140; x++) setPxBlend(png, x, dividerY, GOLD, 0.35);

  drawTextCentered(png, `${winners.length} WINNER${winners.length !== 1 ? 'S' : ''} • ${totalPaid.toLocaleString()} COINS PAID OUT`, cx, dividerY + 18, 2, CREAM);

  return PNG.sync.write(png);
}

module.exports = { generateGiveawayBannerImage, generateGiveawayResultImage };
