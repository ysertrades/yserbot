'use strict';

/**
 * econEventVisual.js
 *
 * One economic-calendar release, rendered as its own pixel-art card in the
 * same flat-glassmorphism house style as /risk — a "signal bars" badge for
 * impact strength, a currency chip, and a forecast-vs-previous comparison
 * with a directional arrow, all baked into the image itself so the card
 * reads at a glance in the channel without anyone having to open it.
 * Deliberately built on the shared pixelArt.js toolkit only, independent of
 * casino/engine.js.
 */

const {
  PNG, dotBlend, ringStroke, line, flatBg, glassPanel,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, GLYPH_H,
} = require('./pixelArt');

const IMPACT_COLOR = {
  High:    [239, 68, 68, 255],
  Medium:  [245, 158, 11, 255],
  Low:     [149, 165, 166, 255],
  Holiday: [139, 92, 246, 255],
};
const WHITE = [255, 255, 255, 255];
const GRAY  = [150, 156, 168, 255];
const GOOD  = [46, 204, 113, 255];
const WARN  = [231, 76, 60, 255];

// A little "signal strength" badge instead of a plain dot — 3 bars for
// High, 2 for Medium, 1 for Low, a flag glyph for Holiday. Reads as a
// severity gauge at a glance, no legend needed.
function drawImpactBadge(png, cx, cy, impact, color) {
  dotBlend(png, cx, cy, 36, color, 0.14);
  ringStroke(png, cx, cy, 36, color, 3);

  if (impact === 'Holiday') {
    line(png, cx - 11, cy - 16, cx - 11, cy + 16, color, 3);
    fillRoundedRectBlend(png, cx - 9, cy - 16, 22, 13, 2, color, 0.9);
    return;
  }

  const bars = impact === 'High' ? 3 : impact === 'Medium' ? 2 : 1;
  for (let i = 0; i < 3; i++) {
    const bh = 10 + i * 8;
    const on = i < bars;
    fillRoundedRectBlend(png, cx - 21 + i * 15, cy + 17 - bh, 10, bh, 2, on ? color : WHITE, on ? 1 : 0.15);
  }
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function drawArrow(png, cx, cy, dir, color) {
  if (dir === 'flat') { line(png, cx - 11, cy, cx + 11, cy, color, 3); return; }
  const tipY  = dir === 'up' ? cy - 11 : cy + 11;
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

  flatBg(png, [14, 16, 24, 255]);
  glassPanel(png, 14, 14, W - 28, H - 28, { radius: 22, tint: accent, tintAlpha: 0.06, border: accent, borderAlpha: 0.4 });

  // ── Impact badge, far left ────────────────────────────────────────────────
  drawImpactBadge(png, 78, H / 2 - 6, impact, accent);
  drawTextCentered(png, (impact || 'LOW').toUpperCase(), 78, H - 32, 1, accent);

  // ── Currency chip ─────────────────────────────────────────────────────────
  const chipX = 138, chipY = 28, chipW = 96, chipH = 34;
  fillRoundedRectBlend(png, chipX, chipY, chipW, chipH, 10, accent, 0.2);
  drawTextCentered(png, currency || '—', chipX + chipW / 2, chipY + 10, 2, WHITE);

  // ── Time / status chip, top-right — same bold weight as the title/currency
  //    chip (scale 2) instead of the old scale-1 fine print that got lost ──
  const timeText = (timeLabel || '').toUpperCase();
  const timeChipW = Math.min(340, 40 + textWidth(timeText, 2));
  const timeChipX = W - 24 - timeChipW;
  fillRoundedRectBlend(png, timeChipX, 28, timeChipW, 34, 10, WHITE, 0.14);
  drawTextCentered(png, timeText, timeChipX + timeChipW / 2, 38, 2, WHITE);

  // ── Title, word-wrapped to 2 lines max ────────────────────────────────────
  const titleMaxW = timeChipX - 138 - 20;
  const wrapped = wrapText(String(title || '').toUpperCase(), 2, titleMaxW);
  const shown = wrapped.slice(0, 2);
  if (wrapped.length > 2) {
    let last = shown[1] || '';
    while (last.length > 0 && textWidth(`${last}...`, 2) > titleMaxW) last = last.slice(0, -1);
    shown[1] = `${last}...`;
  }
  let ty = 78;
  for (const l of shown) {
    drawText(png, l, 138, ty, 2, WHITE);
    ty += GLYPH_H * 2 + 8;
  }

  // ── Forecast vs Previous row ──────────────────────────────────────────────
  const rowY = H - 68, half = 300, prevX = 138, foreX = prevX + half + 32;
  fillRoundedRectBlend(png, prevX, rowY, half, 46, 8, WHITE, 0.05);
  drawText(png, 'PREVIOUS', prevX + 14, rowY + 8, 1, GRAY);
  drawText(png, previous || 'N/A', prevX + 14, rowY + 22, 2, WHITE);

  fillRoundedRectBlend(png, foreX, rowY, half, 46, 8, WHITE, 0.05);
  drawText(png, 'FORECAST', foreX + 14, rowY + 8, 1, GRAY);
  drawText(png, forecast || 'N/A', foreX + 14, rowY + 22, 2, accent);

  const fNum = parseNum(forecast), pNum = parseNum(previous);
  let dir = 'flat', arrowColor = GRAY;
  if (fNum != null && pNum != null) {
    if (fNum > pNum) { dir = 'up'; arrowColor = GOOD; }
    else if (fNum < pNum) { dir = 'down'; arrowColor = WARN; }
  }
  drawArrow(png, prevX + half + 16, rowY + 23, dir, arrowColor);

  return PNG.sync.write(png);
}

module.exports = { generateEconEventCard };
