'use strict';

/**
 * appIconVisual.js
 *
 * The home-screen icon for the control panel.
 *
 * The same mark as the panel's own favicon (see web/public/index.html's
 * inline SVG): a rounded tile filled with the signature sky→periwinkle
 * gradient, with an ink checkmark-style rising line across it — QuantLab's
 * "mark only" lockup, drawn here as a PNG so it survives being shrunk to
 * 60px and masked into whatever shape the platform prefers. Drawn rather
 * than shipped as a file for the same reason every other image in this bot
 * is: there is no asset pipeline here, and a generated PNG cannot fall out
 * of sync with the brand it is generated from.
 *
 * Two things an icon has to get right that a banner does not:
 *
 *   1. It is opaque, corner to corner. iOS composites an alpha icon onto
 *      black and then applies its own rounded mask, so drawing our own
 *      transparent corners would leave dark pixels outside the mask.
 *   2. The artwork stays inside the middle ~80%. Android's maskable icons and
 *      iOS's squircle both crop the edges, so anything near them is at risk.
 */

const { PNG, setPx, line, dot } = require('./pixelArt');
const { RGBA: LIGHT, gradientColorAt } = require('./brandTheme');

const INK = LIGHT.ink; // "text/marks on the gradient are always ink, never white" — the brand book's own rule, applied to the icon's line

/**
 * @param {number} size square edge in pixels
 * @returns {Buffer} PNG image data
 */
function generateAppIcon(size = 512) {
  const png = new PNG({ width: size, height: size });

  // The signature gradient, corner to corner and fully opaque — the same
  // asset the favicon and every hero card use, at icon scale it doesn't
  // need the "used sparingly" caveat: the icon *is* the one hero surface.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (size * 2 - 2);
      const c = gradientColorAt(t);
      setPx(png, x, y, [c[0], c[1], c[2], 255]);
    }
  }

  drawMark(png, size);
  return PNG.sync.write(png);
}

/**
 * A rising three-point line — the brand's own chart-line motif (see
 * brandSignature.js's monogram) — scaled up and thickened for icon
 * legibility. Kept inside the middle 80% so a maskable crop cannot clip it.
 */
function drawMark(png, size) {
  const stroke = Math.max(3, Math.round(size * 0.09));
  const cap = Math.max(2, Math.round(stroke / 2));

  const p1 = { x: Math.round(size * 0.26), y: Math.round(size * 0.68) };
  const p2 = { x: Math.round(size * 0.52), y: Math.round(size * 0.38) };
  const p3 = { x: Math.round(size * 0.78), y: Math.round(size * 0.30) };

  for (const [a, b] of [[p1, p2], [p2, p3]]) {
    line(png, a.x, a.y, b.x, b.y, [...INK], stroke);
  }
  for (const p of [p1, p2, p3]) dot(png, p.x, p.y, cap, [...INK]);
}

module.exports = { generateAppIcon };
