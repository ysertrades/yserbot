'use strict';

/**
 * prizeGiveawayVisual.js
 *
 * The banner for a prize giveaway — the /giveaway kind, where what is being
 * given away is a thing rather than a pile of coins.
 *
 * The coins banner could not be reused for this: it is built around a
 * jackpot coin and casino chips, which says "currency" about a giveaway that
 * might be a funded account, a course seat or a piece of hardware. This one
 * leads with a gift box and leaves the prize itself as the largest words on
 * the card, so the same artwork carries any prize.
 *
 * QuantLab "Phantom" house style: dark neutral card, text inverted to the
 * brand's light Background hex, and the signature sky→periwinkle gradient
 * held to the two hero moments a giveaway actually has — the soft glow
 * behind the gift, and the rule under the heading. Confetti stays inside
 * the brand's own palette (purple, cyan, sky) rather than reaching for gold
 * or neon, so "celebratory" still reads as "calm, geometric, craft" rather
 * than hype.
 *
 * Every line is editable in Studio. The defaults are written to make sense
 * unchanged, so a server that never opens Studio still gets a usable banner.
 */

const {
  PNG, setPxBlend, fillRect, dot, dotBlend, ringStroke,
  roundedMask, fillRoundedRectBlend, drawTextCentered, wrapText,
  fitScale, textWidth, drawText, GLYPH_H,
} = require('./pixelArt');
const { drawFlowLattice, drawFlowSignature, signatureWidth } = require('./brandSignature');
const { RGBA: LIGHT, RGBA_DARK: DARK, gradientColorAt, gradientRect, darkCard, fillCanvas } = require('./brandTheme');

const TEXT   = DARK.ink;     // body text — inverted onto the dark card
const SUBTLE = DARK.grey1;
const WHITE  = [255, 255, 255, 255];
const PURPLE = LIGHT.purple;
const PURPLE_L = LIGHT.purpleLight;
const PURPLE_D = LIGHT.purpleDeep;
const CYAN   = LIGHT.cyan;
const SKY    = LIGHT.sky;

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

  // Dark neutral background — the brand book's own allowance for a dark
  // surface — since that's how most people actually read Discord.
  fillCanvas(png, DARK.bg);

  // A soft gradient glow from behind the gift — the signature asset used as
  // a hero surface, not a wash over the whole card.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 210, y - H + 40) / 460;
      if (d >= 1) continue;
      const c = gradientColorAt(0.5 + (x - 210) / 1400);
      setPxBlend(png, x, y, c, (1 - d) * (1 - d) * 0.35);
    }
  }

  // Woven in before anything sits on top, so it reaches every edge and cannot
  // be cropped off — same construction as the other two banners.
  drawFlowLattice(png, { color: PURPLE_L, alpha: 0.04 });

  // Inset card, flat "craft" edge rather than a glow — matches every other
  // QuantLab card in the bot.
  darkCard(png, 18, 18, W - 36, H - 36, { radius: 26 });

  confetti(png, W, H);

  // ── The gift, left ────────────────────────────────────────────────────────
  giftBox(png, 176, 214, 150);

  // ── Status pill, top right ────────────────────────────────────────────────
  const pillW = 34 + textWidth(pill, 2);
  const pillX = W - 46 - pillW;
  fillRoundedRectBlend(png, pillX, 42, pillW, 40, 10, PURPLE, 1);
  dot(png, pillX + 17, 62, 5, WHITE);
  drawText(png, pill, pillX + 30, 52, 2, WHITE);

  // ── Copy block, right of the gift ─────────────────────────────────────────
  const left = 330, right = W - 46;
  const cx = (left + right) / 2;
  const width = right - left;

  const headScale = fitScale(heading, width, 6, 2);
  drawTextCentered(png, heading, cx, 108 + (6 - headScale) * GLYPH_H / 2, headScale, TEXT);

  drawTextCentered(png, subtitle, cx, 108 + 6 * GLYPH_H + 14, fitScale(subtitle, width, 3, 1), PURPLE_L);

  // The one signature gradient rule — sky → periwinkle, sparingly, as the
  // brand book asks — under the heading, where a hero surface belongs.
  gradientRect(png, left, 240, width, 4, 2);

  const lines = wrapText(tagline, 2, width);
  // Two lines is what the card has room for; anything past that gets a visible
  // ellipsis rather than being silently cut.
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] += '...';
  let ty = 268;
  for (const l of shown) { drawTextCentered(png, l, cx, ty, 2, SUBTLE); ty += GLYPH_H * 2 + 10; }

  // ── Signature, under the gift ─────────────────────────────────────────────
  drawFlowSignature(png, Math.round(176 - signatureWidth() / 2), 306, {
    chip: PURPLE, primary: TEXT, caption: SUBTLE,
    chipAlpha: 0.18, borderAlpha: 0.45, captionAlpha: 0.85,
  });

  return PNG.sync.write(png);
}

