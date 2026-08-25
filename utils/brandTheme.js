'use strict';

/**
 * brandTheme.js
 *
 * Single source of truth for the QuantLab "Phantom" palette (brand book,
 * 2026 — Style Guide · Color) and the small set of drawing helpers built on
 * top of pixelArt.js that let a light, pastel, geometric card be composed
 * the same way glassPanel() let a dark one be composed before.
 *
 * Two things live here on purpose:
 *
 *   1. HEX / RGBA constants — for embedBuilder.js and messageStyle.js,
 *      which only ever need a colour string.
 *   2. gradientRect / lightCard / pillChip — for PNG card generators
 *      (econEventVisual.js and anything after it) that need to actually
 *      paint the palette, including the one signature gradient asset.
 *
 * Brand guardrails this file exists to keep everyone honest about:
 *   · light-first — background is #F5F7FB, dark is neutral #15161D only,
 *     never a purple-navy.
 *   · no neon green/red P&L overlays or aggressive numbers — severity and
 *     direction are read off shade and position (dark vs. light purple,
 *     an arrow's tilt) rather than a stoplight.
 *   · the sky→periwinkle gradient is the one signature asset; it is used
 *     sparingly, on hero surfaces, with ink text — never white on it.
 */

const { setPxBlend, fillRoundedRectBlend, roundedMask, drawTextCentered, GLYPH_H } = require('./pixelArt');

// pixelArt's own hexToRgb takes a numeric colour (0xRRGGBB) rather than a
// "#RRGGBB" string, so brand hex strings get their own tiny parser here.
function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/* ─── Core palette (brand book, hex) ─────────────────────────────────────── */

const HEX = {
  bg: '#F5F7FB',
  card: '#EEF1F8',
  ink: '#12151B',
  purple: '#9397EE',
  purpleDeep: '#3A3F8F',
  dark: '#15161D',
  sky: '#94DFFC',
  cyan: '#4FB6E8',
  grey1: '#5B6270',
  grey2: '#8A90A0',
  grey3: '#CDD2DC',
  grey4: '#E6E9EF',
  // Tonal extensions — tints/shades of the four accents above, not new
  // hues, so a card that needs more than four steps still reads as one
  // family rather than reaching outside the book.
  purpleLight: '#B7BAF3',
  cyanDeep: '#2E90B8',
};

/**
 * Semantic mapping used across the bot's alerts (embedBuilder.colors,
 * messageStyle's PALETTE_KINDS/IMPACT_KINDS, the individual mod/econ/
 * giveaway/report cards). Kept here once so the fallback in embedBuilder.js
 * and the customisable defaults in messageStyle.js can never drift apart.
 *
 * Severity reads as depth of purple rather than a red/green swing — a
 * ban is `dark`, a warning is `purple`, a resolved/positive card is
 * `cyan` — which is the "calm, geometric, craft" pillar applied to a
 * Discord sidebar colour instead of a poster.
 */
const SEMANTIC = {
  success: HEX.cyan,
  error: HEX.purpleDeep,
  info: HEX.sky,
  warning: HEX.purple,
  giveaway: HEX.purpleLight,
  ticket: HEX.cyanDeep,
  economy: HEX.purple,
  shop: HEX.cyanDeep,
  inventory: HEX.grey1,
  casino: HEX.purpleDeep,
  userinfo: HEX.purple,
  schedule: HEX.grey2,
  news: HEX.sky,
  breaking: HEX.purpleDeep,
  welcome: HEX.cyan,
  leave: HEX.grey1,
  mod: HEX.purpleDeep,
};

/** High/Medium/Low/Holiday — the economic-calendar impact colours. */
const IMPACT = {
  High: HEX.purpleDeep,
  Medium: HEX.purple,
  Low: HEX.grey2,
  Holiday: HEX.sky,
};

/* ─── RGBA, for pixelArt-based PNG cards ─────────────────────────────────── */

const RGBA = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, hexToRgb(v)]));

