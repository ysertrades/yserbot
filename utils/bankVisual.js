'use strict';

/**
 * bankVisual.js
 *
 * Two visuals for the consolidated /bank panel, in QuantLab's dark Phantom
 * house style — purple "wealth" accent (economy's own colour, matching the
 * embed catalogue), with the member's real avatar composited into a
 * circle: `generateBankCardImage` for the account view (your own account,
 * or checking another member's), and `generateLeaderboardImage` for the
 * top-richest ranking. Both are generated fresh per interaction since they
 * bake in live per-account data — not seeded as static dynamic-embed
 * templates like nyse-open/risk-guide/....
 *
 * The leaderboard's podium reads as depth of purple (1st deepest, 3rd
 * lightest) rather than gold/silver/bronze — the same "significance
 * deepens the colour" idea used for rank tiers and moderation severity.
 */

const {
  PNG, setPxBlend, dotBlend, ringStroke,
  fillRoundedRectBlend, drawText, drawTextCentered, textWidth, GLYPH_H,
} = require('./pixelArt');
const { drawAvatarCircle } = require('./avatarUtil');
const { RGBA: LIGHT, RGBA_DARK: DARK, darkCard, fillCanvas } = require('./brandTheme');

const ACCENT = LIGHT.purple;
const TEXT   = DARK.ink;
const SUBTLE = DARK.grey1;
const GOOD   = LIGHT.cyan; // "interest ready" reads as cyan, not neon green

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
 * @param {number} [opts.interestPercent] - the guild's configured interest rate per period (defaults to the shipped 2%)
 * @param {number} [opts.periodHours] - the guild's configured period length in hours (defaults to the shipped 12h)
 * @returns {Buffer} PNG image data
 */
function generateBankCardImage(opts) {
  const {
    avatarPng, username, wallet, bank, interestReady = 0, viewingOther = false,
    interestPercent = 2, periodHours = 12,
  } = opts;
  const W = 1000, H = 460;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  fillCanvas(png, DARK.bg);
  ringStroke(png, W - 60, 60, 140, ACCENT, 3);
  ringStroke(png, W - 60, 60, 190, ACCENT, 2);
  darkCard(png, 20, 20, W - 40, H - 40, { radius: 28 });

  // ── Avatar circle, left ────────────────────────────────────────────────────
  const acx = 190, acy = 230, aradius = 108;
  dotBlend(png, acx, acy, aradius + 22, ACCENT, 0.14);
  drawAvatarCircle(png, acx, acy, aradius, avatarPng, (username[0] || '?').toUpperCase(), ACCENT);
  ringStroke(png, acx, acy, aradius + 6, ACCENT, 5);

  // ── Header, right ──────────────────────────────────────────────────────────
  const contentLeft = 360, contentRight = W - 44, contentW = contentRight - contentLeft;

  drawText(png, viewingOther ? 'CHECKING BALANCE' : 'YOUR ACCOUNT', contentLeft, 66, 2, ACCENT);
  drawText(png, 'BANK', contentLeft, 94, 6, TEXT);
  drawText(png, truncate(username, 4, contentW), contentLeft, 152, 4, ACCENT);

  for (let x = contentLeft; x < contentRight; x++) setPxBlend(png, x, 206, ACCENT, 0.35);

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
    fillRoundedRectBlend(png, cx, chipY, chipW, chipH, 10, DARK.raised, 1);
    drawText(png, c.label, cx + 14, chipY + 10, 1, SUBTLE);
    drawText(png, c.value.toLocaleString(), cx + 14, chipY + 24, 2, i === 2 ? ACCENT : TEXT);
  });

  // ── Interest status line (own account only) ─────────────────────────────────
  if (!viewingOther) {
    const statusY = chipY + chipH + 26;
    const statusText = interestReady > 0
      ? `+${interestReady.toLocaleString()} COINS INTEREST READY TO COLLECT`
      : `INTEREST ACCRUES ${interestPercent}% EVERY ${periodHours} HOUR${periodHours === 1 ? '' : 'S'}`;
    drawText(png, statusText, contentLeft, statusY, 2, interestReady > 0 ? GOOD : SUBTLE);
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

  fillCanvas(png, DARK.bg);
  darkCard(png, 20, 20, W - 40, H - 40, { radius: 26 });

  drawTextCentered(png, 'TOP RICHEST MEMBERS', W / 2, 40, 4, TEXT);
  drawTextCentered(png, truncate(guildName.toUpperCase(), 2, W - 120), W / 2, 40 + 4 * GLYPH_H + 14, 2, ACCENT);
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, 128, ACCENT, 0.35);

  if (entries.length === 0) {
    drawTextCentered(png, 'NO BALANCES YET', W / 2, rowTop + 20, 2, SUBTLE);
  }

  // Podium as depth of purple — 1st deepest, 3rd lightest — rather than
  // gold/silver/bronze.
  const medalColor = [LIGHT.purpleDeep, LIGHT.purple, LIGHT.purpleLight];

  entries.forEach((e, i) => {
    const cy = rowTop + i * rowH + rowH / 2;
    const rankColor = medalColor[i] || DARK.grey2;

    drawTextCentered(png, `${i + 1}`, 84, cy - 10, 2, rankColor);
    dotBlend(png, 150, cy, 30, ACCENT, 0.14);
    drawAvatarCircle(png, 150, cy, 28, e.avatarPng, (e.username[0] || '?').toUpperCase(), ACCENT);
    ringStroke(png, 150, cy, 30, rankColor, 3);

    drawText(png, truncate(e.username.toUpperCase(), 2, 420), 200, cy - 8, 2, TEXT);

    const balText = `${e.balance.toLocaleString()} COINS`;
    const balW = 24 + textWidth(balText, 2);
    fillRoundedRectBlend(png, W - 60 - balW, cy - 20, balW, 40, 10, ACCENT, 0.2);
    drawTextCentered(png, balText, W - 60 - balW / 2, cy - 8, 2, ACCENT);

    if (i < entries.length - 1) {
      for (let x = 60; x < W - 60; x++) setPxBlend(png, x, rowTop + (i + 1) * rowH, DARK.border, 1);
    }
  });

  return PNG.sync.write(png);
}

module.exports = { generateBankCardImage, generateLeaderboardImage };
