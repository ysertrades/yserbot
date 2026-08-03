'use strict';

/**
 * cardArt.js
 *
 * One emblem per card, rather than one per rarity.
 *
 * The drop card used to draw its picture from the card's *tier*, so all five
 * commons were the same grey ring and the only thing telling two cards apart
 * was the name printed underneath. With sixty-odd cards that is most of the
 * collection looking like the rest of it, which is the opposite of what a
 * collection is for.
 *
 * Every entry here is a small pixel drawing keyed by an `art` name a card
 * carries. They are deliberately plain shapes — the canvas is ~130px across
 * inside the card's ring, which is not enough room for detail, and a legible
 * silhouette at that size beats a clever one that turns to mush.
 *
 * The contract is the same for all of them:
 *
 *   draw(png, cx, cy, size, color)
 *
 * `size` is a half-extent: keep the drawing inside roughly ±size of the
 * centre, and the card renderer's ring will always clear it. `color` is the
 * card's rarity accent, so a mythic version of a shape reads as mythic
 * without the shape itself knowing anything about rarity.
 */

const {
  setPxBlend, dot, dotBlend, ringStroke, ringBlend, line,
  fillRoundedRectBlend, drawTextCentered,
} = require('./pixelArt');

/* ─── shared shape helpers ───────────────────────────────────────────────── */

/** Connects points with straight strokes. `close` joins the last back to the first. */
function poly(png, pts, color, th = 3, close = true) {
  for (let i = 0; i < pts.length - 1; i++) {
    line(png, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], color, th);
  }
  if (close && pts.length > 2) {
    const a = pts[pts.length - 1], b = pts[0];
    line(png, a[0], a[1], b[0], b[1], color, th);
  }
}

/**
 * Scanline fill of a closed polygon.
 *
 * Rounds the row to whole pixels and walks the crossings in pairs, which is
 * what keeps a filled shape from leaking along a nearly-horizontal edge.
 */
function fillPoly(png, pts, color, alpha = 1) {
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if (y1 === y2) continue;
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      if (y < lo || y >= hi) continue;
      xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) setPxBlend(png, x, y, color, alpha);
    }
  }
}

/** A stroked arc, angles in radians, 0 = east and increasing clockwise on screen. */
function arc(png, cx, cy, r, a0, a1, color, th = 3) {
  const steps = Math.max(8, Math.round(Math.abs(a1 - a0) * r));
  let px = null, py = null;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (px !== null) line(png, px, py, x, y, color, th);
    px = x; py = y;
  }
}

/** An n-pointed star outline. */
function starPoly(png, cx, cy, rOuter, rInner, points, color, th = 3, filled = false) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  if (filled) fillPoly(png, pts, color, 1);
  else poly(png, pts, color, th);
}

/** A regular polygon outline (or fill). */
function ngon(png, cx, cy, r, n, color, th = 3, rot = -Math.PI / 2, filled = false) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (Math.PI * 2 / n) * i;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  if (filled) fillPoly(png, pts, color, 1);
  else poly(png, pts, color, th);
}

/** An arrow from (x1,y1) to (x2,y2) with a solid head. */
function arrow(png, x1, y1, x2, y2, color, th = 4, head = 12) {
  line(png, x1, y1, x2, y2, color, th);
  const a = Math.atan2(y2 - y1, x2 - x1);
  const wing = 0.5;
  fillPoly(png, [
    [x2, y2],
    [x2 - Math.cos(a - wing) * head, y2 - Math.sin(a - wing) * head],
    [x2 - Math.cos(a + wing) * head, y2 - Math.sin(a + wing) * head],
  ], color, 1);
}

/** A candlestick: body plus a wick through it. */
function candle(png, x, yTop, yBot, bodyTop, bodyBot, w, color, filled = true) {
  line(png, x, yTop, x, yBot, color, 2);
  if (filled) fillRoundedRectBlend(png, x - w / 2, bodyTop, w, bodyBot - bodyTop, 2, color, 1);
  else poly(png, [[x - w / 2, bodyTop], [x + w / 2, bodyTop], [x + w / 2, bodyBot], [x - w / 2, bodyBot]], color, 2);
}

/* ─── the emblems ────────────────────────────────────────────────────────── */
/* Grouped roughly by the tier they were written for, but nothing enforces
   that — an art key is just a name, and any card may use any of them. */