/* ─── The signature gradient ──────────────────────────────────────────────
 * linear-gradient(120deg, #94DFFC, #9EBFF4 40%, #9397EE) — sky → periwinkle
 * → purple. 120deg in CSS terms runs mostly left-to-right with a slight
 * downward tilt; approximated here as a horizontal interpolation with a
 * touch of vertical drift, which is indistinguishable at card sizes. */
const GRADIENT_STOPS = [
  { t: 0, c: hexToRgb('#94DFFC') },
  { t: 0.4, c: hexToRgb('#9EBFF4') },
  { t: 1, c: hexToRgb('#9397EE') },
];

function lerp(a, b, t) { return a + (b - a) * t; }

function gradientColorAt(t) {
  t = Math.max(0, Math.min(1, t));
  let lo = GRADIENT_STOPS[0], hi = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    if (t >= GRADIENT_STOPS[i].t && t <= GRADIENT_STOPS[i + 1].t) {
      lo = GRADIENT_STOPS[i]; hi = GRADIENT_STOPS[i + 1]; break;
    }
  }
  const span = hi.t - lo.t || 1;
  const local = (t - lo.t) / span;
  return [
    Math.round(lerp(lo.c[0], hi.c[0], local)),
    Math.round(lerp(lo.c[1], hi.c[1], local)),
    Math.round(lerp(lo.c[2], hi.c[2], local)),
    255,
  ];
}

/**
 * Fills a rounded rect with the signature sky→periwinkle gradient.
 * Deliberately the only place in a card that gets a gradient — the brand
 * book calls it "the one signature asset", used sparingly on hero surfaces.
 */
function gradientRect(png, px, py, w, h, radius = 18, angleDeg = 120) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  // Project every corner onto the gradient axis to normalise t to [0,1]
  // across the actual rect, whatever the angle.
  const corners = [[0, 0], [w, 0], [0, h], [w, h]];
  const projs = corners.map(([x, y]) => x * dx + y * dy);
  const minP = Math.min(...projs), maxP = Math.max(...projs);
  const span = (maxP - minP) || 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!roundedMask(w, h, radius, x, y)) continue;
      const t = ((x * dx + y * dy) - minP) / span;
      setPxBlend(png, px + x, py + y, gradientColorAt(t), 1);
    }
  }
}

/**
 * The light equivalent of glassPanel(): a white/card-tint rounded rect on
 * the #F5F7FB background, a faint grey3 rim instead of a drop shadow (flat
 * craft, per the style guide — "never marketed like hype"), and an optional
 * inner tint for a coloured sub-panel (e.g. a soft purple wash behind a
 * chip) rather than a translucent overlay on dark.
 */
function lightCard(png, px, py, w, h, opts = {}) {
  const {
    radius = 20,
    fill = RGBA.card,
    border = RGBA.grey3,
    borderAlpha = 0.9,
  } = opts;
  fillRoundedRectBlend(png, px, py, w, h, radius, fill, 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!roundedMask(w, h, radius, x, y)) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || !roundedMask(w, h, radius, x - 1, y) || !roundedMask(w, h, radius, x + 1, y)
        || !roundedMask(w, h, radius, x, y - 1) || !roundedMask(w, h, radius, x, y + 1);
      if (edge) setPxBlend(png, px + x, py + y, border, borderAlpha);
    }
  }
}

/** A small pill/chip — solid tint, centered label — for currency/impact/time badges. */
function pillChip(png, px, py, w, h, { fill, textColor, label, scale = 2 }) {
  fillRoundedRectBlend(png, px, py, w, h, Math.min(h / 2, 12), fill, 1);
  drawTextCentered(png, label, px + w / 2, py + Math.round((h - scale * GLYPH_H) / 2), scale, textColor);
}

module.exports = {
  HEX, SEMANTIC, IMPACT, RGBA,
  GRADIENT_STOPS, gradientColorAt, gradientRect,
  lightCard, pillChip,
};
