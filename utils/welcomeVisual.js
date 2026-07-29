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

const ACCENT = [16, 185, 129, 255]; // jade green — matches embedBuilder.js's 'welcome' color
const WHITE  = [255, 255, 255, 255];
const BACK   = [245, 158, 11, 255]; // amber — used for the "welcome back" variant accent

// Nearest-neighbor resize of a decoded avatar PNG into an RGBA buffer of
// size x size — the avatar toolkit here is pixel-art scale, so a crisp
// nearest-neighbor sample fits the house look better than a soft blur would.
function resizeSquareRGBA(png, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(png.height - 1, Math.floor((y / size) * png.height));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(png.width - 1, Math.floor((x / size) * png.width));
      const si = (png.width * sy + sx) * 4;
      const di = (size * y + x) * 4;
      out[di] = png.data[si]; out[di + 1] = png.data[si + 1]; out[di + 2] = png.data[si + 2]; out[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

function truncate(text, scale, maxWidth) {
  if (textWidth(text, scale) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}...`, scale) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}

// Draws the member's real avatar clipped to a circle, or — if it couldn't be
// fetched/decoded — a colored circle with their initial as a graceful
// fallback so a network hiccup on join never breaks the whole card.
function drawAvatarCircle(png, cx, cy, radius, avatarPng, initial, accent) {
  const r2 = radius * radius;
  const size = radius * 2;
  const buf = avatarPng ? resizeSquareRGBA(avatarPng, size) : null;

  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      if (xx * xx + yy * yy > r2) continue;
      const x = cx + xx, y = cy + yy;
      if (buf) {
        const sx = xx + radius, sy = yy + radius;
        const si = (size * sy + sx) * 4;
        const alpha = buf[si + 3] / 255;
        setPxBlend(png, x, y, [buf[si], buf[si + 1], buf[si + 2], 255], alpha || 1);
      } else {
        setPxBlend(png, x, y, accent, 0.22);
      }
    }
  }

  if (!buf) drawTextCentered(png, initial, cx, cy - 21, 6, WHITE);
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
