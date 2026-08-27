'use strict';

/**
 * brandMarks.js
 *
 * Redrawn TradingView and Whop marks, so their banners can be generated as
 * PNGs at any size instead of depending on a hosted image.
 *
 * Both were traced off the official artwork (edge positions sampled row by
 * row) and rebuilt from geometry, so the proportions are the real ones rather
 * than an approximation:
 *
 *   TradingView — a bar + stem, a circle, and a slanted bar. All plain
 *   rectangles/circle/parallelogram, so the reconstruction is exact.
 *
 *   Whop — three strokes forming the wing. Two lean at a true 45°, the third
 *   is a symmetric wedge; the domed ends follow a sqrt profile, which is what
 *   the sampled edges actually fit.
 *
 * Each mark draws into a caller-supplied box and keeps its own aspect ratio.
 */

const { setPxBlend } = require('./pixelArt');

// Both marks are built from diagonals, which alias badly with whole-pixel
// fills — so spans are drawn with fractional coverage at each end.
function fillSpanAA(png, y, xL, xR, color, alpha = 1) {
  if (xR <= xL) return;
  const yi = Math.round(y);
  const first = Math.floor(xL), last = Math.ceil(xR) - 1;
  for (let x = first; x <= last; x++) {
    const cov = Math.min(x + 1, xR) - Math.max(x, xL);
    if (cov > 0) setPxBlend(png, x, yi, color, alpha * Math.min(1, cov));
  }
}

/* ─── TradingView ────────────────────────────────────────────────────────── */

const TV_ASPECT = 871 / 443;

// Normalised to the mark's own bounding box (u across, v down).
const TV = {
  barRight:  0.4076,
  barBottom: 0.41,
  stemLeft:  0.2044,
  dotCx:     0.5591,
  dotCy:     0.2,      // in v units; the circle is round in real pixels
  dotR:      0.1022,   // in u units
  slashTopL: 0.7676, slashTopR: 1.0,
  slashBotL: 0.5538, slashBotR: 0.7892,
};

function drawTradingViewMark(png, x, y, w, color, alpha = 1) {
  const h = w / TV_ASPECT;
  const U = u => x + u * w;
  const V = v => y + v * h;
  const rows = Math.max(1, Math.round(h));

  for (let i = 0; i < rows; i++) {
    const v  = (i + 0.5) / rows;
    const py = y + i;

    // "1": full-width bar down to barBottom, then just the stem.
    if (v <= TV.barBottom) fillSpanAA(png, py, U(0), U(TV.barRight), color, alpha);
    else fillSpanAA(png, py, U(TV.stemLeft), U(TV.barRight), color, alpha);

    // Circle — round in real pixels, so the radius is measured in u and the
    // vertical offset converted through the aspect ratio.
    const dy = (v - TV.dotCy) / TV_ASPECT;
    if (Math.abs(dy) < TV.dotR) {
      const half = Math.sqrt(TV.dotR * TV.dotR - dy * dy);
      fillSpanAA(png, py, U(TV.dotCx - half), U(TV.dotCx + half), color, alpha);
    }

    // Slanted bar.
    fillSpanAA(png, py,
      U(TV.slashTopL + (TV.slashBotL - TV.slashTopL) * v),
      U(TV.slashTopR + (TV.slashBotR - TV.slashTopR) * v),
      color, alpha);
  }
}

/* ─── Whop ───────────────────────────────────────────────────────────────── */

const WHOP_ASPECT = 760 / 391;

const HW    = 0.14475;  // horizontal half-width of a stroke (u)
const SLOPE = 0.5132;   // du per dv — a true 45° at this aspect ratio
const CAP_T = 0.15;     // domed top, in v
const CAP_B = 0.16;     // domed bottom, in v

// The sampled edges fit a sqrt profile, not a circular cap.
const dome = t => (t >= 1 ? 1 : t <= 0 ? 0 : Math.sqrt(t));

// A domed end doesn't keep travelling up the 45° axis — it leans back over the
// stroke, so its apex sits almost directly above where the stroke reaches full
// width. Tracing gives a slight rightward lean on the top ends and none at all
// on the bottom one; following the axis instead throws the apexes out by up to
// 7% of the mark's width.
const CAP_LEAN = 0.106;

// Centre of a stroke at row v: the straight body follows the 45° centreline,
// the domed ends hold near the centre they had where the body ends.
function strokeCentre(centreAt, v, { bottomAt = null } = {}) {
  if (v < CAP_T) return centreAt(CAP_T) + CAP_LEAN * (CAP_T - v);
  if (bottomAt !== null && v > bottomAt) return centreAt(bottomAt);
  return centreAt(v);
}

function drawWhopMark(png, x, y, w, color, alpha = 1) {
  const h = w / WHOP_ASPECT;
  const U = u => x + u * w;
  const rows = Math.max(1, Math.round(h));

  for (let i = 0; i < rows; i++) {
    const v  = (i + 0.5) / rows;
    const py = y + i;

    // Stroke 1 — symmetric wedge, apex down, domed top.
    {
      const c    = strokeCentre(() => 0.144, v);
      const half = Math.min(SLOPE * (0.4281 - v), HW * dome(v / CAP_T));
      if (half > 0) fillSpanAA(png, py, U(c - half), U(c + half), color, alpha);
    }

    // Stroke 2 — 45° band, domed top, converging to a point.
    {
      const c    = strokeCentre(t => 0.5763 - SLOPE * t, v);
      const half = HW * dome(v / CAP_T);
      const l = Math.max(c - half, 0.3227 - SLOPE * (0.7762 - v));
      const r = Math.min(c + half, 0.3227 + SLOPE * (0.7762 - v));
      if (r > l) fillSpanAA(png, py, U(l), U(r), color, alpha);
    }

    // Stroke 3 — 45° band, domed at both ends.
    {
      const c    = strokeCentre(t => 0.9316 - SLOPE * t, v, { bottomAt: 1 - CAP_B });
      const half = HW * Math.min(dome(v / CAP_T), dome((1 - v) / CAP_B));
      if (half > 0) fillSpanAA(png, py, U(c - half), U(c + half), color, alpha);
    }
  }
}

module.exports = {
  drawTradingViewMark, drawWhopMark,
  TV_ASPECT, WHOP_ASPECT,
};
