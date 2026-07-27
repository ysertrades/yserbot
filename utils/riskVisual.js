/**
 * riskVisual.js
 *
 * Renders a glassmorphism-styled PNG for the /risk command: a dark gradient
 * backdrop, a translucent "glass" outer panel, and two inner glass cards
 * (standard contract / micro contract) with icon glyphs, a usage gauge, and
 * status badges (viable / warning / recommended / unavailable).
 *
 * This module intentionally does NOT import from casino/engine.js — the
 * casino module is off-limits and this feature must stay decoupled. The
 * small set of pixel-drawing primitives below (alpha blending, rounded
 * glass panels, radial glow, guarded Bresenham lines) mirrors the visual
 * language already established there so the bot's look stays consistent,
 * but is implemented independently.
 *
 * Only pure graphics are drawn here — exact numbers/labels stay in the
 * Discord embed text, matching how the rest of the bot's game visuals work.
 */

const { PNG } = require('pngjs');

/* ─── Pixel-drawing primitives (glassmorphism helpers) ──────────────────── */

function _setPx(png, x, y, c) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) * 4;
  png.data[i] = c[0];
  png.data[i + 1] = c[1];
  png.data[i + 2] = c[2];
  png.data[i + 3] = c[3] === undefined ? 255 : c[3];
}

function _blendColor(bg, fg, alpha) {
  return [
    Math.round(bg[0] + (fg[0] - bg[0]) * alpha),
    Math.round(bg[1] + (fg[1] - bg[1]) * alpha),
    Math.round(bg[2] + (fg[2] - bg[2]) * alpha),
    255,
  ];
}

/** Alpha-blend a color onto whatever pixel is already there — the core
 *  trick that makes translucent "glass" panels/glows possible. */
function _setPxBlend(png, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height || alpha <= 0) return;
  if (alpha >= 1) { _setPx(png, x, y, color); return; }
  const i = (png.width * y + x) * 4;
  const bg = [png.data[i], png.data[i + 1], png.data[i + 2]];
  _setPx(png, x, y, _blendColor(bg, color, alpha));
}

function _fillRect(png, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) _setPx(png, xx, yy, c);
  }
}

// Bresenham stepping only ever moves by whole pixels, so the exit condition
// (x === x2 && y === y2) can only be reached if the endpoints are integers —
// a fractional target would step past it forever. Round defensively here,
// and keep a hard iteration cap as a backstop against any other edge case.
function _line(png, x1, y1, x2, y2, c, th = 1) {
  x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
  const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
  let err = dx + dy, x = x1, y = y1;
  const halfTh = Math.floor(th / 2);
  let guard = (Math.abs(dx) + Math.abs(dy)) * 2 + th * 4 + 16;
  while (true) {
    for (let tx = -halfTh; tx <= halfTh; tx++) {
      for (let ty = -halfTh; ty <= halfTh; ty++) _setPx(png, x + tx, y + ty, c);
    }
    if (x === x2 && y === y2) break;
    if (--guard <= 0) break; // safety net — should be unreachable with integer endpoints
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function _dot(png, x, y, radius, c) {
  x = Math.round(x); y = Math.round(y);
  const r2 = radius * radius;
  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      if ((xx * xx) + (yy * yy) <= r2) _setPx(png, x + xx, y + yy, c);
    }
  }
}

function _dotBlend(png, x, y, radius, c, alpha) {
  x = Math.round(x); y = Math.round(y);
  const r2 = radius * radius;
  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      if ((xx * xx) + (yy * yy) <= r2) _setPxBlend(png, x + xx, y + yy, c, alpha);
    }
  }
}

/** Circular ring outline (used for the target/reticle emblem + "unavailable"
 *  glyph) — a bounded double loop, no stepping loop involved, so it can't hang. */
