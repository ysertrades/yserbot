/**
 * pixelArt.js
 *
 * Shared pixel-drawing toolkit (flat glassmorphism panels, a hand-drawn 5×7
 * pixel font, and basic shape primitives) for standalone command visuals
 * that render a real PNG rather than relying on embed text — the same
 * visual language riskVisual.js established. Deliberately independent of
 * casino/engine.js (that module is off-limits to keep these features
 * decoupled), so this is the shared base new visual-driven commands
 * (fish/mine/trivia, etc.) build on instead of each re-implementing its own
 * copy of these primitives.
 */

const { PNG } = require('pngjs');

/* ─── Low-level pixel ops ─────────────────────────────────────────────────── */

// A fractional y silently corrupts the row/column mapping here — width*y
// only lands on a clean row boundary when y is a whole number, so a
// fractional y can bleed a write into a neighboring row at a shifted
// column instead of just landing "slightly off" within the intended one.
// Every primitive in this file already rounds before calling this, but
// round defensively here too since the failure mode (pixels landing
// somewhere else on the canvas entirely, no error) is brutal to debug.
function setPx(png, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) * 4;
  png.data[i] = c[0];
  png.data[i + 1] = c[1];
  png.data[i + 2] = c[2];
  png.data[i + 3] = c[3] === undefined ? 255 : c[3];
}

function blendColor(bg, fg, alpha) {
  return [
    Math.round(bg[0] + (fg[0] - bg[0]) * alpha),
    Math.round(bg[1] + (fg[1] - bg[1]) * alpha),
    Math.round(bg[2] + (fg[2] - bg[2]) * alpha),
    255,
  ];
}

function setPxBlend(png, x, y, color, alpha) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= png.width || y >= png.height || alpha <= 0) return;
  if (alpha >= 1) { setPx(png, x, y, color); return; }
  const i = (png.width * y + x) * 4;
  const bg = [png.data[i], png.data[i + 1], png.data[i + 2]];
  setPx(png, x, y, blendColor(bg, color, alpha));
}

function fillRect(png, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPx(png, xx, yy, c);
  }
}

function fillRectBlend(png, x, y, w, h, c, alpha) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPxBlend(png, xx, yy, c, alpha);
  }
}

// Bresenham stepping only ever moves by whole pixels, so the exit condition
// (x === x2 && y === y2) can only be reached if the endpoints are integers —
// round defensively and keep a hard iteration cap as a backstop.
function line(png, x1, y1, x2, y2, c, th = 1) {
  x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
  const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
  let err = dx + dy, x = x1, y = y1;
  const halfTh = Math.floor(th / 2);
  let guard = (Math.abs(dx) + Math.abs(dy)) * 2 + th * 4 + 16;
  while (true) {
    for (let tx = -halfTh; tx <= halfTh; tx++) {
      for (let ty = -halfTh; ty <= halfTh; ty++) setPx(png, x + tx, y + ty, c);
    }
    if (x === x2 && y === y2) break;
    if (--guard <= 0) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function dot(png, x, y, radius, c) {
  x = Math.round(x); y = Math.round(y);
  const r2 = radius * radius;
  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      if ((xx * xx) + (yy * yy) <= r2) setPx(png, x + xx, y + yy, c);
    }
  }
}

function dotBlend(png, x, y, radius, c, alpha) {
  x = Math.round(x); y = Math.round(y);
  const r2 = radius * radius;
  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      if ((xx * xx) + (yy * yy) <= r2) setPxBlend(png, x + xx, y + yy, c, alpha);
    }
  }
}

function ringBlend(png, cx, cy, r, th, color, alpha) {
  cx = Math.round(cx); cy = Math.round(cy);
  const r0 = Math.max(0, r - th), r1 = r;
  const x0 = Math.max(0, cx - r1), x1b = Math.min(png.width - 1, cx + r1);
  const y0 = Math.max(0, cy - r1), y1b = Math.min(png.height - 1, cy + r1);
  for (let y = y0; y <= y1b; y++) {
    for (let x = x0; x <= x1b; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= r0 && d <= r1) setPxBlend(png, x, y, color, alpha);
    }
  }
}

