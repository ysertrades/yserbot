'use strict';

/**
 * newsCardVisual.js
 *
 * The image attached to a Financial Juice headline when the story carries
 * no picture of its own — which is most of them; a live news feed is mostly
 * plain text. Rather than let those headlines go out as a bare colour bar,
 * every one gets this card, so the feed has one consistent, brand-owned
 * look instead of borrowing whatever a linked site happens to share.
 *
 * The design is lifted straight from the brand book's own Style Guide page
 * on "Chart cards & browser frames": a macOS-style browser chrome — three
 * dots, a URL pill — presenting the product "without screenshots feeling
 * stapled on." The chrome itself sits on the brand's dark neutral surface,
 * since that's how most people actually read Discord; the browser's content
 * area *is* the signature gradient regardless, with the headline set in ink
 * on top of it — the one hero-surface use the brand book allows the
 * gradient, and the "text on gradient is always ink, never white" rule,
 * neither of which change with the surface around them.
 */

const {
  PNG, setPxBlend, dot, fillRoundedRectBlend, roundedMask,
  drawText, drawTextCentered, wrapText, fitScale, textWidth, GLYPH_H,
} = require('./pixelArt');
const { RGBA: LIGHT, RGBA_DARK: DARK, gradientRect, fillCanvas } = require('./brandTheme');

const INK = LIGHT.ink;        // "text on gradient is always ink" — fixed, independent of card mode
const TEXT = DARK.ink;        // chrome text on the dark frame
const SUBTLE = DARK.grey1;
const WHITE = [255, 255, 255, 255];

const TRAFFIC = [
  [255, 95, 87, 255],   // the three browser-chrome dots are a UI convention,
  [255, 189, 46, 255],  // not a brand colour — the brand book's own mockup
  [39, 201, 63, 255],   // of this exact motif uses them unchanged.
];

function roundedBorder(png, x, y, w, h, radius, color, alpha) {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      if (!roundedMask(w, h, radius, xx, yy)) continue;
      const edge = xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1
        || !roundedMask(w, h, radius, xx - 1, yy) || !roundedMask(w, h, radius, xx + 1, yy)
        || !roundedMask(w, h, radius, xx, yy - 1) || !roundedMask(w, h, radius, xx, yy + 1);
      if (edge) setPxBlend(png, x + xx, y + yy, color, alpha);
    }
  }
}

/**
 * @param {object} e
 * @param {string} e.headline
 * @param {string} [e.source] - e.g. "Financial Juice"
 * @param {string} [e.urlLabel] - what shows in the address pill, e.g. "financialjuice.com" or a linked article's host
 * @param {boolean} [e.breaking]
 * @returns {Buffer} PNG image data
 */
function generateNewsCard({ headline, source, urlLabel, breaking = false }) {
  const W = 1000, H = 300;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  fillCanvas(png, DARK.bg);

  // ── The browser frame ──────────────────────────────────────────────────
  const fx = 20, fy = 20, fw = W - 40, fh = H - 40, radius = 20;
  fillRoundedRectBlend(png, fx, fy, fw, fh, radius, DARK.card, 1);
  roundedBorder(png, fx, fy, fw, fh, radius, DARK.border, 1);

  // Chrome bar — dots, then the URL pill.
  const chromeH = 46;
  for (let i = 0; i < 3; i++) dot(png, fx + 22 + i * 18, fy + chromeH / 2, 5, TRAFFIC[i]);

  const urlText = (urlLabel || 'financialjuice.com').toLowerCase();
  const urlPillX = fx + 76, urlPillW = Math.min(fw - 96, textWidth(urlText, 1) + 28);
  fillRoundedRectBlend(png, urlPillX, fy + 12, urlPillW, chromeH - 24, 11, DARK.raised, 1);
  drawText(png, urlText, urlPillX + 14, fy + 12 + (chromeH - 24 - GLYPH_H) / 2, 1, SUBTLE);

  for (let x = fx + 1; x < fx + fw - 1; x++) setPxBlend(png, x, fy + chromeH, DARK.border, 1);

  // ── The content area: the signature gradient, used exactly here ─────────
  const cx0 = fx + 1, cy0 = fy + chromeH + 1, cw = fw - 2, ch = fh - chromeH - 2;
  gradientRect(png, cx0, cy0, cw, ch, 0);
  // gradientRect's corner radius only rounds the top of a fresh rect; mask
  // the bottom two corners back to the frame's own dark surface to match
  // its radius.
  for (let y = ch - radius; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const inBottomLeft = x < radius && !roundedMask(cw, radius * 2, radius, x, y - (ch - radius * 2));
      const inBottomRight = x >= cw - radius && !roundedMask(cw, radius * 2, radius, x, y - (ch - radius * 2));
      if (inBottomLeft || inBottomRight) {
        const i = ((cy0 + y) * W + (cx0 + x)) * 4;
        png.data[i] = DARK.card[0]; png.data[i + 1] = DARK.card[1]; png.data[i + 2] = DARK.card[2];
      }
    }
  }

  // Status pill — ink text on the gradient, never white, per the brand book.
  const pillLabel = breaking ? 'BREAKING' : 'LIVE';
  const pillW = 30 + textWidth(pillLabel, 1);
  fillRoundedRectBlend(png, cx0 + 24, cy0 + 20, pillW, 26, 13, WHITE, 0.85);
  dot(png, cx0 + 38, cy0 + 33, 4, breaking ? LIGHT.purpleDeep : LIGHT.cyan);
  drawText(png, pillLabel, cx0 + 48, cy0 + 27, 1, INK);

  if (source) {
    const label = source.toUpperCase();
    drawText(png, label, cx0 + cw - 24 - textWidth(label, 1), cy0 + 27, 1, INK, 0.7);
  }

  // Headline — ink, word-wrapped, vertically centred in the remaining space.
  const headMaxW = cw - 64;
  const scale = fitScale(headline.toUpperCase(), headMaxW, 3, 2);
  const wrapped = wrapText(headline.toUpperCase(), scale, headMaxW).slice(0, 2);
  const lineH = GLYPH_H * scale + 10;
  const blockH = wrapped.length * lineH;
  let ty = cy0 + 20 + 26 + ((ch - 20 - 26 - blockH) / 2);
  for (const l of wrapped) {
    drawTextCentered(png, l, cx0 + cw / 2, ty, scale, INK);
    ty += lineH;
  }

  return PNG.sync.write(png);
}

module.exports = { generateNewsCard };
