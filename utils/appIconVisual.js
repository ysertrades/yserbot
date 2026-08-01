'use strict';

/**
 * appIconVisual.js
 *
 * The home-screen icon for the control panel.
 *
 * It is the same Y monogram that sits beside the wordmark in the panel's own
 * header, redrawn as a filled tile so it survives being shrunk to 60px and
 * masked into whatever shape the platform prefers. Drawn rather than shipped
 * as a file for the same reason every other image in this bot is: there is no
 * asset pipeline here, and a generated PNG cannot fall out of sync with the
 * brand it is generated from.
 *
 * Two things an icon has to get right that a banner does not:
 *
 *   1. It is opaque, corner to corner. iOS composites an alpha icon onto
 *      black and then applies its own rounded mask, so drawing our own
 *      transparent corners would leave dark pixels outside the mask.
 *   2. The artwork stays inside the middle ~80%. Android's maskable icons and
 *      iOS's squircle both crop the edges, so anything near them is at risk.
 */

const { PNG, setPx, fillRect, line, dot, blendColor } = require('./pixelArt');

const BG_TOP    = [20, 24, 31];    // the panel's --surface
const BG_BOTTOM = [11, 13, 17];    // the panel's --bg
const ACCENT    = [76, 125, 255];  // the panel's --accent
const GLOW      = [76, 125, 255];

/**
 * @param {number} size square edge in pixels
 * @returns {Buffer} PNG image data
 */
function generateAppIcon(size = 512) {
  const png = new PNG({ width: size, height: size });

  // A vertical gradient rather than a flat fill: at icon scale it is the
  // difference between looking drawn and looking like a placeholder.
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const c = [
      Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
      Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
      Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
      255,
    ];
    fillRect(png, 0, y, size, 1, c);
  }

  // A soft accent bloom behind the monogram, so the mark reads as lit rather
  // than pasted on. Cheap radial falloff — no blur pass needed at this size.
  const cx = size / 2;
  const cy = size * 0.47;
  const radius = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d >= 1) continue;
      const alpha = (1 - d) * (1 - d) * 0.16;
      const idx = (size * y + x) << 2;
      const base = [png.data[idx], png.data[idx + 1], png.data[idx + 2]];
      const mixed = blendColor(base, GLOW, alpha);
      setPx(png, x, y, [mixed[0], mixed[1], mixed[2], 255]);
    }
  }

  drawMonogram(png, size);
  return PNG.sync.write(png);
}

/**
 * The Y, with the stem detached.
 *
 * That 2px break is the detail that makes the mark ours rather than a generic
 * letter Y, and it is proportional so it survives every size — at 180px it is
 * still a visible gap, and below about 48px the strokes merge and it reads as
 * a solid Y, which is the graceful way for it to fail.
 */
function drawMonogram(png, size) {
  const stroke = Math.max(2, Math.round(size * 0.085));
  const cx = Math.round(size / 2);

  // Kept inside the middle 80% so a maskable crop cannot clip the arms.
  const top = Math.round(size * 0.28);
  const junction = Math.round(size * 0.52);
  const bottom = Math.round(size * 0.72);
  const spread = Math.round(size * 0.19);

  const gap = Math.max(2, Math.round(size * 0.045));
  const colour = [...ACCENT, 255];
  const cap = Math.max(1, Math.round(stroke / 2));

  const strokes = [
    [cx - spread, top, cx, junction],
    [cx + spread, top, cx, junction],
    [cx, junction + gap + stroke, cx, bottom],
  ];

  // Round caps, to match the stroke-linecap on the SVG mark in the header —
  // square ends read as crude at icon scale, and the two marks sitting side by
  // side on the same phone should look like the same drawing.
  for (const [x1, y1, x2, y2] of strokes) {
    line(png, x1, y1, x2, y2, colour, stroke);
    dot(png, x1, y1, cap, colour);
    dot(png, x2, y2, cap, colour);
  }
}

module.exports = { generateAppIcon };