/** Flat, solid-color ring stroke — a crisp highlight ring, never soft/blurred. */
function ringStroke(png, cx, cy, radius, color, th = 3) {
  const half = Math.floor(th / 2);
  for (let a = 0; a < 1440; a++) {
    const ang = (a / 1440) * 2 * Math.PI;
    for (let t = -half; t <= half; t++) {
      const r = radius + t;
      setPx(png, Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r), color);
    }
  }
}

/** Flat single-color background fill — deliberately not a gradient. */
function flatBg(png, color) {
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) setPx(png, x, y, color);
  }
}

function roundedMask(w, h, radius, x, y) {
  const rx = Math.min(radius, w / 2), ry = Math.min(radius, h / 2);
  if (x < rx && y < ry) return Math.hypot(rx - x, ry - y) <= rx;
  if (x >= w - rx && y < ry) return Math.hypot(x - (w - rx), ry - y) <= rx;
  if (x < rx && y >= h - ry) return Math.hypot(rx - x, y - (h - ry)) <= rx;
  if (x >= w - rx && y >= h - ry) return Math.hypot(x - (w - rx), y - (h - ry)) <= rx;
  return true;
}

/** Solid/translucent rounded-rect fill — used for gauges/chips/full-canvas panels. */
function fillRoundedRectBlend(png, px, py, w, h, radius, color, alpha) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!roundedMask(w, h, radius, x, y)) continue;
      setPxBlend(png, px + x, py + y, color, alpha);
    }
  }
}

/** The signature "glass panel": a rounded, flat-tinted translucent card with
 *  a soft border and a top sheen highlight — one flat color, no gradient. */
function glassPanel(png, px, py, w, h, opts = {}) {
  const {
    radius = 18,
    tint = [255, 255, 255],
    tintAlpha = 0.07,
    border = [255, 255, 255],
    borderAlpha = 0.25,
  } = opts;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!roundedMask(w, h, radius, x, y)) continue;
      setPxBlend(png, px + x, py + y, tint, tintAlpha);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!roundedMask(w, h, radius, x, y)) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || !roundedMask(w, h, radius, x - 1, y) || !roundedMask(w, h, radius, x + 1, y)
        || !roundedMask(w, h, radius, x, y - 1) || !roundedMask(w, h, radius, x, y + 1);
      if (edge) setPxBlend(png, px + x, py + y, border, borderAlpha);
    }
  }
  const sheenEnd = Math.max(radius, w - radius);
  for (let x = radius; x < sheenEnd; x++) setPxBlend(png, px + x, py + 2, [255, 255, 255], 0.18);
}

function hexToRgb(hex) {
  const v = typeof hex === 'number' ? hex : 0x474747;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}

