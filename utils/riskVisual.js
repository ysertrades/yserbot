/**
 * riskVisual.js
 *
 * Renders a glassmorphism-styled PNG for the /risk command. The image
 * carries the actual numbers (symbol, risk, stop, contract counts, dollar
 * amounts) via a hand-drawn pixel font, not decorative placeholder shapes —
 * the embed text stays to a couple of short lines and the image does the
 * rest of the talking.
 *
 * This module intentionally does NOT import from casino/engine.js — the
 * casino module is off-limits and this feature must stay decoupled. The
 * small set of pixel-drawing primitives below mirrors the visual language
 * already established there (flat single-color backgrounds and panels, no
 * gradients) but is implemented independently.
 */

const { PNG } = require('pngjs');

/* ─── Pixel-drawing primitives (glassmorphism helpers, flat — no gradients) ─── */

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
 *  trick that makes translucent "glass" panels possible. */
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

/** Circular ring outline — a bounded double loop, no stepping loop involved. */
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

/** Flat, solid-color ring stroke — a crisp highlight ring, never a soft/blurred glow. */
function _ringStroke(png, cx, cy, radius, color, th = 3) {
  const half = Math.floor(th / 2);
  for (let a = 0; a < 1440; a++) {
    const ang = (a / 1440) * 2 * Math.PI;
    for (let t = -half; t <= half; t++) {
      const r = radius + t;
      _setPx(png, Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r), color);
    }
  }
}

/** Flat single-color background fill — deliberately not a gradient. */
function _flatBg(png, color) {
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) _setPx(png, x, y, color);
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

/** Solid/translucent rounded-rect fill — used for gauges/chips. */
function _fillRoundedRectBlend(png, px, py, w, h, radius, color, alpha) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!_roundedMask(w, h, radius, x, y)) continue;
      _setPxBlend(png, px + x, py + y, color, alpha);
    }
  }
}

/** The signature "glass panel": a rounded, flat-tinted translucent card with
 *  a soft border and a top sheen highlight — one flat color, no gradient. */
function _glassPanel(png, px, py, w, h, opts = {}) {
  const {
    radius = 18,
    tint = [255, 255, 255],
    tintAlpha = 0.07,
    border = [255, 255, 255],
    borderAlpha = 0.25,
  } = opts;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!_roundedMask(w, h, radius, x, y)) continue;
      _setPxBlend(png, px + x, py + y, tint, tintAlpha);
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

/* ─── Pixel font (5×7) — digits, A–Z, and the punctuation needed to render
 *     real dollar amounts, contract counts, and symbol codes in-image ──── */

const GLYPH_W = 5, GLYPH_H = 7;
const FONT = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  'M': ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  'N': ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '$': ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '...#.', '..#..', '..#..', '.#...', '#....', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '%': ['#...#', '#..#.', '...#.', '..#..', '.#...', '.#..#', '#...#'],
  '×': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

/** Draw one character at (x, y) top-left, `scale` px per font pixel. Unknown
 *  characters fall back to a blank space rather than throwing. */
function _drawChar(png, ch, x, y, scale, color) {
  const glyph = FONT[ch.toUpperCase()] || FONT[' '];
  for (let row = 0; row < GLYPH_H; row++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (glyph[row][col] !== '#') continue;
      _fillRect(png, x + col * scale, y + row * scale, scale, scale, color);
    }
  }
}

const GLYPH_GAP = 1; // columns of spacing between characters, in font-pixel units

function _textWidth(text, scale) {
  return text.length * (GLYPH_W + GLYPH_GAP) * scale - GLYPH_GAP * scale;
}

/** Draw a string left-to-right starting at (x, y). */
function _drawText(png, text, x, y, scale, color) {
  let cx = x;
  for (const ch of text) {
    _drawChar(png, ch, cx, y, scale, color);
    cx += (GLYPH_W + GLYPH_GAP) * scale;
  }
}

/** Draw a string horizontally centered on `cx`. */
function _drawTextCentered(png, text, cx, y, scale, color) {
  _drawText(png, text, Math.round(cx - _textWidth(text, scale) / 2), y, scale, color);
}

function _fmtUsdPx(v) {
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ─── Glyphs / icons ──────────────────────────────────────────────────────── */

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
    radius: 20, tint: panelAccent, tintAlpha: viable ? 0.07 : 0.11,
    border: panelAccent, borderAlpha: viable ? 0.35 : 0.5,
  });

  const cx = x + w / 2;
  _drawTextCentered(png, 'STANDARD', cx, y + 16, 2, WHITE);

  // Big contract-count number — the headline figure this card exists to show.
  const bigScale = 6;
  const countStr = String(standard.contracts);
  _drawTextCentered(png, countStr, cx, y + 40, bigScale, viable ? accent : WARN);

  // status badge, top-right corner of the card
  const badgeCx = x + w - 30, badgeCy = y + 30;
  _dotBlend(png, badgeCx, badgeCy, 16, viable ? GOOD : WARN, 0.22);
  if (viable) _drawCheckIcon(png, badgeCx, badgeCy, 14, GOOD);
  else _drawWarningIcon(png, badgeCx, badgeCy, 18, WARN);

  const lineY1 = y + 40 + bigScale * GLYPH_H + 18;
  if (viable) {
    _drawTextCentered(png, `${_fmtUsdPx(standard.riskPerContract)} EACH`, cx, lineY1, 2, WHITE);
    _drawTextCentered(png, `${_fmtUsdPx(riskUsd - standard.totalRisk)} LEFT`, cx, lineY1 + 22, 2, GOOD);
  } else {
    _drawTextCentered(png, 'STOP TOO WIDE', cx, lineY1, 2, WARN);
    _drawTextCentered(png, `MIN ${_fmtUsdPx(standard.riskPerContract)}`, cx, lineY1 + 22, 2, WHITE);
  }
}