function _ringBlend(png, cx, cy, r, th, color, alpha) {
  cx = Math.round(cx); cy = Math.round(cy);
  const r0 = Math.max(0, r - th), r1 = r;
  const x0 = Math.max(0, cx - r1), x1b = Math.min(png.width - 1, cx + r1);
  const y0 = Math.max(0, cy - r1), y1b = Math.min(png.height - 1, cy + r1);
  for (let y = y0; y <= y1b; y++) {
    for (let x = x0; x <= x1b; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= r0 && d <= r1) _setPxBlend(png, x, y, color, alpha);
    }
  }
}

/** Soft radial glow — many concentric alpha-fading rings. */
function _radialGlow(png, cx, cy, radius, color, maxAlpha = 0.4) {
  cx = Math.round(cx); cy = Math.round(cy);
  const x0 = Math.max(0, cx - radius), x1 = Math.min(png.width - 1, cx + radius);
  const y0 = Math.max(0, cy - radius), y1 = Math.min(png.height - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      _setPxBlend(png, x, y, color, maxAlpha * (1 - d / radius));
    }
  }
}

function _vGradientBg(png, top, bottom) {
  for (let y = 0; y < png.height; y++) {
    const t = y / Math.max(1, png.height - 1);
    const c = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
      255,
    ];
    for (let x = 0; x < png.width; x++) _setPx(png, x, y, c);
  }
}

function _roundedMask(w, h, radius, x, y) {
  const rx = Math.min(radius, w / 2), ry = Math.min(radius, h / 2);
  if (x < rx && y < ry) return Math.hypot(rx - x, ry - y) <= rx;
  if (x >= w - rx && y < ry) return Math.hypot(x - (w - rx), ry - y) <= rx;
  if (x < rx && y >= h - ry) return Math.hypot(rx - x, y - (h - ry)) <= rx;
  if (x >= w - rx && y >= h - ry) return Math.hypot(x - (w - rx), y - (h - ry)) <= rx;
  return true;
}

/** Solid/translucent rounded-rect fill — used for icon "chips" and gauges. */
function _fillRoundedRectBlend(png, px, py, w, h, radius, color, alpha) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!_roundedMask(w, h, radius, x, y)) continue;
      _setPxBlend(png, px + x, py + y, color, alpha);
    }
  }
}

/** The signature "glass panel": a rounded, faintly-tinted translucent card
 *  with a soft border and a top sheen highlight. */
function _glassPanel(png, px, py, w, h, opts = {}) {
  const {
    radius = 18,
    tint = [255, 255, 255],
    tintAlpha = 0.07,
    tintAlphaBottom = 0.025,
    border = [255, 255, 255],
    borderAlpha = 0.25,
  } = opts;

  for (let y = 0; y < h; y++) {
    const t = y / h;
    const a = tintAlpha + (tintAlphaBottom - tintAlpha) * t;
    for (let x = 0; x < w; x++) {
      if (!_roundedMask(w, h, radius, x, y)) continue;
      _setPxBlend(png, px + x, py + y, tint, a);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!_roundedMask(w, h, radius, x, y)) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || !_roundedMask(w, h, radius, x - 1, y) || !_roundedMask(w, h, radius, x + 1, y)
        || !_roundedMask(w, h, radius, x, y - 1) || !_roundedMask(w, h, radius, x, y + 1);
      if (edge) _setPxBlend(png, px + x, py + y, border, borderAlpha);
    }
  }
  const sheenEnd = Math.max(radius, w - radius);
  for (let x = radius; x < sheenEnd; x++) _setPxBlend(png, px + x, py + 2, [255, 255, 255], 0.18);
}

function _hexToRgb(hex) {
  const v = typeof hex === 'number' ? hex : 0x474747;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}

/* ─── Glyphs / icons ──────────────────────────────────────────────────────── */

/** Central "target" emblem — thematically ties to risk/aim, symbol-tinted. */
function _drawTargetEmblem(png, cx, cy, color) {
  _radialGlow(png, cx, cy, 90, color, 0.30);
  _ringBlend(png, cx, cy, 44, 3, color, 0.9);
  _ringBlend(png, cx, cy, 28, 2, color, 0.55);
  _dotBlend(png, cx, cy, 6, color, 0.95);
  _line(png, cx - 62, cy, cx - 50, cy, color, 2);
  _line(png, cx + 50, cy, cx + 62, cy, color, 2);
  _line(png, cx, cy - 62, cx, cy - 50, color, 2);
  _line(png, cx, cy + 50, cx, cy + 62, color, 2);
}