const ART = {

  /* -- workaday / common ------------------------------------------------- */

  gear(png, cx, cy, s, c) {
    ringStroke(png, cx, cy, s * 0.42, c, 5);
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      line(png, cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42,
        cx + Math.cos(a) * s * 0.68, cy + Math.sin(a) * s * 0.68, c, 6);
    }
    ringStroke(png, cx, cy, s * 0.16, c, 3);
  },

  iceCube(png, cx, cy, s, c) {
    const t = s * 0.5;
    fillPoly(png, [[cx - t, cy - t * 0.5], [cx, cy - t], [cx + t, cy - t * 0.5], [cx, cy]], c, 0.55);
    poly(png, [[cx - t, cy - t * 0.5], [cx, cy - t], [cx + t, cy - t * 0.5], [cx + t, cy + t * 0.6],
      [cx, cy + t * 1.1], [cx - t, cy + t * 0.6]], c, 3);
    line(png, cx, cy, cx, cy + t * 1.1, c, 2);
    line(png, cx - t, cy - t * 0.5, cx, cy, c, 2);
    line(png, cx + t, cy - t * 0.5, cx, cy, c, 2);
  },

  eye(png, cx, cy, s, c) {
    const w = s * 0.75, h = s * 0.42;
    poly(png, [[cx - w, cy], [cx - w * 0.5, cy - h], [cx, cy - h * 1.15], [cx + w * 0.5, cy - h], [cx + w, cy]], c, 3, false);
    poly(png, [[cx - w, cy], [cx - w * 0.5, cy + h], [cx, cy + h * 1.15], [cx + w * 0.5, cy + h], [cx + w, cy]], c, 3, false);
    ringStroke(png, cx, cy, s * 0.24, c, 3);
    dot(png, cx, cy, s * 0.1, c);
  },

  stopwatch(png, cx, cy, s, c) {
    ringStroke(png, cx, cy + s * 0.08, s * 0.55, c, 4);
    line(png, cx - s * 0.18, cy - s * 0.62, cx + s * 0.18, cy - s * 0.62, c, 4);
    line(png, cx, cy - s * 0.62, cx, cy - s * 0.47, c, 4);
    line(png, cx, cy + s * 0.08, cx, cy - s * 0.22, c, 3);
    line(png, cx, cy + s * 0.08, cx + s * 0.26, cy + s * 0.2, c, 3);
  },

  sprout(png, cx, cy, s, c) {
    line(png, cx, cy + s * 0.62, cx, cy - s * 0.36, c, 4);
    // Broad rounded blades hugging the stem. Narrow ones pointing away read as
    // flags on a pole — the width and the attachment point are what make a
    // leaf, not the angle.
    for (const side of [-1, 1]) {
      const lift = side < 0 ? 0 : -s * 0.26;
      fillPoly(png, [
        [cx + side * s * 0.03, cy + s * 0.14 + lift],
        [cx + side * s * 0.24, cy - s * 0.16 + lift],
        [cx + side * s * 0.56, cy - s * 0.2 + lift],
        [cx + side * s * 0.6, cy + s * 0.04 + lift],
        [cx + side * s * 0.34, cy + s * 0.24 + lift],
      ], c, 0.92);
    }
    line(png, cx - s * 0.34, cy + s * 0.62, cx + s * 0.34, cy + s * 0.62, c, 4);
  },

  coffee(png, cx, cy, s, c) {
    fillRoundedRectBlend(png, cx - s * 0.44, cy - s * 0.2, s * 0.78, s * 0.66, 6, c, 0.85);
    arc(png, cx + s * 0.4, cy + s * 0.1, s * 0.22, -Math.PI / 2, Math.PI / 2, c, 4);
    for (const dx of [-0.2, 0.06]) arc(png, cx + dx * s, cy - s * 0.46, s * 0.13, -Math.PI, 0, c, 3);
  },

  monitor(png, cx, cy, s, c) {
    poly(png, [[cx - s * 0.62, cy - s * 0.48], [cx + s * 0.62, cy - s * 0.48],
      [cx + s * 0.62, cy + s * 0.24], [cx - s * 0.62, cy + s * 0.24]], c, 4);
    line(png, cx, cy + s * 0.24, cx, cy + s * 0.52, c, 4);
    line(png, cx - s * 0.3, cy + s * 0.6, cx + s * 0.3, cy + s * 0.6, c, 4);
    poly(png, [[cx - s * 0.42, cy], [cx - s * 0.14, cy - s * 0.24], [cx + s * 0.12, cy - s * 0.06],
      [cx + s * 0.42, cy - s * 0.34]], c, 2, false);
  },

  camera(png, cx, cy, s, c) {
    poly(png, [[cx - s * 0.62, cy - s * 0.26], [cx - s * 0.3, cy - s * 0.26], [cx - s * 0.18, cy - s * 0.46],
      [cx + s * 0.18, cy - s * 0.46], [cx + s * 0.3, cy - s * 0.26], [cx + s * 0.62, cy - s * 0.26],
      [cx + s * 0.62, cy + s * 0.46], [cx - s * 0.62, cy + s * 0.46]], c, 3);
    ringStroke(png, cx, cy + s * 0.1, s * 0.24, c, 3);
  },

  flame(png, cx, cy, s, c) {
    fillPoly(png, [[cx, cy - s * 0.7], [cx + s * 0.42, cy - s * 0.05], [cx + s * 0.3, cy + s * 0.5],
      [cx, cy + s * 0.66], [cx - s * 0.3, cy + s * 0.5], [cx - s * 0.42, cy - s * 0.05]], c, 0.75);
    fillPoly(png, [[cx, cy - s * 0.2], [cx + s * 0.2, cy + s * 0.2], [cx, cy + s * 0.55],
      [cx - s * 0.2, cy + s * 0.2]], c, 1);
  },

  candleUp(png, cx, cy, s, c) {
    candle(png, cx - s * 0.34, cy + s * 0.1, cy + s * 0.66, cy + s * 0.24, cy + s * 0.56, s * 0.26, c);
    candle(png, cx + s * 0.06, cy - s * 0.4, cy + s * 0.44, cy - s * 0.2, cy + s * 0.28, s * 0.26, c);
    arrow(png, cx + s * 0.3, cy + s * 0.3, cx + s * 0.62, cy - s * 0.44, c, 3, 11);
  },

  candleDown(png, cx, cy, s, c) {
    candle(png, cx - s * 0.34, cy - s * 0.62, cy - s * 0.02, cy - s * 0.5, cy - s * 0.14, s * 0.26, c, false);
    candle(png, cx + s * 0.06, cy - s * 0.36, cy + s * 0.5, cy - s * 0.2, cy + s * 0.34, s * 0.26, c, false);
    arrow(png, cx + s * 0.3, cy - s * 0.36, cx + s * 0.62, cy + s * 0.44, c, 3, 11);
  },

  keyboard(png, cx, cy, s, c) {
    poly(png, [[cx - s * 0.68, cy - s * 0.3], [cx + s * 0.68, cy - s * 0.3],
      [cx + s * 0.68, cy + s * 0.34], [cx - s * 0.68, cy + s * 0.34]], c, 3);
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 5; i++) {
        const x = cx - s * 0.54 + i * s * 0.27;
        dot(png, x + r * s * 0.1, cy - s * 0.12 + r * s * 0.2, 3, c);
      }
    }
    line(png, cx - s * 0.28, cy + s * 0.22, cx + s * 0.28, cy + s * 0.22, c, 4);
  },

  bell(png, cx, cy, s, c) {
    arc(png, cx, cy + s * 0.1, s * 0.46, Math.PI, Math.PI * 2, c, 4);
    line(png, cx - s * 0.46, cy + s * 0.1, cx - s * 0.58, cy + s * 0.3, c, 3);
    line(png, cx + s * 0.46, cy + s * 0.1, cx + s * 0.58, cy + s * 0.3, c, 3);
    line(png, cx - s * 0.58, cy + s * 0.3, cx + s * 0.58, cy + s * 0.3, c, 4);
    dot(png, cx, cy + s * 0.46, s * 0.1, c);
    line(png, cx, cy - s * 0.36, cx, cy - s * 0.52, c, 3);
  },

  // Two halves of a page pulled apart — the separation is what says "torn",
  // so they lean away from each other rather than sitting square.
  paperTorn(png, cx, cy, s, c) {
    poly(png, [[cx - s * 0.66, cy - s * 0.46], [cx - s * 0.1, cy - s * 0.58],
      [cx - s * 0.16, cy + s * 0.56], [cx - s * 0.7, cy + s * 0.44]], c, 3);
    poly(png, [[cx + s * 0.1, cy - s * 0.58], [cx + s * 0.66, cy - s * 0.46],
      [cx + s * 0.7, cy + s * 0.44], [cx + s * 0.16, cy + s * 0.56]], c, 3);
    for (let i = 0; i < 3; i++) {
      const y = cy - s * 0.24 + i * s * 0.24;
      line(png, cx - s * 0.56, y, cx - s * 0.26, y, c, 2);
      line(png, cx + s * 0.26, y, cx + s * 0.56, y, c, 2);
    }
  },

  /* -- craft / uncommon --------------------------------------------------- */

  radar(png, cx, cy, s, c) {
    for (const r of [0.24, 0.44, 0.64]) ringBlend(png, cx, cy, s * r, 2, c, 0.55);
    line(png, cx, cy, cx + s * 0.55, cy - s * 0.34, c, 4);
    dot(png, cx, cy, s * 0.09, c);
    dot(png, cx + s * 0.34, cy - s * 0.2, s * 0.08, c);
  },

  bolt(png, cx, cy, s, c) {
    fillPoly(png, [[cx + s * 0.16, cy - s * 0.7], [cx - s * 0.36, cy + s * 0.08], [cx - s * 0.02, cy + s * 0.08],
      [cx - s * 0.16, cy + s * 0.7], [cx + s * 0.38, cy - s * 0.1], [cx + s * 0.04, cy - s * 0.1]], c, 1);
  },

  sunrise(png, cx, cy, s, c) {
    arc(png, cx, cy + s * 0.22, s * 0.34, Math.PI, Math.PI * 2, c, 4);
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (Math.PI / 4) * i;
      line(png, cx + Math.cos(a) * s * 0.46, cy + s * 0.22 + Math.sin(a) * s * 0.46,
        cx + Math.cos(a) * s * 0.66, cy + s * 0.22 + Math.sin(a) * s * 0.66, c, 3);
    }
    line(png, cx - s * 0.7, cy + s * 0.22, cx + s * 0.7, cy + s * 0.22, c, 4);
  },

  moon(png, cx, cy, s, c) {
    dotBlend(png, cx + s * 0.06, cy, s * 0.55, c, 1);
    dotBlend(png, cx + s * 0.34, cy - s * 0.16, s * 0.46, [15, 13, 20, 255], 1);
    dot(png, cx - s * 0.5, cy - s * 0.5, 3, c);
    dot(png, cx + s * 0.55, cy + s * 0.5, 2, c);
  },

  padlock(png, cx, cy, s, c) {
    arc(png, cx, cy - s * 0.14, s * 0.32, Math.PI, Math.PI * 2, c, 5);
    fillRoundedRectBlend(png, cx - s * 0.46, cy - s * 0.14, s * 0.92, s * 0.66, 6, c, 0.9);
    dot(png, cx, cy + s * 0.16, s * 0.1, [15, 13, 20, 255]);
  },

  bookmark(png, cx, cy, s, c) {
    poly(png, [[cx - s * 0.44, cy - s * 0.6], [cx + s * 0.44, cy - s * 0.6],
      [cx + s * 0.44, cy + s * 0.62], [cx, cy + s * 0.3], [cx - s * 0.44, cy + s * 0.62]], c, 4);
    for (let i = 0; i < 3; i++) line(png, cx - s * 0.24, cy - s * 0.36 + i * s * 0.18, cx + s * 0.24, cy - s * 0.36 + i * s * 0.18, c, 2);
  },

  umbrella(png, cx, cy, s, c) {
    arc(png, cx, cy - s * 0.06, s * 0.62, Math.PI, Math.PI * 2, c, 4);
    for (const dx of [-0.31, 0.31]) arc(png, cx + dx * s, cy - s * 0.06, s * 0.31, Math.PI, Math.PI * 2, c, 2);
    line(png, cx, cy - s * 0.06, cx, cy + s * 0.5, c, 4);
    arc(png, cx - s * 0.14, cy + s * 0.5, s * 0.14, 0, Math.PI, c, 3);
  },

  ruler(png, cx, cy, s, c) {
    poly(png, [[cx - s * 0.72, cy - s * 0.26], [cx + s * 0.72, cy - s * 0.26],
      [cx + s * 0.72, cy + s * 0.26], [cx - s * 0.72, cy + s * 0.26]], c, 3);
    for (let i = 1; i < 8; i++) {
      const x = cx - s * 0.72 + i * s * 0.18;
      line(png, x, cy - s * 0.26, x, cy - s * 0.26 + (i % 2 ? s * 0.18 : s * 0.32), c, 2);
    }
  },

  volumeBars(png, cx, cy, s, c) {
    const hs = [0.3, 0.62, 0.44, 0.84, 0.52];
    for (let i = 0; i < hs.length; i++) {
      const x = cx - s * 0.6 + i * s * 0.3;
      fillRoundedRectBlend(png, x - s * 0.1, cy + s * 0.55 - s * hs[i], s * 0.2, s * hs[i], 2, c, i % 2 ? 0.55 : 1);
    }
    line(png, cx - s * 0.72, cy + s * 0.57, cx + s * 0.72, cy + s * 0.57, c, 3);
  },

  pendulum(png, cx, cy, s, c) {
    line(png, cx - s * 0.5, cy - s * 0.56, cx + s * 0.5, cy - s * 0.56, c, 4);
    line(png, cx, cy - s * 0.56, cx - s * 0.36, cy + s * 0.36, c, 3);
    line(png, cx, cy - s * 0.56, cx + s * 0.36, cy + s * 0.36, c, 2);
    dot(png, cx - s * 0.36, cy + s * 0.36, s * 0.16, c);
    ringStroke(png, cx + s * 0.36, cy + s * 0.36, s * 0.14, c, 2);
  },

  trendLine(png, cx, cy, s, c) {
    for (let x = cx - s * 0.7; x < cx + s * 0.7; x += 7) setPxBlend(png, x, cy + s * 0.42, c, 0.5);
    poly(png, [[cx - s * 0.66, cy + s * 0.3], [cx - s * 0.3, cy - s * 0.06], [cx - s * 0.02, cy + s * 0.12],
      [cx + s * 0.3, cy - s * 0.4], [cx + s * 0.66, cy - s * 0.6]], c, 4, false);
    for (const p of [[-0.3, -0.06], [0.3, -0.4]]) dot(png, cx + p[0] * s, cy + p[1] * s, 4, c);
  },

  scales(png, cx, cy, s, c) {
    line(png, cx, cy - s * 0.6, cx, cy + s * 0.5, c, 4);
    line(png, cx - s * 0.6, cy - s * 0.4, cx + s * 0.6, cy - s * 0.4, c, 4);
    for (const dx of [-0.6, 0.6]) {
      line(png, cx + dx * s, cy - s * 0.4, cx + dx * s, cy - s * 0.12, c, 2);
      arc(png, cx + dx * s, cy - s * 0.12, s * 0.22, 0, Math.PI, c, 3);
    }
    line(png, cx - s * 0.3, cy + s * 0.5, cx + s * 0.3, cy + s * 0.5, c, 4);
  },

  /* -- edge / rare -------------------------------------------------------- */

  bullHorns(png, cx, cy, s, c) {
    arc(png, cx - s * 0.34, cy - s * 0.1, s * 0.34, Math.PI * 0.9, Math.PI * 1.95, c, 5);
    arc(png, cx + s * 0.34, cy - s * 0.1, s * 0.34, Math.PI * 1.05, Math.PI * 2.1, c, 5);
    arrow(png, cx, cy + s * 0.55, cx, cy - s * 0.34, c, 5, 13);
  },

  // Three tapered claw slashes. Drawn as filled tapers rather than strokes —
  // the widening at the top is the whole difference between claw marks and
  // three parallel lines.
  bearClaw(png, cx, cy, s, c) {
    for (let i = -1; i <= 1; i++) {
      const x = cx + i * s * 0.36 - i * s * 0.06;
      fillPoly(png, [
        [x - s * 0.1, cy - s * 0.62], [x + s * 0.1, cy - s * 0.62],
        [x + s * 0.15, cy + s * 0.4], [x, cy + s * 0.66], [x - s * 0.15, cy + s * 0.4],
      ], c, i === 0 ? 1 : 0.75);
    }
  },

  crosshair(png, cx, cy, s, c) {
    ringStroke(png, cx, cy, s * 0.56, c, 3);
    ringStroke(png, cx, cy, s * 0.26, c, 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      line(png, cx + dx * s * 0.4, cy + dy * s * 0.4, cx + dx * s * 0.78, cy + dy * s * 0.78, c, 4);
    }
    dot(png, cx, cy, 3, c);
  },

  diamond(png, cx, cy, s, c) {
    const rx = s * 0.5, ry = s * 0.66;
    fillPoly(png, [[cx, cy - ry], [cx + rx, cy - ry * 0.2], [cx, cy + ry], [cx - rx, cy - ry * 0.2]], c, 1);
    const facet = [20, 18, 28, 200];
    line(png, cx - rx, cy - ry * 0.2, cx + rx, cy - ry * 0.2, facet, 2);
    line(png, cx - rx * 0.5, cy - ry * 0.2, cx, cy - ry, facet, 2);
    line(png, cx + rx * 0.5, cy - ry * 0.2, cx, cy - ry, facet, 2);
  },

  wave(png, cx, cy, s, c) {
    for (let k = 0; k < 3; k++) {
      const y = cy - s * 0.3 + k * s * 0.34;
      let px = null, py = null;
      for (let i = 0; i <= 40; i++) {
        const x = cx - s * 0.72 + (i / 40) * s * 1.44;
        const yy = y + Math.sin((i / 40) * Math.PI * 2 + k * 0.6) * s * 0.16;
        if (px !== null) line(png, px, py, x, yy, c, k === 1 ? 4 : 2);
        px = x; py = yy;
      }
    }
  },

  brokenWall(png, cx, cy, s, c) {
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 3; i++) {
        const w = s * 0.42, h = s * 0.24;
        const x = cx - s * 0.66 + i * w + (r % 2 ? w * 0.5 : 0);
        const y = cy - s * 0.4 + r * h;
        if (r === 1 && i === 1) continue;
        poly(png, [[x, y], [x + w * 0.9, y], [x + w * 0.9, y + h * 0.85], [x, y + h * 0.85]], c, 2);
      }
    }
    arrow(png, cx - s * 0.5, cy + s * 0.6, cx + s * 0.6, cy - s * 0.5, c, 5, 14);
  },

  spiral(png, cx, cy, s, c) {
    let px = null, py = null;
    for (let i = 0; i <= 180; i++) {
      const t = (i / 180) * Math.PI * 3.4;
      const r = s * 0.06 + t * s * 0.075;
      const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
      if (px !== null) line(png, px, py, x, y, c, 3);
      px = x; py = y;
    }
  },

  contrarian(png, cx, cy, s, c) {
    arrow(png, cx - s * 0.5, cy + s * 0.5, cx - s * 0.5, cy - s * 0.55, c, 4, 12);
    arrow(png, cx + s * 0.5, cy - s * 0.5, cx + s * 0.5, cy + s * 0.55, c, 4, 12);
    for (let y = cy - s * 0.4; y < cy + s * 0.4; y += 8) setPxBlend(png, cx, y, c, 0.5);
  },

  droplets(png, cx, cy, s, c) {
    const drop = (x, y, r) => {
      fillPoly(png, [[x, y - r * 1.5], [x + r, y + r * 0.3], [x, y + r], [x - r, y + r * 0.3]], c, 0.85);
      dotBlend(png, x, y + r * 0.1, r * 0.85, c, 0.85);
    };
    drop(cx, cy - s * 0.18, s * 0.28);
    drop(cx - s * 0.42, cy + s * 0.3, s * 0.19);
    drop(cx + s * 0.42, cy + s * 0.3, s * 0.19);
  },

  magnet(png, cx, cy, s, c) {
    arc(png, cx, cy + s * 0.1, s * 0.5, Math.PI, Math.PI * 2, c, 9);
    line(png, cx - s * 0.5, cy + s * 0.1, cx - s * 0.5, cy + s * 0.46, c, 9);
    line(png, cx + s * 0.5, cy + s * 0.1, cx + s * 0.5, cy + s * 0.46, c, 9);
    for (const dx of [-0.5, 0.5]) line(png, cx + dx * s - s * 0.12, cy + s * 0.5, cx + dx * s + s * 0.12, cy + s * 0.5, c, 5);
  },

  // Two solid blocks with nothing between them — the empty band is the point,
  // so it is wide and dashed edge to edge rather than implied by two candles.
  gap(png, cx, cy, s, c) {
    fillRoundedRectBlend(png, cx - s * 0.52, cy + s * 0.2, s * 1.04, s * 0.42, 4, c, 0.95);
    fillRoundedRectBlend(png, cx - s * 0.52, cy - s * 0.62, s * 1.04, s * 0.42, 4, c, 0.95);
    for (let x = cx - s * 0.72; x < cx + s * 0.72; x += 9) {
      for (let t = 0; t < 4; t++) setPxBlend(png, x + t, cy, c, 0.85);
    }
    arrow(png, cx + s * 0.86, cy - s * 0.16, cx + s * 0.86, cy - s * 0.02, c, 2, 7);
    arrow(png, cx + s * 0.86, cy + s * 0.16, cx + s * 0.86, cy + s * 0.02, c, 2, 7);
  },

  coinStack(png, cx, cy, s, c) {
    for (let i = 0; i < 4; i++) {
      const y = cy + s * 0.46 - i * s * 0.24;
      ringStroke(png, cx, y, s * 0.4, c, 3);
      line(png, cx - s * 0.4, y, cx + s * 0.4, y, c, 2);
    }
    arrow(png, cx + s * 0.5, cy + s * 0.3, cx + s * 0.68, cy - s * 0.5, c, 3, 10);
  },

  shieldCheck(png, cx, cy, s, c) {
    poly(png, [[cx, cy - s * 0.66], [cx + s * 0.5, cy - s * 0.4], [cx + s * 0.42, cy + s * 0.26],
      [cx, cy + s * 0.66], [cx - s * 0.42, cy + s * 0.26], [cx - s * 0.5, cy - s * 0.4]], c, 4);
    poly(png, [[cx - s * 0.22, cy], [cx - s * 0.04, cy + s * 0.2], [cx + s * 0.26, cy - s * 0.24]], c, 4, false);
  },

  /* -- power / epic ------------------------------------------------------- */

  trident(png, cx, cy, s, c) {
    line(png, cx, cy - s * 0.3, cx, cy + s * 0.68, c, 5);
    line(png, cx - s * 0.44, cy - s * 0.3, cx + s * 0.44, cy - s * 0.3, c, 4);
    for (const dx of [-0.44, 0, 0.44]) line(png, cx + dx * s, cy - s * 0.3, cx + dx * s, cy - s * 0.62, c, 4);
    for (const dx of [-0.44, 0, 0.44]) {
      fillPoly(png, [[cx + dx * s - s * 0.1, cy - s * 0.62], [cx + dx * s + s * 0.1, cy - s * 0.62],
        [cx + dx * s, cy - s * 0.8]], c, 1);
    }
  },

  // Filled body plus an S-curved neck. The body has to be solid for the neck
  // to read as a neck rather than as a loose curve floating above a line.
  swan(png, cx, cy, s, c) {
    fillPoly(png, [[cx - s * 0.58, cy + s * 0.34], [cx + s * 0.16, cy + s * 0.12],
      [cx + s * 0.66, cy + s * 0.3], [cx + s * 0.34, cy + s * 0.6], [cx - s * 0.4, cy + s * 0.58]], c, 0.95);
    arc(png, cx - s * 0.02, cy - s * 0.06, s * 0.34, Math.PI * 0.45, Math.PI * 1.45, c, 6);
    arc(png, cx - s * 0.44, cy - s * 0.42, s * 0.24, -Math.PI * 0.75, Math.PI * 0.5, c, 5);
    fillPoly(png, [[cx - s * 0.6, cy - s * 0.5], [cx - s * 0.86, cy - s * 0.4], [cx - s * 0.58, cy - s * 0.32]], c, 1);
    dot(png, cx - s * 0.5, cy - s * 0.56, 2, [15, 13, 20, 255]);
  },

  telescope(png, cx, cy, s, c) {
    fillPoly(png, [[cx - s * 0.6, cy + s * 0.06], [cx + s * 0.2, cy - s * 0.5],
      [cx + s * 0.44, cy - s * 0.18], [cx - s * 0.4, cy + s * 0.34]], c, 0.9);
    line(png, cx - s * 0.16, cy + s * 0.2, cx - s * 0.3, cy + s * 0.66, c, 4);
    line(png, cx + s * 0.06, cy + s * 0.06, cx + s * 0.24, cy + s * 0.66, c, 4);
    dot(png, cx + s * 0.5, cy - s * 0.56, 3, c);
    dot(png, cx + s * 0.66, cy - s * 0.34, 2, c);
  },

  chessKnight(png, cx, cy, s, c) {
    fillPoly(png, [[cx - s * 0.3, cy + s * 0.4], [cx - s * 0.22, cy - s * 0.08], [cx - s * 0.44, cy - s * 0.18],
      [cx - s * 0.24, cy - s * 0.56], [cx + s * 0.1, cy - s * 0.66], [cx + s * 0.36, cy - s * 0.34],
      [cx + s * 0.34, cy + s * 0.4]], c, 0.95);
    line(png, cx - s * 0.44, cy + s * 0.42, cx + s * 0.46, cy + s * 0.42, c, 5);
    line(png, cx - s * 0.36, cy + s * 0.6, cx + s * 0.38, cy + s * 0.6, c, 5);
    dot(png, cx + s * 0.1, cy - s * 0.36, 3, [15, 13, 20, 255]);
  },

  cross(png, cx, cy, s, c) {
    poly(png, [[cx - s * 0.72, cy + s * 0.4], [cx + s * 0.72, cy - s * 0.44]], c, 5, false);
    poly(png, [[cx - s * 0.72, cy - s * 0.34], [cx + s * 0.72, cy + s * 0.5]], c, 5, false);
    dotBlend(png, cx, cy + s * 0.03, s * 0.2, c, 0.4);
    starPoly(png, cx, cy + s * 0.03, s * 0.24, s * 0.09, 4, c, 2, true);
  },

  lightningDown(png, cx, cy, s, c) {
    fillPoly(png, [[cx - s * 0.2, cy - s * 0.7], [cx + s * 0.32, cy - s * 0.7], [cx + s * 0.06, cy - s * 0.14],
      [cx + s * 0.4, cy - s * 0.14], [cx - s * 0.24, cy + s * 0.74], [cx - s * 0.02, cy - s * 0.02],
      [cx - s * 0.34, cy - s * 0.02]], c, 1);
  },

  squeeze(png, cx, cy, s, c) {
    line(png, cx - s * 0.7, cy - s * 0.5, cx + s * 0.7, cy - s * 0.5, c, 5);
    line(png, cx - s * 0.7, cy + s * 0.5, cx + s * 0.7, cy + s * 0.5, c, 5);
    for (const dx of [-0.36, 0, 0.36]) {
      arrow(png, cx + dx * s, cy - s * 0.28, cx + dx * s, cy - s * 0.02, c, 3, 9);
      arrow(png, cx + dx * s, cy + s * 0.28, cx + dx * s, cy + s * 0.02, c, 3, 9);
    }
  },

  circuit(png, cx, cy, s, c) {
    poly(png, [[cx - s * 0.4, cy - s * 0.4], [cx + s * 0.4, cy - s * 0.4],
      [cx + s * 0.4, cy + s * 0.4], [cx - s * 0.4, cy + s * 0.4]], c, 3);
    dotBlend(png, cx, cy, s * 0.16, c, 0.6);
    for (const [dx, dy] of [[-1, -0.45], [-1, 0.45], [1, -0.45], [1, 0.45]]) {
      line(png, cx + dx * s * 0.4, cy + dy * s * 0.4, cx + dx * s * 0.72, cy + dy * s * 0.4, c, 3);
      dot(png, cx + dx * s * 0.72, cy + dy * s * 0.4, 3, c);
    }
    for (const dx of [-0.45, 0.45]) {
      line(png, cx + dx * s * 0.4 * 2.5 * 0.4, cy - s * 0.4, cx + dx * s, cy - s * 0.72, c, 3);
      dot(png, cx + dx * s, cy - s * 0.72, 3, c);
    }
  },

  eclipse(png, cx, cy, s, c) {
    ringStroke(png, cx, cy, s * 0.62, c, 3);
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI / 6) * i;
      line(png, cx + Math.cos(a) * s * 0.64, cy + Math.sin(a) * s * 0.64,
        cx + Math.cos(a) * s * 0.8, cy + Math.sin(a) * s * 0.8, c, 2);
    }
    dotBlend(png, cx, cy, s * 0.6, [15, 13, 20, 255], 1);
    ringStroke(png, cx, cy, s * 0.6, c, 2);
  },

  wings(png, cx, cy, s, c) {
    for (const side of [-1, 1]) {
      fillPoly(png, [[cx + side * s * 0.08, cy - s * 0.18], [cx + side * s * 0.84, cy - s * 0.44],
        [cx + side * s * 0.76, cy + s * 0.06], [cx + side * s * 0.34, cy + s * 0.26]], c, 0.85);
      for (let k = 1; k <= 2; k++) {
        line(png, cx + side * s * 0.16, cy - s * 0.1 + k * s * 0.08,
          cx + side * s * (0.7 - k * 0.16), cy + s * 0.08 + k * s * 0.06, c, 2);
      }
    }
    fillPoly(png, [[cx - s * 0.1, cy - s * 0.3], [cx + s * 0.1, cy - s * 0.3], [cx, cy + s * 0.58]], c, 1);
  },

  /* -- myth / legendary --------------------------------------------------- */

  wolf(png, cx, cy, s, c) {
    fillPoly(png, [[cx - s * 0.5, cy - s * 0.62], [cx - s * 0.28, cy - s * 0.16], [cx - s * 0.5, cy - s * 0.12]], c, 1);
    fillPoly(png, [[cx + s * 0.5, cy - s * 0.62], [cx + s * 0.28, cy - s * 0.16], [cx + s * 0.5, cy - s * 0.12]], c, 1);
    poly(png, [[cx - s * 0.5, cy - s * 0.16], [cx - s * 0.42, cy + s * 0.24], [cx, cy + s * 0.7],
      [cx + s * 0.42, cy + s * 0.24], [cx + s * 0.5, cy - s * 0.16]], c, 4);
    dot(png, cx - s * 0.2, cy + s * 0.06, 4, c);
    dot(png, cx + s * 0.2, cy + s * 0.06, 4, c);
    line(png, cx, cy + s * 0.36, cx, cy + s * 0.52, c, 3);
  },

  rocket(png, cx, cy, s, c) {
    fillPoly(png, [[cx, cy - s * 0.72], [cx + s * 0.24, cy - s * 0.24], [cx + s * 0.24, cy + s * 0.3],
      [cx - s * 0.24, cy + s * 0.3], [cx - s * 0.24, cy - s * 0.24]], c, 0.95);
    fillPoly(png, [[cx - s * 0.24, cy - s * 0.02], [cx - s * 0.54, cy + s * 0.36], [cx - s * 0.24, cy + s * 0.3]], c, 1);
    fillPoly(png, [[cx + s * 0.24, cy - s * 0.02], [cx + s * 0.54, cy + s * 0.36], [cx + s * 0.24, cy + s * 0.3]], c, 1);
    dot(png, cx, cy - s * 0.24, s * 0.11, [15, 13, 20, 255]);
    for (const dx of [-0.1, 0.1]) line(png, cx + dx * s, cy + s * 0.34, cx + dx * s, cy + s * 0.68, c, 3);
  },

  shades(png, cx, cy, s, c) {
    fillRoundedRectBlend(png, cx - s * 0.66, cy - s * 0.2, s * 0.56, s * 0.4, 6, c, 0.95);
    fillRoundedRectBlend(png, cx + s * 0.1, cy - s * 0.2, s * 0.56, s * 0.4, 6, c, 0.95);
    line(png, cx - s * 0.1, cy - s * 0.06, cx + s * 0.1, cy - s * 0.06, c, 4);
    line(png, cx - s * 0.66, cy - s * 0.2, cx - s * 0.82, cy - s * 0.34, c, 3);
    line(png, cx + s * 0.66, cy - s * 0.2, cx + s * 0.82, cy - s * 0.34, c, 3);
  },

  globe(png, cx, cy, s, c) {
    ringStroke(png, cx, cy, s * 0.6, c, 3);
    for (const rx of [0.2, 0.42]) {
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * Math.PI * 2;
        setPxBlend(png, cx + Math.cos(t) * s * rx, cy + Math.sin(t) * s * 0.6, c, 0.8);
      }
    }
    line(png, cx - s * 0.6, cy, cx + s * 0.6, cy, c, 2);
    for (const dy of [-0.32, 0.32]) {
      const w = s * 0.6 * Math.sqrt(1 - (dy / 0.6) ** 2);
      line(png, cx - w, cy + dy * s, cx + w, cy + dy * s, c, 2);
    }
  },

  moneyBag(png, cx, cy, s, c) {
    poly(png, [[cx - s * 0.2, cy - s * 0.5], [cx + s * 0.2, cy - s * 0.5]], c, 5, false);
    fillPoly(png, [[cx - s * 0.18, cy - s * 0.42], [cx + s * 0.18, cy - s * 0.42],
      [cx + s * 0.56, cy + s * 0.28], [cx + s * 0.34, cy + s * 0.62],
      [cx - s * 0.34, cy + s * 0.62], [cx - s * 0.56, cy + s * 0.28]], c, 0.9);
    drawTextCentered(png, '$', cx, cy - s * 0.04, 4, [15, 13, 20, 255]);
  },

  // A bird going up, not a butterfly: the wings sweep above the body and the
  // tail streams below it, so the whole shape leans upward.
  phoenix(png, cx, cy, s, c) {
    for (const side of [-1, 1]) {
      fillPoly(png, [[cx + side * s * 0.04, cy + s * 0.06], [cx + side * s * 0.3, cy - s * 0.74],
        [cx + side * s * 0.66, cy - s * 0.32], [cx + side * s * 0.5, cy + s * 0.24]], c, 0.85);
    }
    fillPoly(png, [[cx - s * 0.12, cy - s * 0.26], [cx + s * 0.12, cy - s * 0.26],
      [cx + s * 0.18, cy + s * 0.4], [cx, cy + s * 0.76], [cx - s * 0.18, cy + s * 0.4]], c, 1);
    dot(png, cx, cy - s * 0.36, s * 0.13, c);
    fillPoly(png, [[cx + s * 0.1, cy - s * 0.42], [cx + s * 0.34, cy - s * 0.34], [cx + s * 0.1, cy - s * 0.28]], c, 1);
  },

  hourglass(png, cx, cy, s, c) {
    line(png, cx - s * 0.46, cy - s * 0.62, cx + s * 0.46, cy - s * 0.62, c, 5);
    line(png, cx - s * 0.46, cy + s * 0.62, cx + s * 0.46, cy + s * 0.62, c, 5);
    poly(png, [[cx - s * 0.4, cy - s * 0.58], [cx + s * 0.4, cy - s * 0.58], [cx, cy]], c, 3);
    poly(png, [[cx - s * 0.4, cy + s * 0.58], [cx + s * 0.4, cy + s * 0.58], [cx, cy]], c, 3);
    fillPoly(png, [[cx - s * 0.26, cy - s * 0.44], [cx + s * 0.26, cy - s * 0.44], [cx, cy - s * 0.06]], c, 0.75);
    line(png, cx, cy, cx, cy + s * 0.4, c, 2);
  },

  scepter(png, cx, cy, s, c) {
    line(png, cx, cy - s * 0.16, cx, cy + s * 0.72, c, 5);
    ngon(png, cx, cy - s * 0.38, s * 0.3, 4, c, 4, -Math.PI / 2, true);
    ringStroke(png, cx, cy - s * 0.38, s * 0.44, c, 2);
    for (const dx of [-0.34, 0.34]) dot(png, cx + dx * s, cy - s * 0.38, 3, c);
    line(png, cx - s * 0.18, cy + s * 0.72, cx + s * 0.18, cy + s * 0.72, c, 4);
  },

  infinity(png, cx, cy, s, c) {
    for (const side of [-1, 1]) {
      let px = null, py = null;
      for (let i = 0; i <= 60; i++) {
        const t = (i / 60) * Math.PI * 2;
        const x = cx + side * s * 0.34 + Math.cos(t) * s * 0.32;
        const y = cy + Math.sin(t) * s * 0.36;
        if (px !== null) line(png, px, py, x, y, c, 4);
        px = x; py = y;
      }
    }
  },

  /* -- apex / mythic ------------------------------------------------------ */

  crown(png, cx, cy, s, c) {
    fillRoundedRectBlend(png, cx - s * 0.56, cy + s * 0.24, s * 1.12, s * 0.3, 3, c, 1);
    fillPoly(png, [[cx - s * 0.56, cy + s * 0.26], [cx - s * 0.42, cy - s * 0.44],
      [cx - s * 0.18, cy + s * 0.02], [cx, cy - s * 0.58], [cx + s * 0.18, cy + s * 0.02],
      [cx + s * 0.42, cy - s * 0.44], [cx + s * 0.56, cy + s * 0.26]], c, 0.95);
    for (const dx of [-0.42, 0, 0.42]) dot(png, cx + dx * s, cy - s * 0.5, s * 0.09, c);
  },

  helix(png, cx, cy, s, c) {
    for (const phase of [0, Math.PI]) {
      let px = null, py = null;
      for (let i = 0; i <= 50; i++) {
        const t = (i / 50) * Math.PI * 3;
        const y = cy - s * 0.7 + (i / 50) * s * 1.4;
        const x = cx + Math.sin(t + phase) * s * 0.42;
        if (px !== null) line(png, px, py, x, y, c, 3);
        px = x; py = y;
      }
    }
    for (let i = 1; i < 6; i++) {
      const t = (i / 6) * Math.PI * 3;
      const y = cy - s * 0.7 + (i / 6) * s * 1.4;
      line(png, cx + Math.sin(t) * s * 0.42, y, cx + Math.sin(t + Math.PI) * s * 0.42, y, c, 2);
    }
  },

  galaxy(png, cx, cy, s, c) {
    for (const off of [0, Math.PI]) {
      let px = null, py = null;
      for (let i = 0; i <= 60; i++) {
        const t = (i / 60) * Math.PI * 1.7;
        const r = s * 0.1 + t * s * 0.32;
        const x = cx + Math.cos(t + off) * r, y = cy + Math.sin(t + off) * r * 0.62;
        if (px !== null) line(png, px, py, x, y, c, 3);
        px = x; py = y;
      }
    }
    dotBlend(png, cx, cy, s * 0.2, c, 0.6);
    dot(png, cx, cy, s * 0.1, c);
    for (const [dx, dy] of [[-0.72, -0.42], [0.7, 0.4], [0.56, -0.56]]) dot(png, cx + dx * s, cy + dy * s, 2, c);
  },

  blackHole(png, cx, cy, s, c) {
    for (let i = 0; i < 5; i++) ringBlend(png, cx, cy, s * (0.4 + i * 0.11), 2, c, 0.6 - i * 0.1);
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * Math.PI * 2;
      setPxBlend(png, cx + Math.cos(t) * s * 0.78, cy + Math.sin(t) * s * 0.26, c, 0.9);
    }
    dotBlend(png, cx, cy, s * 0.34, [15, 13, 20, 255], 1);
    ringStroke(png, cx, cy, s * 0.34, c, 2);
  },

  genesisCube(png, cx, cy, s, c) {
    const t = s * 0.44;
    poly(png, [[cx, cy - t * 1.25], [cx + t, cy - t * 0.6], [cx + t, cy + t * 0.6],
      [cx, cy + t * 1.25], [cx - t, cy + t * 0.6], [cx - t, cy - t * 0.6]], c, 4);
    line(png, cx, cy - t * 1.25, cx, cy + t * 0.05, c, 3);
    line(png, cx, cy + t * 0.05, cx - t, cy - t * 0.6, c, 3);
    line(png, cx, cy + t * 0.05, cx + t, cy - t * 0.6, c, 3);
    dot(png, cx, cy + t * 0.05, 4, c);
  },
};

/** Every art key, for the panel and for validation. */
const ART_KEYS = Object.keys(ART);

/**
 * The drawing for a card, or null when it has none.
 *
 * Null rather than a throw: an unknown key means the card renderer falls back
 * to its rarity emblem, which is exactly what every card looked like before
 * this file existed. A typo costs one card its own picture, not the drop.
 */
function artFor(key) {
  return (key && Object.hasOwn(ART, key)) ? ART[key] : null;
}

module.exports = { ART, ART_KEYS, artFor, poly, fillPoly, arc, starPoly, ngon, arrow, candle };
