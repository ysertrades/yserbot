'use strict';

/**
 * econEventVisual.js
 *
 * One economic-calendar release, rendered as its own card in QuantLab's
 * "Phantom" house style. Discord is read in dark theme by most people, so
 * the card sits on the brand's dark neutral surface — "Dark Neutral
 * #15161D... never purple-navy" is the brand book's own allowance for
 * exactly this — with text inverted to the brand's light Background hex
 * rather than plain white, and the signature sky→periwinkle gradient still
 * used exactly once, as a thin hero rule, per "use sparingly, on hero
 * surfaces". The accents don't change between light and dark: only the
 * surface and the text invert.
 *
 * Severity and direction read as shade and shape rather than a red/green
 * stoplight — the brand guardrails rule out "aggressive numbers" and
 * "glowing green/red P&L overlays", so High/Medium/Low/Holiday step
 * through the purple family instead, and the forecast-vs-previous arrow
 * uses cyan (up) / purple-deep (down) rather than green/red.
 *
 * Built on pixelArt.js's primitives plus brandTheme.js's gradient and
 * dark-card helpers. Independent of casino/engine.js, same as before.
 */

const {
  PNG, line, fillRoundedRectBlend,
  drawText, drawTextCentered, wrapText, textWidth, GLYPH_H,
} = require('./pixelArt');
const {
  RGBA: LIGHT, RGBA_DARK: DARK, IMPACT: IMPACT_HEX,
  gradientRect, darkCard, fillCanvas, pillChip,
} = require('./brandTheme');

const TEXT = DARK.ink;        // body text — the brand's light bg hex, inverted onto dark
const SUBTLE = DARK.grey1;    // secondary/caption text on the dark card
const CHIP_INK = LIGHT.ink;   // "text on an accent chip is always ink, never white" — a fixed rule, independent of card mode

