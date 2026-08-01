'use strict';

/**
 * prizeGiveawayVisual.js
 *
 * The banner for a prize giveaway — the /giveaway kind, where what is being
 * given away is a thing rather than a pile of coins.
 *
 * The coins banner could not be reused for this: it is built around a gold
 * jackpot coin and casino chips, which says "currency" about a giveaway that
 * might be a funded account, a course seat or a piece of hardware. This one
 * leads with a gift box and leaves the prize itself as the largest words on
 * the card, so the same artwork carries any prize.
 *
 * Every line is editable in Studio. The defaults are written to make sense
 * unchanged, so a server that never opens Studio still gets a usable banner.
 */

const {
  PNG, setPxBlend, fillRect, line, dot, dotBlend, ringStroke,
  flatBg, roundedMask, fillRoundedRectBlend, drawTextCentered, wrapText,
  fitScale, textWidth, drawText, GLYPH_H,
} = require('./pixelArt');
const { drawFlowLattice, drawFlowSignature, signatureWidth } = require('./brandSignature');

const BG      = [10, 13, 18, 255];      // the panel's own near-black
const VIOLET  = [124, 92, 255, 255];    // the ribbon, and the accent throughout
const VIOLET_D= [70, 48, 168, 255];
const ACCENT  = [76, 125, 255, 255];    // YSER FLOW blue, for the second tone
const CREAM   = [255, 246, 232, 255];
const SOFT    = [186, 178, 206, 255];

// Passing nothing has to produce a finished card — the same rule the other
// two banners follow, so the no-arg render keeps its cache entry.
const PRIZE_DEFAULTS = {
  pill:     'GIVEAWAY',
  heading:  'PRIZE DROP',
  subtitle: 'ONE WINNER TAKES IT',
  tagline:  'HIT ENTER BELOW TO CLAIM YOUR SHOT. WINNER DRAWN WHEN THE TIMER RUNS OUT.',
};

/**
 * @param {object} [copy] pill / heading / subtitle / tagline overrides
 * @returns {Buffer} PNG image data
 */
function generatePrizeGiveawayBannerImage(copy = {}) {
  const { pill, heading, subtitle, tagline } = { ...PRIZE_DEFAULTS, ...copy };
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  flatBg(png, BG);

  // A violet wash from the lower left, so the card has a light source rather
  // than being flat black behind the artwork.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 210, y - H + 40) / 620;
      if (d >= 1) continue;
      setPxBlend(png, x, y, VIOLET, (1 - d) * (1 - d) * 0.22);
    }
  }

  // Woven in before anything sits on top, so it reaches every edge and cannot
  // be cropped off — same construction as the other two banners.
  drawFlowLattice(png, { color: CREAM, alpha: 0.03 });

  // Inset panel, so the card has a defined edge against Discord's background.
  for (let y = 0; y < H - 36; y++) {
    for (let x = 0; x < W - 36; x++) {
      if (!roundedMask(W - 36, H - 36, 26, x, y)) continue;
      const edge = !roundedMask(W - 36, H - 36, 26, x - 1, y) || !roundedMask(W - 36, H - 36, 26, x + 1, y)
        || !roundedMask(W - 36, H - 36, 26, x, y - 1) || !roundedMask(W - 36, H - 36, 26, x, y + 1);
      if (edge) setPxBlend(png, 18 + x, 18 + y, VIOLET, 0.5);
    }
  }

  confetti(png, W, H);

  // ── The gift, left ────────────────────────────────────────────────────────
  giftBox(png, 176, 214, 150);

  // ── Status pill, top right ────────────────────────────────────────────────
  const pillW = 34 + textWidth(pill, 2);
  const pillX = W - 46 - pillW;
  fillRoundedRectBlend(png, pillX, 42, pillW, 40, 10, VIOLET, 0.9);
  dot(png, pillX + 17, 62, 5, CREAM);
  drawText(png, pill, pillX + 30, 52, 2, CREAM);

  // ── Copy block, right of the gift ─────────────────────────────────────────
  const left = 330, right = W - 46;
  const cx = (left + right) / 2;
  const width = right - left;

  const headScale = fitScale(heading, width, 6, 2);
  drawTextCentered(png, heading, cx, 108 + (6 - headScale) * GLYPH_H / 2, headScale, CREAM);

  drawTextCentered(png, subtitle, cx, 108 + 6 * GLYPH_H + 14, fitScale(subtitle, width, 3, 1), VIOLET);

  // A two-tone rule under the heading: violet running into the brand blue, so
  // the card belongs to the same family as the other banners without simply
  // repeating them.
  const ruleY = 246;
  for (let x = left; x < right; x++) {
    const t = (x - left) / width;
    setPxBlend(png, x, ruleY, t < 0.5 ? VIOLET : ACCENT, 0.55);
  }

  const lines = wrapText(tagline, 2, width);
  // Two lines is what the card has room for; anything past that gets a visible
  // ellipsis rather than being silently cut.
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] += '...';
  let ty = 268;
  for (const l of shown) { drawTextCentered(png, l, cx, ty, 2, SOFT); ty += GLYPH_H * 2 + 10; }

  // ── Signature, under the gift ─────────────────────────────────────────────
  drawFlowSignature(png, Math.round(176 - signatureWidth() / 2), 306, {
    chip: VIOLET, primary: CREAM, accent: ACCENT, caption: SOFT,
    chipAlpha: 0.2, borderAlpha: 0.5, captionAlpha: 0.75,
  });

  return PNG.sync.write(png);
}

