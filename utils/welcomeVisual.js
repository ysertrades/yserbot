'use strict';

/**
 * welcomeVisual.js
 *
 * A large "member joined" poster in the same flat-glassmorphism house
 * style as the other visuals — the member's real Discord avatar composited
 * into a circular frame on the left, with a short, bold greeting on the
 * right. Unlike the static dynamic-embed templates (nyse-open, risk-guide,
 * ...), this one is generated fresh per member since it bakes in
 * per-person data (avatar, name, server, member number), so it's called
 * directly from events/guildMemberAdd.js rather than seeded as a template.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, textWidth, GLYPH_H,
} = require('./pixelArt');
const { drawAvatarCircle } = require('./avatarUtil');

const ACCENT = [16, 185, 129, 255]; // jade green — matches embedBuilder.js's 'welcome' color
const WHITE  = [255, 255, 255, 255];
const BACK   = [245, 158, 11, 255]; // amber — used for the "welcome back" variant accent

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
 * @param {string|null} opts.bonusText - e.g. "+500 COINS", or null if no bonus (returning member)
 * @param {boolean} [opts.isReturning] - swaps the eyebrow/title copy and accent for a returning member
 * @returns {Buffer} PNG image data
 */
function generateWelcomeCardImage(opts) {
  const { avatarPng, username, serverName, memberLabel, bonusText, isReturning = false } = opts;
  const accent = isReturning ? BACK : ACCENT;
  const W = 1000, H = 460;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  flatBg(png, [9, 16, 14, 255]);
  // Faint decorative rings, upper-right — minimal, not competing with the avatar/text.
  ringStroke(png, W - 60, 60, 140, accent, 3);
  ringStroke(png, W - 60, 60, 190, accent, 2);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: accent, tintAlpha: 0.06, border: accent, borderAlpha: 0.4 });

  // ── Avatar circle, left ────────────────────────────────────────────────────
  const acx = 190, acy = 230, aradius = 108;
  dotBlend(png, acx, acy, aradius + 22, accent, 0.12);
  drawAvatarCircle(png, acx, acy, aradius, avatarPng, (username[0] || '?').toUpperCase(), accent);
  ringStroke(png, acx, acy, aradius + 6, accent, 5);

  // ── Greeting, right ────────────────────────────────────────────────────────
  const contentLeft = 360, contentRight = W - 44, contentW = contentRight - contentLeft;

  drawText(png, isReturning ? 'WELCOME BACK' : 'NEW MEMBER', contentLeft, 100, 2, accent);
  drawText(png, 'WELCOME', contentLeft, 128, 6, WHITE);
  drawText(png, truncate(username, 4, contentW), contentLeft, 186, 4, accent);
  drawText(png, truncate(`TO ${serverName.toUpperCase()}`, 2, contentW), contentLeft, 228, 2, [190, 200, 196, 255]);

  for (let x = contentLeft; x < contentRight; x++) setPxBlend(png, x, 260, accent, 0.3);

  // ── Chips: member number + bonus/returning note ─────────────────────────────
  const chipY = 284, chipH = 50, gap = 16;
  const chip1Text = memberLabel.toUpperCase();
  const chip2Text = (bonusText || 'BONUS ALREADY CLAIMED').toUpperCase();
  const chip1W = 32 + textWidth(chip1Text, 2);
  const chip2W = 32 + textWidth(chip2Text, 2);

  fillRoundedRectBlend(png, contentLeft, chipY, chip1W, chipH, 10, WHITE, 0.1);
  drawTextCentered(png, chip1Text, contentLeft + chip1W / 2, chipY + 16, 2, WHITE);

  fillRoundedRectBlend(png, contentLeft + chip1W + gap, chipY, chip2W, chipH, 10, accent, bonusText ? 0.22 : 0.12);
  drawTextCentered(png, chip2Text, contentLeft + chip1W + gap + chip2W / 2, chipY + 16, 2, bonusText ? accent : [170, 178, 190, 255]);

  return PNG.sync.write(png);
}

module.exports = { generateWelcomeCardImage };