// Impact colour, straight from the same brand map messageStyle.js's
// IMPACT_KINDS uses — a reminder and the release it warns about, and this
// card underneath both, all read the same colour for the same event.
function hexToRgba(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
const IMPACT_COLOR = Object.fromEntries(Object.entries(IMPACT_HEX).map(([k, v]) => [k, hexToRgba(v)]));

// Light accents (sky) read best with ink text; the deeper ones (purple-deep)
// need white — per the brand's own "buttons on gradient are white pills
// with ink labels" split. Decided by relative luminance so a palette change
// in brandTheme.js never leaves a chip with unreadable text.
function textOn(bg) {
  const [r, g, b] = bg;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? CHIP_INK : [255, 255, 255, 255];
}

/**
 * Impact badge — a rounded chip with 1–3 filled bars (High/Medium/Low) or a
 * small flag glyph (Holiday), coloured by IMPACT_COLOR. Same "signal
 * strength at a glance, no legend needed" idea as before, redrawn in the
 * brand's flat geometric shapes instead of a glowing ring.
 */
function drawImpactBadge(png, cx, cy, impact, color) {
  const r = 34;
  fillRoundedRectBlend(png, cx - r, cy - r, r * 2, r * 2, r, color, 0.16);

  if (impact === 'Holiday') {
    fillRoundedRectBlend(png, cx - 2, cy - 15, 4, 30, 2, color, 1);
    fillRoundedRectBlend(png, cx - 2, cy - 15, 20, 12, 2, color, 0.9);
    return;
  }

  const bars = impact === 'High' ? 3 : impact === 'Medium' ? 2 : 1;
  for (let i = 0; i < 3; i++) {
    const bh = 9 + i * 8;
    const on = i < bars;
    fillRoundedRectBlend(png, cx - 20 + i * 14, cy + 16 - bh, 9, bh, 2, on ? color : DARK.border, 1);
  }
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

// A flat geometric triangle-tipped arrow — no motion blur, no glow, just
// the shape, per the brand's "flat geometric shapes... calm, not
// aggressive" illustration rule.
function drawArrow(png, cx, cy, dir, color) {
  if (dir === 'flat') { line(png, cx - 11, cy, cx + 11, cy, color, 3); return; }
  const tipY = dir === 'up' ? cy - 11 : cy + 11;
  const tailY = dir === 'up' ? cy + 11 : cy - 11;
  const wingY = dir === 'up' ? tipY + 8 : tipY - 8;
  line(png, cx, tailY, cx, tipY, color, 3);
  line(png, cx, tipY, cx - 8, wingY, color, 3);
  line(png, cx, tipY, cx + 8, wingY, color, 3);
}

/**
 * @param {object} e
 * @param {string} e.title
 * @param {string} e.currency
 * @param {string} e.impact - 'High' | 'Medium' | 'Low' | 'Holiday'
 * @param {string} [e.forecast]
 * @param {string} [e.previous]
 * @param {string} e.timeLabel - short pre-formatted time/status chip text, e.g. "IN 15 MIN", "RELEASING NOW", "WED 14:30 UTC"
 * @returns {Buffer} PNG image data
 */
function generateEconEventCard({ title, currency, impact, forecast, previous, timeLabel }) {
  const W = 900, H = 230;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const accent = IMPACT_COLOR[impact] || IMPACT_COLOR.Low;
  const accentText = textOn(accent);

  fillCanvas(png, DARK.bg);
  darkCard(png, 14, 14, W - 28, H - 28, { radius: 22 });

  // The one signature gradient asset on the card, used exactly once as a
  // thin hero rule under the top edge — sky → periwinkle, sparingly.
  gradientRect(png, 14, 14, W - 28, 6, 3);

  // ── Impact badge, far left ────────────────────────────────────────────────
  drawImpactBadge(png, 78, H / 2 - 2, impact, accent);
  drawTextCentered(png, (impact || 'LOW').toUpperCase(), 78, H - 30, 1, SUBTLE);

  // ── Currency chip ─────────────────────────────────────────────────────────
  const chipX = 138, chipY = 32, chipW = 96, chipH = 34;
  pillChip(png, chipX, chipY, chipW, chipH, { fill: accent, textColor: accentText, label: currency || '—', scale: 2 });

  // ── Time / status chip, top-right — a raised dark pill with light text,
  //    same weight as the currency chip ───────────────────────────────────
  const timeText = (timeLabel || '').toUpperCase();
  const timeChipW = Math.min(340, 40 + textWidth(timeText, 2));
  const timeChipX = W - 24 - timeChipW;
  pillChip(png, timeChipX, 32, timeChipW, 34, { fill: DARK.raised, textColor: TEXT, label: timeText, scale: 2 });

  // ── Title, word-wrapped to 2 lines max ────────────────────────────────────
  const titleMaxW = timeChipX - 138 - 20;
  const wrapped = wrapText(String(title || '').toUpperCase(), 2, titleMaxW);
  const shown = wrapped.slice(0, 2);
  if (wrapped.length > 2) {
    let last = shown[1] || '';
    while (last.length > 0 && textWidth(`${last}...`, 2) > titleMaxW) last = last.slice(0, -1);
    shown[1] = `${last}...`;
  }
  let ty = 82;
  for (const l of shown) {
    drawText(png, l, 138, ty, 2, TEXT);
    ty += GLYPH_H * 2 + 8;
  }

  // ── Forecast vs Previous row ──────────────────────────────────────────────
  const rowY = H - 68, half = 300, prevX = 138, foreX = prevX + half + 32;
  fillRoundedRectBlend(png, prevX, rowY, half, 46, 10, DARK.raised, 1);
  drawText(png, 'PREVIOUS', prevX + 14, rowY + 8, 1, SUBTLE);
  drawText(png, previous || 'N/A', prevX + 14, rowY + 22, 2, TEXT);

  fillRoundedRectBlend(png, foreX, rowY, half, 46, 10, DARK.raised, 1);
  drawText(png, 'FORECAST', foreX + 14, rowY + 8, 1, SUBTLE);
  drawText(png, forecast || 'N/A', foreX + 14, rowY + 22, 2, LIGHT.purpleLight);

  const fNum = parseNum(forecast), pNum = parseNum(previous);
  // Up/down reads as cyan vs. a lighter purple — brighter vs. cooler, same
  // family — never the neon green/red the brand book explicitly rules out.
  // (Purple Deep reads fine on white but nearly vanishes on the dark card,
  // so down uses the lighter purple tint here instead.)
  let dir = 'flat', arrowColor = DARK.grey2;
  if (fNum != null && pNum != null) {
    if (fNum > pNum) { dir = 'up'; arrowColor = LIGHT.cyan; }
    else if (fNum < pNum) { dir = 'down'; arrowColor = LIGHT.purpleLight; }
  }
  drawArrow(png, prevX + half + 16, rowY + 23, dir, arrowColor);

  return PNG.sync.write(png);
}

module.exports = { generateEconEventCard };