/**
 * A wrapped gift, drawn rather than an emoji so it scales with the card and
 * carries the same palette as everything else on it. Purple body, white
 * ribbon (a white pill button's ribbon, effectively), cyan-accented bow —
 * the brand's one permitted flourish for a moment that is meant to feel
 * a little festive.
 */
function giftBox(png, cx, cy, size) {
  const half = size / 2;
  const lidH = Math.round(size * 0.22);
  const boxTop = cy - half + lidH;
  const boxH = size - lidH;

  // Body, with a lighter face on the left so the box reads as three
  // dimensional under the glow coming from that side.
  for (let y = 0; y < boxH; y++) {
    for (let x = 0; x < size; x++) {
      const lit = x < size * 0.46;
      setPxBlend(png, cx - half + x, boxTop + y, lit ? PURPLE : PURPLE_D, lit ? 0.95 : 0.9);
    }
  }

  // Lid, overhanging slightly on each side.
  const lidOver = Math.round(size * 0.07);
  for (let y = 0; y < lidH; y++) {
    for (let x = 0; x < size + lidOver * 2; x++) {
      setPxBlend(png, cx - half - lidOver + x, cy - half + y, PURPLE, 1);
    }
  }

  // Ribbon down the front and across the lid.
  const ribbonW = Math.max(6, Math.round(size * 0.12));
  fillRect(png, Math.round(cx - ribbonW / 2), boxTop, ribbonW, boxH, WHITE);
  fillRect(png, cx - half - lidOver, cy - half + Math.round(lidH / 2) - Math.round(ribbonW / 2),
    size + lidOver * 2, ribbonW, WHITE);

  // Bow — two loops and a knot. ringStroke takes the colour before the
  // thickness; passing them the other way round drew nothing visible at all.
  const loop = Math.round(size * 0.13);
  const bowY = cy - half - Math.round(loop * 0.55);
  ringStroke(png, cx - loop, bowY, loop, WHITE, 4);
  ringStroke(png, cx + loop, bowY, loop, WHITE, 4);
  dot(png, cx, bowY + Math.round(loop * 0.5), Math.max(4, Math.round(size * 0.055)), CYAN);

  // A highlight along the top edge of the lid.
  for (let x = 0; x < size + lidOver * 2; x++) {
    setPxBlend(png, cx - half - lidOver + x, cy - half, WHITE, 0.4);
  }
}

/** Scattered flecks, kept out of the middle where the copy sits. */
function confetti(png, W, H) {
  const seeds = [
    [70, 70], [120, 46], [58, 300], [96, 356], [250, 58], [292, 340],
    [612, 52], [700, 44], [840, 330], [900, 356], [946, 96], [954, 250],
    [420, 44], [470, 350], [780, 350], [660, 358],
  ];
  const palette = [PURPLE, CYAN, SKY, PURPLE_D];
  seeds.forEach(([x, y], i) => {
    const c = palette[i % palette.length];
    const r = 3 + (i % 3);
    if (i % 3 === 0) {
      // A short bar rather than a dot, so the scatter is not uniform.
      for (let d = -r; d <= r; d++) dotBlend(png, x + d, y + Math.round(d * 0.5), 1, c, 0.8);
    } else {
      dotBlend(png, x, y, r, c, 0.7);
    }
  });
}

module.exports = { generatePrizeGiveawayBannerImage, PRIZE_DEFAULTS };