function _drawMicroCard(png, x, y, w, h, micro, needsMicro, accent, riskUsd) {
  if (!micro) {
    _glassPanel(png, x, y, w, h, { radius: 20, tint: GRAY, tintAlpha: 0.06, border: GRAY, borderAlpha: 0.24 });
    const cx = x + w / 2;
    _drawTextCentered(png, 'MICRO', cx, y + 16, 2, WHITE);
    _drawUnavailableIcon(png, cx, y + h / 2 + 4, 30, GRAY);
    _drawTextCentered(png, 'NOT AVAILABLE', cx, y + h - 30, 2, GRAY);
    return;
  }

  const viable = micro.contracts >= 1;
  const recommended = needsMicro && viable;
  const panelAccent = recommended ? REC : viable ? accent : WARN;

  _glassPanel(png, x, y, w, h, {
    radius: 20, tint: panelAccent, tintAlpha: viable ? (recommended ? 0.09 : 0.07) : 0.11,
    border: panelAccent, borderAlpha: viable ? (recommended ? 0.55 : 0.35) : 0.5,
  });

  const cx = x + w / 2;
  _drawTextCentered(png, `MICRO ${micro.symbol}`, cx, y + 16, 2, WHITE);

  const bigScale = 6;
  const countStr = String(micro.contracts);
  _drawTextCentered(png, countStr, cx, y + 40, bigScale, viable ? panelAccent : WARN);

  const badgeCx = x + w - 30, badgeCy = y + 30;
  const badgeColor = recommended ? REC : viable ? GOOD : WARN;
  _dotBlend(png, badgeCx, badgeCy, 16, badgeColor, 0.22);
  if (viable) _drawCheckIcon(png, badgeCx, badgeCy, 14, badgeColor);
  else _drawWarningIcon(png, badgeCx, badgeCy, 18, WARN);

  const lineY1 = y + 40 + bigScale * GLYPH_H + 18;
  if (viable) {
    _drawTextCentered(png, `${_fmtUsdPx(micro.riskPerContract)} EACH`, cx, lineY1, 2, WHITE);
    _drawTextCentered(png, `${_fmtUsdPx(riskUsd - micro.totalRisk)} LEFT`, cx, lineY1 + 22, 2, recommended ? REC : GOOD);
  } else {
    _drawTextCentered(png, 'STOP TOO WIDE', cx, lineY1, 2, WARN);
    _drawTextCentered(png, `MIN ${_fmtUsdPx(micro.riskPerContract)}`, cx, lineY1 + 22, 2, WHITE);
  }
}

/* ─── Public entry point ─────────────────────────────────────────────────── */

/**
 * Render the risk-calculator visual as a PNG buffer. Every number shown is
 * pulled straight from `result` — nothing here is decorative placeholder art.
 * @param {object} result - Output of riskCalculator.calculateRisk() (must not be an error result)
 * @returns {Buffer} PNG image data
 */
function generateRiskImage(result) {
  const { standard, micro, needsMicro, riskUsd, stopPoints, symbol, color } = result;

  const W = 900, H = 420;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const accent = _hexToRgb(color);

  _flatBg(png, [15, 18, 28, 255]);

  _glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: accent, tintAlpha: 0.05, border: accent, borderAlpha: 0.35 });

  // ── Header strip: the inputs (symbol / risk / stop), pixel-rendered ──────
  const headerY = 40;
  const headerText = `${symbol}   RISK ${_fmtUsdPx(riskUsd)}   STOP ${stopPoints} PTS`;
  _drawTextCentered(png, headerText, W / 2, headerY, 3, accent);
  for (let x = 70; x < W - 70; x++) _setPxBlend(png, x, headerY + 3 * GLYPH_H + 14, accent, 0.4);

  const cardY = headerY + 3 * GLYPH_H + 32;
  const cardH = H - cardY - 66;
  const cardW = 380, gap = 28;
  const totalCardsW = cardW * 2 + gap;
  const leftX = Math.round((W - totalCardsW) / 2);
  const rightX = leftX + cardW + gap;

  _drawStandardCard(png, leftX, cardY, cardW, cardH, standard, accent, riskUsd);
  _drawMicroCard(png, rightX, cardY, cardW, cardH, micro, needsMicro, accent, riskUsd);

  // ── Bottom recommendation strip ───────────────────────────────────────────
  let rec, recColor;
  if (standard.contracts >= 1 && micro?.contracts >= 1) {
    rec = `USE ${standard.contracts}× ${symbol} OR ${micro.contracts}× ${micro.symbol}`; recColor = GOOD;
  } else if (standard.contracts >= 1) {
    rec = `TRADE ${standard.contracts}× ${symbol}`; recColor = GOOD;
  } else if (micro?.contracts >= 1) {
    rec = `TRADE ${micro.contracts}× ${micro.symbol}`; recColor = REC;
  } else {
    rec = 'RAISE RISK OR TIGHTEN STOP'; recColor = WARN;
  }
  _drawTextCentered(png, rec, W / 2, H - 44, 3, recColor);

  return PNG.sync.write(png);
}

module.exports = { generateRiskImage };