/** Stack of chip-like blocks representing "contracts" — bigger/fewer for
 *  standard, smaller/more numerous for micro (visually reads as "smaller
 *  denomination"). */
function _drawStackIcon(png, cx, topY, color, opts = {}) {
  const { count = 3, blockW = 140, blockH = 16, gap = 10, alphaBase = 0.85, alphaStep = 0.13 } = opts;
  for (let i = 0; i < count; i++) {
    const w = Math.max(20, blockW - i * (blockW * 0.14));
    const y = topY + i * (blockH + gap);
    const alpha = Math.max(0.25, alphaBase - i * alphaStep);
    _fillRoundedRectBlend(png, Math.round(cx - w / 2), y, Math.round(w), blockH, 5, color, alpha);
    _setPxBlend(png, Math.round(cx - w / 2) + 4, y + 2, [255, 255, 255, 255], 0.25);
  }
}

function _drawCheckIcon(png, cx, cy, size, color) {
  _line(png, cx - size * 0.5, cy, cx - size * 0.1, cy + size * 0.45, color, 3);
  _line(png, cx - size * 0.1, cy + size * 0.45, cx + size * 0.55, cy - size * 0.45, color, 3);
}

function _drawWarningIcon(png, cx, cy, size, color) {
  const h = size, w = size * 1.15;
  const top = [cx, cy - h / 2];
  const left = [cx - w / 2, cy + h / 2];
  const right = [cx + w / 2, cy + h / 2];
  _line(png, top[0], top[1], left[0], left[1], color, 3);
  _line(png, left[0], left[1], right[0], right[1], color, 3);
  _line(png, right[0], right[1], top[0], top[1], color, 3);
  _line(png, cx, cy - h * 0.08, cx, cy + h * 0.18, color, 3);
  _dot(png, cx, cy + h * 0.34, 2, color);
}

function _drawUnavailableIcon(png, cx, cy, r, color) {
  _ringBlend(png, cx, cy, r, 3, color, 0.85);
  _line(png, cx - r * 0.68, cy + r * 0.68, cx + r * 0.68, cy - r * 0.68, color, 3);
}

/** Horizontal "budget used" gauge — empty track + colored fill, glass style. */
function _drawGauge(png, x, y, w, h, ratio, fillColor) {
  const r = Math.floor(h / 2);
  _fillRoundedRectBlend(png, x, y, w, h, r, [255, 255, 255, 255], 0.12);
  const clamped = Math.min(1, Math.max(0, ratio));
  const fw = Math.round(w * clamped);
  if (fw >= 2) {
    _fillRoundedRectBlend(png, x, y, Math.max(fw, h), h, r, fillColor, 0.85);
    _setPxBlend(png, x + 2, y + 1, [255, 255, 255, 255], 0.35);
  }
}

/* ─── Card composition ───────────────────────────────────────────────────── */

const GOOD = [46, 204, 113, 255];
const WARN = [231, 76, 60, 255];
const REC = [241, 196, 15, 255];
const GRAY = [140, 148, 160, 255];
const WHITE = [255, 255, 255, 255];

function _drawStandardCard(png, x, y, w, h, standard, accent, riskUsd) {
  const viable = standard.contracts >= 1;
  const panelAccent = viable ? accent : WARN;

  _glassPanel(png, x, y, w, h, {
    radius: 20,
    tint: panelAccent,
    tintAlpha: viable ? 0.06 : 0.10,
    tintAlphaBottom: 0.02,
    border: panelAccent,
    borderAlpha: viable ? 0.32 : 0.5,
  });

  const cx = x + w / 2;
  _drawStackIcon(png, cx, y + 24, viable ? accent : GRAY, { count: 3, blockW: 150, blockH: 18, gap: 12 });

  // status badge, top-right corner of the card
  const badgeCx = x + w - 34, badgeCy = y + 32;
  _dotBlend(png, badgeCx, badgeCy, 18, viable ? GOOD : WARN, 0.20);
  if (viable) _drawCheckIcon(png, badgeCx, badgeCy, 16, GOOD);
  else _drawWarningIcon(png, badgeCx, badgeCy, 20, WARN);

  // usage gauge near the bottom
  const ratio = viable ? standard.totalRisk / riskUsd : 0;
  _drawGauge(png, x + 36, y + h - 40, w - 72, 16, ratio, viable ? GOOD : WARN);
}