/* ─── Pixel font (5×7) — digits, A–Z, and common punctuation ─────────────── */

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
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '?': ['.###.', '#...#', '...#.', '..#..', '..#..', '.....', '..#..'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '/': ['....#', '...#.', '..#..', '..#..', '.#...', '#....', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '%': ['#...#', '#..#.', '...#.', '..#..', '.#...', '.#..#', '#...#'],
  '×': ['.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '.....'],
  "'": ['.##..', '.##..', '..#..', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

function drawChar(png, ch, x, y, scale, color) {
  const glyph = FONT[ch.toUpperCase()] || FONT[' '];
  for (let row = 0; row < GLYPH_H; row++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (glyph[row][col] !== '#') continue;
      fillRect(png, x + col * scale, y + row * scale, scale, scale, color);
    }
  }
}

const GLYPH_GAP = 1; // columns of spacing between characters, in font-pixel units

// Discord names can contain anything — accented Latin, emoji, CJK, Cyrillic,
// symbols we've never drawn a glyph for. Decompose accents down to their
// plain base letter (é -> e, ñ -> n, ...) so those degrade gracefully
// instead of vanishing, and drop anything that still has no glyph entirely
// rather than falling back to a blank space-width gap — a silently-skipped
// blank character used to be indistinguishable from a real space, which
// visibly split names apart (e.g. "Y_ssi" rendering as "Y SSI").
const COMBINING_MARKS_RE = new RegExp('[\\u0300-\\u036f]', 'g'); // combining diacritical marks block

// "Fancy font" name generators love swapping in visually-similar letters from
// other scripts (Greek, Cyrillic) — unlike the math-alphanumeric/circled/
// fullwidth styles above, these are genuinely different characters with no
// Unicode decomposition back to Latin, so NFKD alone can't recover them.
// Hand-mapped to their closest Latin lookalike so a name like "YΛSSIΓ"
// reads as "YASSIR" instead of dropping both letters entirely.
const SCRIPT_CONFUSABLES = {
  // Greek uppercase
  'Α': 'A', 'Β': 'B', 'Γ': 'R', 'Δ': 'A', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Θ': 'O',
  'Ι': 'I', 'Κ': 'K', 'Λ': 'A', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'E', 'Ο': 'O', 'Ρ': 'P',
  'Σ': 'E', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'O', 'Χ': 'X', 'Ψ': 'Y', 'Ω': 'O',
  // Greek lowercase
  'α': 'a', 'β': 'b', 'γ': 'y', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'n', 'θ': 'o',
  'ι': 'i', 'κ': 'k', 'λ': 'a', 'μ': 'u', 'ν': 'v', 'ξ': 'e', 'ο': 'o', 'ρ': 'p',
  'σ': 'o', 'τ': 't', 'υ': 'u', 'φ': 'o', 'χ': 'x', 'ψ': 'y', 'ω': 'w',
  // Cyrillic uppercase
  'А': 'A', 'Б': 'B', 'В': 'B', 'Г': 'R', 'Д': 'D', 'Е': 'E', 'Ж': 'X', 'З': '3',
  'И': 'N', 'Й': 'N', 'К': 'K', 'Л': 'A', 'М': 'M', 'Н': 'H', 'О': 'O', 'П': 'N',
  'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Ф': 'O', 'Х': 'X', 'Ц': 'U', 'Ч': 'Y',
  'Ш': 'W', 'Щ': 'W', 'Ъ': 'B', 'Ы': 'B', 'Ь': 'B', 'Э': 'E', 'Ю': 'U', 'Я': 'R',
  // Cyrillic lowercase
  'а': 'a', 'б': '6', 'в': 'b', 'г': 'r', 'д': 'd', 'е': 'e', 'ж': 'x', 'з': '3',
  'и': 'n', 'й': 'n', 'к': 'k', 'л': 'a', 'м': 'm', 'н': 'h', 'о': 'o', 'п': 'n',
  'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'ф': 'o', 'х': 'x', 'ц': 'u', 'ч': 'y',
  'ш': 'w', 'щ': 'w', 'ъ': 'b', 'ы': 'b', 'ь': 'b', 'э': 'e', 'ю': 'u', 'я': 'r',
};

function normalizeForFont(text) {
  const decomposed = String(text).normalize('NFKD').replace(COMBINING_MARKS_RE, '');
  let out = '';
  for (const ch of decomposed) out += SCRIPT_CONFUSABLES[ch] || ch;
  return out;
}

function hasGlyph(ch) {
  return Object.prototype.hasOwnProperty.call(FONT, ch.toUpperCase());
}

function textWidth(text, scale) {
  const chars = [...normalizeForFont(text)].filter(hasGlyph);
  if (chars.length === 0) return 0;
  return chars.length * (GLYPH_W + GLYPH_GAP) * scale - GLYPH_GAP * scale;
}

function drawText(png, text, x, y, scale, color) {
  let cx = x;
  for (const ch of normalizeForFont(text)) {
    if (!hasGlyph(ch)) continue;
    drawChar(png, ch, cx, y, scale, color);
    cx += (GLYPH_W + GLYPH_GAP) * scale;
  }
}

function drawTextCentered(png, text, cx, y, scale, color) {
  drawText(png, text, Math.round(cx - textWidth(text, scale) / 2), y, scale, color);
}

// Wraps text to a max pixel width at a given scale, returning an array of
// lines (word-aware — never splits mid-word).
function wrapText(text, scale, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (textWidth(candidate, scale) > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

module.exports = {
  PNG,
  setPx, setPxBlend, blendColor,
  fillRect, fillRectBlend, line, dot, dotBlend, ringBlend, ringStroke,
  flatBg, roundedMask, fillRoundedRectBlend, glassPanel, hexToRgb,
  GLYPH_W, GLYPH_H, GLYPH_GAP,
  drawChar, drawText, drawTextCentered, textWidth, wrapText,
};
