'use strict';

/**
 * bankVisual.js
 *
 * Two visuals for the consolidated /bank panel, in the same flat-
 * glassmorphism house style as the welcome card — a gold "wealth" accent
 * instead of jade/amber, with the member's real avatar composited into a
 * circle: `generateBankCardImage` for the account view (your own account,
 * or checking another member's), and `generateLeaderboardImage` for the
 * top-richest ranking. Both are generated fresh per interaction since they
 * bake in live per-account data — not seeded as static dynamic-embed
 * templates like nyse-open/risk-guide/....
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, textWidth, GLYPH_H,
} = require('./pixelArt');
const { drawAvatarCircle } = require('./avatarUtil');

const GOLD  = [241, 196, 15, 255];
const WHITE = [255, 255, 255, 255];
const GOOD  = [46, 204, 113, 255];
const DIM   = [150, 160, 172, 255];

function truncate(text, scale, maxWidth) {
  if (textWidth(text, scale) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}...`, scale) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}

/**
 * @param {object} opts
 * @param {Buffer|null} opts.avatarPng - raw PNG bytes of the account holder's avatar, or null
 * @param {string} opts.username - display name to show
 * @param {number} opts.wallet - wallet balance
 * @param {number} opts.bank - bank balance
 * @param {number} [opts.interestReady] - accrued interest ready to collect (own account only)
 * @param {number} [opts.nextInterestTs] - unix seconds of the next interest drop (own account only, used only for the caption)
 * @param {boolean} [opts.viewingOther] - true when this is "check another user's balance", not your own account
 * @returns {Buffer} PNG image data
 */
function generateBankCardImage(opts) {
  const { avatarPng, username, wallet, bank, interestReady = 0, viewingOther = false } = opts;
  const W = 1000, H = 460;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  flatBg(png, [16, 14, 8, 255]);
  ringStroke(png, W - 60, 60, 140, GOLD, 3);
  ringStroke(png, W - 60, 60, 190, GOLD, 2);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: GOLD, tintAlpha: 0.06, border: GOLD, borderAlpha: 0.4 });

  // ── Avatar circle, left ────────────────────────────────────────────────────
  const acx = 190, acy = 230, aradius = 108;
  dotBlend(png, acx, acy, aradius + 22, GOLD, 0.12);
  drawAvatarCircle(png, acx, acy, aradius, avatarPng, (username[0] || '?').toUpperCase(), GOLD);
  ringStroke(png, acx, acy, aradius + 6, GOLD, 5);

  // ── Header, right ──────────────────────────────────────────────────────────
  const contentLeft = 360, contentRight = W - 44, contentW = contentRight - contentLeft;

  drawText(png, viewingOther ? 'CHECKING BALANCE' : 'YOUR ACCOUNT', contentLeft, 66, 2, GOLD);
  drawText(png, 'BANK', contentLeft, 94, 6, WHITE);
  drawText(png, truncate(username, 4, contentW), contentLeft, 152, 4, GOLD);

  for (let x = contentLeft; x < contentRight; x++) setPxBlend(png, x, 206, GOLD, 0.3);

  // ── Chips: wallet / bank / total ─────────────────────────────────────────────
  const total = wallet + bank;
  const chipY = 228, chipH = 56, gap = 14;
  const chips = [
    { label: 'WALLET', value: wallet },
    { label: 'BANK', value: bank },
    { label: 'TOTAL', value: total },
  ];
  const chipW = (contentW - gap * 2) / 3;
  chips.forEach((c, i) => {
    const cx = contentLeft + i * (chipW + gap);
    fillRoundedRectBlend(png, cx, chipY, chipW, chipH, 10, WHITE, 0.08);
    drawText(png, c.label, cx + 14, chipY + 10, 1, DIM);
    drawText(png, c.value.toLocaleString(), cx + 14, chipY + 24, 2, i === 2 ? GOLD : WHITE);
  });

  // ── Interest status line (own account only) ─────────────────────────────────
  if (!viewingOther) {
    const statusY = chipY + chipH + 26;
    const statusText = interestReady > 0
      ? `+${interestReady.toLocaleString()} COINS INTEREST READY TO COLLECT`
      : 'INTEREST ACCRUES 2% EVERY 12 HOURS';
    drawText(png, statusText, contentLeft, statusY, 2, interestReady > 0 ? GOOD : DIM);
  }

  return PNG.sync.write(png);
}

/**
 * @param {object} opts
 * @param {Array<{avatarPng: Buffer|null, username: string, balance: number}>} opts.entries - already ranked, richest first, max ~10
 * @param {string} opts.guildName
 * @returns {Buffer} PNG image data
 */
function generateLeaderboardImage(opts) {
  const { entries, guildName } = opts;
  const rows = Math.max(entries.length, 1);
  const rowTop = 156, rowH = 64;
  const W = 1000, H = rowTop + rows * rowH + 40;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  flatBg(png, [16, 14, 8, 255]);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 26, tint: GOLD, tintAlpha: 0.06, border: GOLD, borderAlpha: 0.4 });

  drawTextCentered(png, 'TOP RICHEST MEMBERS', W / 2, 40, 4, WHITE);
  drawTextCentered(png, truncate(guildName.toUpperCase(), 2, W - 120), W / 2, 40 + 4 * GLYPH_H + 14, 2, GOLD);
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, 128, GOLD, 0.3);

  if (entries.length === 0) {
    drawTextCentered(png, 'NO BALANCES YET', W / 2, rowTop + 20, 2, DIM);
  }

  const medalColor = [GOLD, [200, 205, 212, 255], [180, 130, 70, 255]];

  entries.forEach((e, i) => {
    const cy = rowTop + i * rowH + rowH / 2;
    const rankColor = medalColor[i] || DIM;

    drawTextCentered(png, `${i + 1}`, 84, cy - 10, 2, rankColor);
    dotBlend(png, 150, cy, 30, GOLD, 0.12);
    drawAvatarCircle(png, 150, cy, 28, e.avatarPng, (e.username[0] || '?').toUpperCase(), GOLD);
    ringStroke(png, 150, cy, 30, rankColor, 3);

    drawText(png, truncate(e.username.toUpperCase(), 2, 420), 200, cy - 8, 2, WHITE);

    const balText = `${e.balance.toLocaleString()} COINS`;
    const balW = 24 + textWidth(balText, 2);
    fillRoundedRectBlend(png, W - 60 - balW, cy - 20, balW, 40, 10, GOLD, 0.16);
    drawTextCentered(png, balText, W - 60 - balW / 2, cy - 8, 2, GOLD);

    if (i < entries.length - 1) {
      for (let x = 60; x < W - 60; x++) setPxBlend(png, x, rowTop + (i + 1) * rowH, WHITE, 0.05);
    }
  });

  return PNG.sync.write(png);
}

module.exports = { generateBankCardImage, generateLeaderboardImage };