function _drawMicroCard(png, x, y, w, h, micro, needsMicro, accent, riskUsd) {
  if (!micro) {
    _glassPanel(png, x, y, w, h, {
      radius: 20, tint: GRAY, tintAlpha: 0.05, tintAlphaBottom: 0.015,
      border: GRAY, borderAlpha: 0.22,
    });
    _drawUnavailableIcon(png, x + w / 2, y + h / 2 - 6, 34, GRAY);
    return;
  }

  const viable = micro.contracts >= 1;
  const recommended = needsMicro && viable;
  const panelAccent = recommended ? REC : viable ? accent : WARN;

  if (recommended) _radialGlow(png, x + w / 2, y + h / 2, Math.round(Math.max(w, h) * 0.65), REC, 0.10);

  _glassPanel(png, x, y, w, h, {
    radius: 20,
    tint: panelAccent,
    tintAlpha: viable ? (recommended ? 0.08 : 0.06) : 0.10,
    tintAlphaBottom: 0.02,
    border: panelAccent,
    borderAlpha: viable ? (recommended ? 0.5 : 0.32) : 0.5,
  });

  const cx = x + w / 2;
  _drawStackIcon(png, cx, y + 20, viable ? panelAccent : GRAY, { count: 5, blockW: 110, blockH: 10, gap: 6 });

  const badgeCx = x + w - 34, badgeCy = y + 32;
  const badgeColor = recommended ? REC : viable ? GOOD : WARN;
  _dotBlend(png, badgeCx, badgeCy, 18, badgeColor, 0.20);
  if (viable) _drawCheckIcon(png, badgeCx, badgeCy, 16, badgeColor);
  else _drawWarningIcon(png, badgeCx, badgeCy, 20, WARN);

  const ratio = viable ? micro.totalRisk / riskUsd : 0;
  _drawGauge(png, x + 36, y + h - 40, w - 72, 16, ratio, recommended ? REC : viable ? GOOD : WARN);
}

/* ─── Public entry point ─────────────────────────────────────────────────── */

/**
 * Render the risk-calculator visual as a PNG buffer.
 * @param {object} result - Output of riskCalculator.calculateRisk() (must not be an error result)
 * @returns {Buffer} PNG image data
 */
function generateRiskImage(result) {
  const { standard, micro, needsMicro, riskUsd, color } = result;

  const W = 900, H = 420;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const accent = _hexToRgb(color);

  _vGradientBg(png, [13, 16, 26, 255], [21, 25, 38, 255]);
  _radialGlow(png, 130, 90, 220, accent, 0.12);
  _radialGlow(png, W - 130, H - 90, 240, needsMicro ? WARN : GOOD, 0.10);

  _glassPanel(png, 20, 20, W - 40, H - 40, {
    radius: 28, tint: accent, tintAlpha: 0.05, tintAlphaBottom: 0.02,
    border: accent, borderAlpha: 0.35,
  });

  const cx = Math.floor(W / 2);
  _drawTargetEmblem(png, cx, 92, accent);

  for (let x = 70; x < W - 70; x++) _setPxBlend(png, x, 150, accent, 0.16);

  const cardY = 168, cardH = 210, cardW = 380, gap = 28;
  const leftX = 56;
  const rightX = leftX + cardW + gap;

  _drawStandardCard(png, leftX, cardY, cardW, cardH, standard, accent, riskUsd);
  _drawMicroCard(png, rightX, cardY, cardW, cardH, micro, needsMicro, accent, riskUsd);

  return PNG.sync.write(png);
}

module.exports = { generateRiskImage };