/**
 * A wrapped gift, drawn rather than an emoji so it scales with the card and
 * carries the same palette as everything else on it.
 */
function giftBox(png, cx, cy, size) {
  const half = size / 2;
  const lidH = Math.round(size * 0.22);
  const boxTop = cy - half + lidH;
  const boxH = size - lidH;

  // Body, with a lighter face on the left so the box reads as three
  // dimensional under the wash coming from that side.
  for (let y = 0; y < boxH; y++) {
    for (let x = 0; x < size; x++) {
      const lit = x < size * 0.46;
      setPxBlend(png, cx - half + x, boxTop + y, lit ? VIOLET : VIOLET_D, lit ? 0.92 : 0.82);
    }
  }

  // Lid, overhanging slightly on each side.
  const lidOver = Math.round(size * 0.07);
  for (let y = 0; y < lidH; y++) {
    for (let x = 0; x < size + lidOver * 2; x++) {
      setPxBlend(png, cx - half - lidOver + x, cy - half + y, VIOLET, 0.98);
    }
  }

  // Ribbon down the front and across the lid.
  const ribbonW = Math.max(6, Math.round(size * 0.12));
  fillRect(png, Math.round(cx - ribbonW / 2), boxTop, ribbonW, boxH, CREAM);
  fillRect(png, cx - half - lidOver, cy - half + Math.round(lidH / 2) - Math.round(ribbonW / 2),
    size + lidOver * 2, ribbonW, CREAM);

  // Bow — two loops and a knot. ringStroke takes the colour before the
  // thickness; passing them the other way round drew nothing visible at all.
  const loop = Math.round(size * 0.13);
  const bowY = cy - half - Math.round(loop * 0.55);
  ringStroke(png, cx - loop, bowY, loop, CREAM, 4);
  ringStroke(png, cx + loop, bowY, loop, CREAM, 4);
  dot(png, cx, bowY + Math.round(loop * 0.5), Math.max(4, Math.round(size * 0.055)), CREAM);

  // A highlight along the top edge of the lid.
  for (let x = 0; x < size + lidOver * 2; x++) {
    setPxBlend(png, cx - half - lidOver + x, cy - half, CREAM, 0.35);
  }
}

/** Scattered flecks, kept out of the middle where the copy sits. */
function confetti(png, W, H) {
  const seeds = [
    [70, 70], [120, 46], [58, 300], [96, 356], [250, 58], [292, 340],
    [612, 52], [700, 44], [840, 330], [900, 356], [946, 96], [954, 250],
    [420, 44], [470, 350], [780, 350], [660, 358],
  ];
  const palette = [VIOLET, ACCENT, CREAM];
  seeds.forEach(([x, y], i) => {
    const c = palette[i % palette.length];
    const r = 3 + (i % 3);
    if (i % 3 === 0) {
      // A short bar rather than a dot, so the scatter is not uniform.
      for (let d = -r; d <= r; d++) dotBlend(png, x + d, y + Math.round(d * 0.5), 1, c, 0.7);
    } else {
      dotBlend(png, x, y, r, c, 0.55);
    }
  });
}

module.exports = { generatePrizeGiveawayBannerImage, PRIZE_DEFAULTS };
