'use strict';

/**
 * socialMarks.js
 *
 * The four platform marks, drawn.
 *
 * The Social screen and the cards the bot posts both used an emoji — ▶️ 🎵 📸
 * and a mathematical X, because those are the nearest thing in the Unicode
 * table. They read as approximations, which is exactly what they are: the
 * play button is orange on some phones, the camera is a camera rather than
 * Instagram's, and the X is a letter.
 *
 * These are the real shapes instead, in the real colours, generated the same
 * way as every other image in this bot: no asset pipeline, nothing to fall out
 * of sync, one function that the panel and Discord both read from.
 *
 * ── Why a filled circle rather than a transparent square ─────────────────
 *
 * Discord crops an embed's author icon to a circle. A square logo handed to it
 * loses its corners, so each mark is drawn as a full-bleed disc in its own
 * brand background — which is how the same logo looks as an app icon anyway.
 *
 * ── Why it is drawn at 4× and shrunk ─────────────────────────────────────
 *
 * Every shape here is a curve or a diagonal, and this toolkit has no
 * anti-aliasing. Rendering each pixel from sixteen samples is what stops the
 * play button's edge and Instagram's ring looking like a staircase.
 */

const { PNG } = require('./pixelArt');

const SS = 4;               // samples per axis
const SAMPLES = SS * SS;

/* ─── colours ────────────────────────────────────────────────────────────── */

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

const YT_RED = [255, 0, 0];
// X's own near-black. Not #000000: Discord reads an embed colour of zero as
// "no colour set" and draws its default grey, so pure black is the one black
// that cannot be used.
const X_BLACK = [15, 20, 25];
const TT_CYAN = [37, 244, 238];
const TT_RED = [254, 44, 85];

// Instagram's gradient, corner to corner.
const IG_STOPS = [
  [0.00, [255, 216, 117]],
  [0.25, [250, 141, 77]],
  [0.50, [245, 78, 108]],
  [0.75, [219, 55, 160]],
  [1.00, [137, 63, 212]],
];

