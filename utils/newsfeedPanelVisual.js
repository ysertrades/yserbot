'use strict';

/**
 * newsfeedPanelVisual.js
 *
 * The live status card for /newsfeed's control panel — state, destination
 * channel, active sources and topic filter, all readable at a glance without
 * opening the image. Regenerated on every panel render so it always reflects
 * the current configuration.
 */

const {
  PNG, setPxBlend, glassPanel, flatBg, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered, textWidth, wrapText, GLYPH_H,
} = require('./pixelArt');

const BRAND = [29, 155, 240, 255];  // matches embedBuilder's 'news' colour
const WHITE = [255, 255, 255, 255];
const DIM   = [150, 162, 180, 255];
const ON    = [46, 204, 113, 255];
const OFF   = [231, 76, 60, 255];
const DARK  = [10, 14, 20, 255];

function truncate(text, scale, maxWidth) {
  if (textWidth(text, scale) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}...`, scale) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}

// A small lightning bolt — the real-time source.
function drawBoltIcon(png, cx, cy, size, color) {
  const pts = [[0.15, -1], [-0.35, 0.15], [0.05, 0.15], [-0.15, 1], [0.35, -0.1], [-0.05, -0.1]];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    line(png, cx + ax * size, cy + ay * size, cx + bx * size, cy + by * size, color, 3);
  }
}

const SOURCE_ICONS = { financialjuice: drawBoltIcon };

/**
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {string|null} opts.channelName - without the leading '#'
 * @param {Array<{key:string,label:string,blurb:string,active:boolean,cadence:string}>} opts.sources
 * @param {string} opts.topicsLabel - e.g. "ALL TOPICS" or "FOREX, CRYPTO"
 * @returns {Buffer} PNG image data
 */
function generateNewsfeedPanelImage(opts) {
  const { enabled, channelName, sources, topicsLabel } = opts;

  const W = 1100;
  const cardTop = 210, cardH = 150, cardGap = 18;
  const H = cardTop + sources.length * (cardH + cardGap) + 92;

  const png = new PNG({ width: W, height: H, colorType: 6 });
  flatBg(png, DARK);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: BRAND, tintAlpha: 0.06, border: BRAND, borderAlpha: 0.4 });

  // ── Header ────────────────────────────────────────────────────────────────
  drawTextCentered(png, 'NEWS FEED', W / 2, 46, 5, WHITE);
  drawTextCentered(png, 'MARKET HEADLINES DELIVERED TO YOUR CHANNEL', W / 2, 46 + 5 * GLYPH_H + 14, 2, [140, 200, 240, 255]);

  // ── State pill, top-right ─────────────────────────────────────────────────
  const pillText = enabled ? 'LIVE' : 'PAUSED';
  const pillW = 42 + textWidth(pillText, 2);
  const pillX = W - 46 - pillW;
  fillRoundedRectBlend(png, pillX, 42, pillW, 42, 10, enabled ? ON : OFF, 0.92);
  dot(png, pillX + 21, 63, 6, DARK);
  drawText(png, pillText, pillX + 35, 55, 2, DARK);

  // ── Destination row ───────────────────────────────────────────────────────
  const destY = 150;
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, destY - 22, BRAND, 0.28);
  drawText(png, 'CHANNEL', 62, destY, 2, DIM);
  drawText(png, channelName ? `#${channelName}`.toUpperCase() : 'NOT SET', 62 + textWidth('CHANNEL  ', 2), destY, 2, channelName ? WHITE : OFF);

  const topicsX = W / 2 + 40;
  drawText(png, 'TOPICS', topicsX, destY, 2, DIM);
  drawText(png, truncate(topicsLabel.toUpperCase(), 2, W - 66 - (topicsX + textWidth('TOPICS  ', 2))),
    topicsX + textWidth('TOPICS  ', 2), destY, 2, WHITE);

  // ── One card per source ───────────────────────────────────────────────────
  sources.forEach((src, i) => {
    const y = cardTop + i * (cardH + cardGap);
    const accent = src.active ? BRAND : [90, 98, 112, 255];

    glassPanel(png, 48, y, W - 96, cardH, {
      radius: 18, tint: accent, tintAlpha: src.active ? 0.09 : 0.04,
      border: accent, borderAlpha: src.active ? 0.5 : 0.22,
    });

    const icx = 118, icy = y + cardH / 2;
    ringStroke(png, icx, icy, 42, accent, 3);
    dotBlend(png, icx, icy, 37, accent, src.active ? 0.16 : 0.07);
    (SOURCE_ICONS[src.key] || drawBoltIcon)(png, icx, icy, 19, accent);

    const tx = 186;
    drawText(png, truncate(src.label.toUpperCase(), 3, 420), tx, y + 30, 3, src.active ? WHITE : DIM);
    const blurbLines = wrapText(src.blurb.toUpperCase(), 2, W - tx - 220);
    let by = y + 30 + 3 * GLYPH_H + 12;
    for (const l of blurbLines.slice(0, 2)) {
      drawText(png, l, tx, by, 2, src.active ? [176, 188, 206, 255] : [110, 118, 132, 255]);
      by += 2 * GLYPH_H + 6;
    }

    // Status chip + polling cadence, right-aligned inside the card
    const chip = src.active ? 'ON' : 'OFF';
    const chipW = 30 + textWidth(chip, 2);
    const chipX = W - 74 - chipW;
    fillRoundedRectBlend(png, chipX, y + 26, chipW, 36, 9, src.active ? ON : [70, 76, 88, 255], 0.92);
    drawText(png, chip, chipX + 15, y + 36, 2, src.active ? DARK : [190, 196, 208, 255]);
    const cad = src.cadence.toUpperCase();
    drawText(png, cad, W - 74 - textWidth(cad, 2), y + 84, 2, DIM);
  });

  drawTextCentered(png, 'USE THE BUTTONS BELOW TO CONFIGURE', W / 2, H - 58, 2, DIM);

  return PNG.sync.write(png);
}

module.exports = { generateNewsfeedPanelImage };
