'use strict';

/**
 * whopVisual.js
 *
 * Banner for promoting a Whop storefront — orange styling, matching Whop's
 * own identity: their signature orange with the cream wing mark. The logo is
 * redrawn in utils/brandMarks.js so it renders as a PNG at any size.
 */

const {
  PNG, setPxBlend, flatBg, dot, roundedMask,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, GLYPH_H,
} = require('./pixelArt');
const { drawWhopMark, WHOP_ASPECT } = require('./brandMarks');
const { drawFlowLattice, drawFlowSignature, signatureWidth } = require('./brandSignature');

const ORANGE = [250, 69, 22, 255];   // Whop's brand orange
const DEEP   = [198, 48, 12, 255];   // a darker orange, for depth
const CREAM  = [255, 240, 224, 255]; // the mark's own off-white

/**
 * @returns {Buffer} PNG image data
 */
function generateWhopBannerImage() {
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  // Orange edge to edge — this one is the brand colour rather than a dark card.
  flatBg(png, ORANGE);
  // Woven straight into the background, so it runs under the panel and out to
  // every edge rather than sitting on top as a removable stamp.
  drawFlowLattice(png, { color: CREAM, alpha: 0.038 });

  // Inset panel in a deeper orange, so the card still has an edge to read
  // against Discord's dark background.
  for (let y = 0; y < H - 40; y++) {
    for (let x = 0; x < W - 40; x++) {
      if (!roundedMask(W - 40, H - 40, 28, x, y)) continue;
      const edge = x === 0 || y === 0 || x === W - 41 || y === H - 41
        || !roundedMask(W - 40, H - 40, 28, x - 1, y) || !roundedMask(W - 40, H - 40, 28, x + 1, y)
        || !roundedMask(W - 40, H - 40, 28, x, y - 1) || !roundedMask(W - 40, H - 40, 28, x, y + 1);
      setPxBlend(png, 20 + x, 20 + y, edge ? CREAM : DEEP, edge ? 0.55 : 0.16);
    }
  }

  // ── Status pill, top-right — cream on orange, inverting the card ──────────
  const pillText = 'PREMIUM';
  const pillW = 40 + textWidth(pillText, 2);
  const pillX = W - 44 - pillW, pillY = 40;
  fillRoundedRectBlend(png, pillX, pillY, pillW, 42, 10, CREAM, 0.96);
  dot(png, pillX + 20, pillY + 21, 6, ORANGE);
  drawText(png, pillText, pillX + 34, pillY + 13, 2, ORANGE);

  // ── The wing mark, straight on the orange the way Whop present it ─────────
  const markW = 226;
  const markX = 74;
  drawWhopMark(png, markX, 150 - (markW / WHOP_ASPECT) / 2, markW, CREAM);

  // ── Signature, centred under the wing mark ───────────────────────────────
  drawFlowSignature(png, Math.round(markX + (markW - signatureWidth()) / 2), 306, {
    chip: CREAM, primary: CREAM, accent: [255, 184, 146, 255], caption: [255, 226, 208, 255],
    chipAlpha: 0.16, borderAlpha: 0.55, captionAlpha: 0.7,
  });

  // ── Wordmark + subtitle ──────────────────────────────────────────────────
  const contentLeft = 356, contentRight = W - 44;
  const contentCx = (contentLeft + contentRight) / 2;
  drawTextCentered(png, 'WHOP', contentCx, 96, 6, CREAM);
  drawTextCentered(png, 'MEMBERSHIP & PREMIUM ACCESS', contentCx, 96 + 6 * GLYPH_H + 16, 2, [255, 214, 190, 255]);

  // ── Tagline ───────────────────────────────────────────────────────────────
  for (let x = contentLeft; x < contentRight; x++) setPxBlend(png, x, 262, CREAM, 0.4);
  const lines = wrapText('COURSES, COMMUNITY AND PREMIUM PERKS - ALL IN ONE PLACE.', 2, contentRight - contentLeft);
  let ty = 284;
  for (const l of lines.slice(0, 2)) { drawTextCentered(png, l, contentCx, ty, 2, [255, 226, 208, 255]); ty += GLYPH_H * 2 + 10; }

  return PNG.sync.write(png);
}

module.exports = { generateWhopBannerImage };