function gradientAt(t) {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 1; i < IG_STOPS.length; i++) {
    const [p0, c0] = IG_STOPS[i - 1];
    const [p1, c1] = IG_STOPS[i];
    if (clamped <= p1) {
      const k = (clamped - p0) / (p1 - p0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  return IG_STOPS[IG_STOPS.length - 1][1];
}

/* ─── shape tests, all in a 0..1 square ──────────────────────────────────── */

const inDisc = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function inRoundedRect(x, y, left, top, w, h, r) {
  if (x < left || y < top || x > left + w || y > top + h) return false;
  const rx = Math.min(r, w / 2), ry = Math.min(r, h / 2);
  const dx = x < left + rx ? left + rx - x : x > left + w - rx ? x - (left + w - rx) : 0;
  const dy = y < top + ry ? top + ry - y : y > top + h - ry ? y - (top + h - ry) : 0;
  return dx * dx + dy * dy <= rx * ry;
}

/** Which side of the line ab the point p falls on. */
const side = (px, py, ax, ay, bx, by) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

function inTriangle(px, py, a, b, c) {
  const d1 = side(px, py, a[0], a[1], b[0], b[1]);
  const d2 = side(px, py, b[0], b[1], c[0], c[1]);
  const d3 = side(px, py, c[0], c[1], a[0], a[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** A thick line segment with round ends. */
function inCapsule(px, py, ax, ay, bx, by, r) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + dx * t, qy = ay + dy * t;
  return (px - qx) ** 2 + (py - qy) ** 2 <= r * r;
}

/**
 * Even-odd point-in-polygon.
 *
 * Even-odd rather than winding because that is the rule the mark below is
 * drawn with: X's logo is one outline with a second, smaller outline punched
 * through it, and the punch only reads as a hole under this rule.
 */
function inPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A quadratic curve, as a run of capsules. Enough for a note's flag. */
function inCurve(px, py, p0, p1, p2, r, steps = 24) {
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const cur = [
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ];
    if (inCapsule(px, py, prev[0], prev[1], cur[0], cur[1], r)) return true;
    prev = cur;
  }
  return false;
}

/* ─── X's outline ────────────────────────────────────────────────────────── */

/**
 * The mark, as its own geometry: the outer shape and the slot punched through
 * it where the two strokes cross. Coordinates are the 24-unit square the logo
 * is drawn in, converted to the unit square by intoBox() below.
 */
const X_BOX = { x0: 1.254, y0: 2.25, x1: 22.827, y1: 21.75 };

const X_OUTLINE = [
  [18.244, 2.25], [21.552, 2.25], [14.325, 10.51], [22.827, 21.75],
  [16.170, 21.75], [10.956, 14.933], [4.990, 21.75], [1.680, 21.75],
  [9.410, 12.915], [1.254, 2.25], [8.080, 2.25], [12.793, 8.481],
];

const X_HOLE = [
  [17.083, 19.77], [18.916, 19.77], [7.084, 4.126], [5.117, 4.126],
];

/**
 * Maps a point in the unit square into the logo's own coordinates, centred and
 * scaled so the artwork spans `span` of the tile. Returns [-1, -1] for a point
 * outside it, which the caller reads as "nothing here".
 */
function intoBox(x, y, span) {
  const w = X_BOX.x1 - X_BOX.x0, h = X_BOX.y1 - X_BOX.y0;
  const scale = span / Math.max(w, h);
  const drawW = w * scale, drawH = h * scale;
  const left = 0.5 - drawW / 2, top = 0.5 - drawH / 2;
  if (x < left || x > left + drawW || y < top || y > top + drawH) return [-1, -1];
  return [X_BOX.x0 + (x - left) / scale, X_BOX.y0 + (y - top) / scale];
}

/* ─── the four marks ─────────────────────────────────────────────────────── */

/**
 * Each mark is a function (x, y) → colour or null, over the unit square.
 * null means "nothing here", which lets the disc behind it show through.
 */

const MARKS = {
  youtube: {
    label: 'YouTube',
    color: '#FF0000',
    // White behind, so the red button is the thing you see. YouTube's own
    // icon does exactly this.
    background: () => WHITE,
    draw(x, y) {
      // The rounded "screen", then the play triangle knocked out of it.
      if (!inRoundedRect(x, y, 0.17, 0.29, 0.66, 0.42, 0.125)) return null;
      const a = [0.445, 0.375], b = [0.445, 0.625], c = [0.635, 0.5];
      return inTriangle(x, y, a, b, c) ? WHITE : YT_RED;
    },
  },

  twitter: {
    label: 'X',
    color: '#0F1419',
    background: () => X_BLACK,
    draw(x, y) {
      // The real outline, not two crossed bars: the mark's strokes have flat
      // cut ends and one passes behind the other, and a pair of round-capped
      // diagonals reads as a multiplication sign instead.
      const [ux, uy] = intoBox(x, y, 0.46);
      if (ux < 0) return null;
      const outer = inPolygon(ux, uy, X_OUTLINE);
      const hole = inPolygon(ux, uy, X_HOLE);
      return outer !== hole ? WHITE : null;
    },
  },

  instagram: {
    label: 'Instagram',
    color: '#E1306C',
    // The gradient runs corner to corner, the way the app icon's does.
    background: (x, y) => gradientAt((x + (1 - y)) / 2),
    draw(x, y) {
      const t = 0.055;  // stroke weight
      // The rounded square, as an outline.
      const outer = inRoundedRect(x, y, 0.19, 0.19, 0.62, 0.62, 0.20);
      const inner = inRoundedRect(x, y, 0.19 + t, 0.19 + t, 0.62 - 2 * t, 0.62 - 2 * t, 0.20 - t);
      if (outer && !inner) return WHITE;
      // The lens.
      if (inDisc(x, y, 0.5, 0.5, 0.175) && !inDisc(x, y, 0.5, 0.5, 0.175 - t)) return WHITE;
      // The little light.
      if (inDisc(x, y, 0.665, 0.335, 0.038)) return WHITE;
      return null;
    },
  },

  tiktok: {
    label: 'TikTok',
    color: '#FE2C55',
    background: () => BLACK,
    draw(x, y) {
      // The note three times over: cyan up-left, red down-right, white on top.
      // That offset is the whole look of the mark.
      const d = 0.032;
      if (note(x + d, y + d)) return TT_CYAN;
      if (note(x - d, y - d)) return TT_RED;
      if (note(x, y)) return WHITE;
      return null;
    },
  },
};

/**
 * TikTok's note: a stem, a flag off the top of it, and a ring for the head.
 *
 * Drawn from parts rather than traced, because a traced outline at this size
 * is indistinguishable from this and a great deal harder to reason about.
 */
function note(x, y) {
  const stem = 0.055;
  // The stem, from the flag down to where the head begins.
  if (inCapsule(x, y, 0.55, 0.19, 0.55, 0.60, stem)) return true;
  // The flag, curving up and out to the right.
  if (inCurve(x, y, [0.55, 0.20], [0.66, 0.20], [0.78, 0.33], stem * 0.95)) return true;
  if (inCurve(x, y, [0.72, 0.30], [0.79, 0.35], [0.86, 0.36], stem * 0.9)) return true;
  // The head: an open ring, so the black shows through the middle.
  const r = 0.165, w = 0.058;
  const dist = Math.hypot(x - 0.385, y - 0.615);
  if (dist <= r && dist >= r - w) return true;
  return false;
}

/* ─── rendering ──────────────────────────────────────────────────────────── */

/**
 * @param {string} key   one of the platform keys
 * @param {number} size  square edge in pixels
 * @returns {Buffer} PNG data, or null for a platform with no mark
 */
function generateSocialMark(key, size = 128) {
  const mark = MARKS[key];
  if (!mark) return null;

  const png = new PNG({ width: size, height: size });
  const cx = 0.5, cy = 0.5, r = 0.5;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rs = 0, gs = 0, bs = 0, as = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (px + (sx + 0.5) / SS) / size;
          const uy = (py + (sy + 0.5) / SS) / size;

          // Outside the disc is transparent, so the mark sits correctly on
          // any background — Discord's circle crop, or the panel's dark card.
          if (!inDisc(ux, uy, cx, cy, r)) continue;

          const fg = mark.draw(ux, uy);
          const c = fg || mark.background(ux, uy);
          rs += c[0]; gs += c[1]; bs += c[2]; as += 255;
        }
      }

      const i = (size * py + px) * 4;
      if (as === 0) { png.data[i + 3] = 0; continue; }
      // Averaged over the samples that landed inside, then the alpha carries
      // how much of the pixel was covered — which is what makes the edge soft.
      const hits = as / 255;
      png.data[i] = Math.round(rs / hits);
      png.data[i + 1] = Math.round(gs / hits);
      png.data[i + 2] = Math.round(bs / hits);
      png.data[i + 3] = Math.round((hits / SAMPLES) * 255);
    }
  }

  return PNG.sync.write(png);
}

const MARK_KEYS = Object.keys(MARKS);

module.exports = { generateSocialMark, MARKS, MARK_KEYS };
