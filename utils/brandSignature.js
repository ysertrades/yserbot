'use strict';

/**
 * brandSignature.js
 *
 * The YSER FLOW branding used on the TradingView and Whop banners.
 *
 * It's deliberately two layers rather than one stamp, because a single corner
 * logo is trivial to crop or paint over:
 *
 *   1. A micro-watermark lattice woven across the whole canvas at a few
 *      percent opacity. Each row slides sideways by a fixed amount, so the
 *      repeats fall on a diagonal instead of a grid — there's no rectangle you
 *      can clone-stamp over another to erase it, and it survives cropping
 *      because it reaches every edge.
 *
 *   2. A signature block: a monogram chip plus a two-tone wordmark. This is
 *      the part meant to be *seen*; the lattice is the part meant to be found
 *      later.
 *
 * Both take their colours from the host banner, so the branding reads as part
 * of the card rather than a sticker on top of it. Worth saying plainly: this
 * deters lifting the image and reusing it, it can't stop a screenshot.
 */

const {
  setPxBlend, roundedMask, fillRoundedRectBlend, line,
  drawText, textWidth, GLYPH_H,
} = require('./pixelArt');

const WORD_A = 'YSER';
const WORD_B = 'FLOW';
const LATTICE_WORD = `${WORD_A} ${WORD_B}`;

/* ─── Layer 1: the woven micro-watermark ─────────────────────────────────── */

/**
 * Fills the whole canvas with barely-there repetitions of the wordmark.
 * Call it early — right after the background — so every panel and every piece
 * of content still sits cleanly on top.
 */
function drawFlowLattice(png, opts = {}) {
  const {
    color = [255, 255, 255, 255],
    alpha = 0.045,
    scale = 1,
    colGap = 74,   // space between repeats along a row
    rowGap = 46,   // space between rows
    drift = 43,    // sideways slide per row — what turns the grid into a weave
  } = opts;

  const pitch = textWidth(LATTICE_WORD, scale) + colGap;
  const rowH = GLYPH_H * scale + rowGap;

  let row = 0;
  for (let y = -rowH; y < png.height + rowH; y += rowH, row++) {
    // Start one full pitch off-canvas so the left edge is covered too.
    const start = ((row * drift) % pitch) - pitch;
    // Alternating weight keeps the lattice from reading as stripes.
    const a = alpha * (row % 2 === 0 ? 1 : 0.72);
    for (let x = start; x < png.width + pitch; x += pitch) {
      drawText(png, LATTICE_WORD, Math.round(x), y, scale, color, a);
    }
  }
}

/* ─── Layer 2: the signature block ───────────────────────────────────────── */

const CHIP = 34;        // the monogram chip is square
const CHIP_GAP = 14;    // chip to wordmark
const WORD_GAP = 8;     // YSER to FLOW
const WORD_SCALE = 2;
const CAPTION = 'ORIGINAL DESIGN';

/** Total width of the signature block, for centring it under a logo. */
function signatureWidth() {
  return CHIP + CHIP_GAP
    + textWidth(WORD_A, WORD_SCALE) + WORD_GAP + textWidth(WORD_B, WORD_SCALE);
}

const SIGNATURE_HEIGHT = CHIP;

function roundedBorder(png, x, y, w, h, radius, color, alpha) {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      if (!roundedMask(w, h, radius, xx, yy)) continue;
      const edge = xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1
        || !roundedMask(w, h, radius, xx - 1, yy) || !roundedMask(w, h, radius, xx + 1, yy)
        || !roundedMask(w, h, radius, xx, yy - 1) || !roundedMask(w, h, radius, xx, yy + 1);
      if (edge) setPxBlend(png, x + xx, y + yy, color, alpha);
    }
  }
}

/**
 * The monogram: a Y whose stem is cut by a small gap. The break is the point —
 * it reads as flow/motion, and it's the detail that makes a copied-by-eye
 * version obviously wrong.
 */
function drawFlowMonogram(png, x, y, color) {
  const cx = x + CHIP / 2;
  const junction = y + 18;
  // Strokes are 3px, so each endpoint spreads one row either side — the stem
  // has to start 5 below the junction to leave a visible 2px break.
  line(png, x + 8, y + 8, cx, junction, color, 3);            // left arm
  line(png, x + CHIP - 8, y + 8, cx, junction, color, 3);     // right arm
  line(png, cx, junction + 5, cx, y + 27, color, 3);          // stem, after the break
}

/**
 * @param {number} x left edge of the block
 * @param {number} y top edge of the block
 * @param {object} opts
 *   chip     — chip fill/border/monogram colour
 *   primary  — colour of "YSER"
 *   accent   — colour of "FLOW"
 *   caption  — colour of the micro caption under the wordmark
 */
function drawFlowSignature(png, x, y, opts = {}) {
  const {
    chip = [255, 255, 255, 255],
    primary = [255, 255, 255, 255],
    accent = [255, 255, 255, 255],
    caption = [255, 255, 255, 255],
    chipAlpha = 0.14,
    borderAlpha = 0.5,
    captionAlpha = 0.55,
  } = opts;

  fillRoundedRectBlend(png, x, y, CHIP, CHIP, 10, chip, chipAlpha);
  roundedBorder(png, x, y, CHIP, CHIP, 10, chip, borderAlpha);
  drawFlowMonogram(png, x, y, chip);

  // Two-tone wordmark — the split is part of the mark, not decoration.
  const tx = x + CHIP + CHIP_GAP;
  const ty = y + 5;
  drawText(png, WORD_A, tx, ty, WORD_SCALE, primary);
  drawText(png, WORD_B, tx + textWidth(WORD_A, WORD_SCALE) + WORD_GAP, ty, WORD_SCALE, accent);

  drawText(png, CAPTION, tx, ty + GLYPH_H * WORD_SCALE + 4, 1, caption, captionAlpha);
}

module.exports = {
  drawFlowLattice, drawFlowSignature,
  signatureWidth, SIGNATURE_HEIGHT,
};
