'use strict';

/**
 * welcomeVisual.js
 *
 * A large "member joined" poster in QuantLab's dark Phantom house style —
 * the member's real Discord avatar composited into a circular frame on the
 * left, with a short, bold greeting on the right. Unlike the static
 * dynamic-embed templates (nyse-open, risk-guide, ...), this one is
 * generated fresh per member since it bakes in per-person data (avatar,
 * name, server, member number), so it's called directly from
 * events/guildMemberAdd.js rather than seeded as a template.
 *
 * New vs. returning reads as cyan vs. purple — the same "accent changes,
 * surface and text don't" rule as every other card, rather than the old
 * green/amber split.
 */

const {
  PNG, setPxBlend, dotBlend, ringStroke,
  fillRoundedRectBlend, drawText, drawTextCentered, textWidth, GLYPH_H,
} = require('./pixelArt');
const { drawAvatarCircle } = require('./avatarUtil');
const { RGBA: LIGHT, RGBA_DARK: DARK, darkCard, fillCanvas } = require('./brandTheme');

const ACCENT_NEW = LIGHT.cyan;
const ACCENT_BACK = LIGHT.purple;
const WHITE  = [255, 255, 255, 255];
const TEXT   = DARK.ink;
const SUBTLE = DARK.grey1;

function truncate(text, scale, maxWidth) {
  if (textWidth(text, scale) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}...`, scale) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}

/**
 * @param {object} opts
 * @param {Buffer|null} opts.avatarPng - raw PNG bytes of the member's avatar (already fetched), or null if unavailable
 * @param {string} opts.username - display name to show
 * @param {string} opts.serverName - guild name
 * @param {string} opts.memberLabel - e.g. "42ND MEMBER"
 * @param {string} opts.bonusText - the second chip's text, e.g. "+500 COINS", "BONUS ALREADY CLAIMED", or "GOOD TO HAVE YOU HERE"
 * @param {boolean} [opts.bonusHighlight] - true to draw the chip in the accent colour (an actual reward happened), false/omitted for an informational dim chip
 * @param {boolean} [opts.isReturning] - swaps the eyebrow/title copy and accent for a returning member
 * @returns {Buffer} PNG image data
 */
function generateWelcomeCardImage(opts) {
  const { avatarPng, username, serverName, memberLabel, bonusText, bonusHighlight = false, isReturning = false } = opts;
  const accent = isReturning ? ACCENT_BACK : ACCENT_NEW;
  const W = 1000, H = 460;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  fillCanvas(png, DARK.bg);
  // Faint decorative rings, upper-right — minimal, not competing with the avatar/text.
  ringStroke(png, W - 60, 60, 140, accent, 3);
  ringStroke(png, W - 60, 60, 190, accent, 2);
  darkCard(png, 20, 20, W - 40, H - 40, { radius: 28 });

  // ── Avatar circle, left ────────────────────────────────────────────────────
  const acx = 190, acy = 230, aradius = 108;
  dotBlend(png, acx, acy, aradius + 22, accent, 0.14);
  drawAvatarCircle(png, acx, acy, aradius, avatarPng, (username[0] || '?').toUpperCase(), accent);
  ringStroke(png, acx, acy, aradius + 6, accent, 5);

  // ── Greeting, right ────────────────────────────────────────────────────────
  const contentLeft = 360, contentRight = W - 44, contentW = contentRight - contentLeft;

  drawText(png, isReturning ? 'WELCOME BACK' : 'NEW MEMBER', contentLeft, 100, 2, accent);
  drawText(png, 'WELCOME', contentLeft, 128, 6, TEXT);
  drawText(png, truncate(username, 4, contentW), contentLeft, 186, 4, accent);
  drawText(png, truncate(`TO ${serverName.toUpperCase()}`, 2, contentW), contentLeft, 228, 2, SUBTLE);

  for (let x = contentLeft; x < contentRight; x++) setPxBlend(png, x, 260, accent, 0.35);

  // ── Chips: member number + bonus/returning note ─────────────────────────────
  const chipY = 284, chipH = 50, gap = 16;
  const chip1Text = memberLabel.toUpperCase();
  const chip2Text = (bonusText || 'GOOD TO HAVE YOU HERE').toUpperCase();
  const chip1W = 32 + textWidth(chip1Text, 2);
  const chip2W = 32 + textWidth(chip2Text, 2);

  fillRoundedRectBlend(png, contentLeft, chipY, chip1W, chipH, 10, DARK.raised, 1);
  drawTextCentered(png, chip1Text, contentLeft + chip1W / 2, chipY + 16, 2, TEXT);

  fillRoundedRectBlend(png, contentLeft + chip1W + gap, chipY, chip2W, chipH, 10, accent, bonusHighlight ? 0.22 : 0.12);
  drawTextCentered(png, chip2Text, contentLeft + chip1W + gap + chip2W / 2, chipY + 16, 2, bonusHighlight ? accent : SUBTLE);

  return PNG.sync.write(png);
}

module.exports = { generateWelcomeCardImage };
