'use strict';

/**
 * marketSessionVisual.js
 *
 * A large "trading session open" poster in the same flat-glassmorphism
 * house style as the economic calendar cards — a skyline badge, a bold
 * status pill, big session name, and a bold time chip (legible at a
 * glance, not fine print) plus a tagline banner. `generateMarketSessionImage`
 * is the reusable template; `generateNyseOpenImage` is the concrete NYSE
 * poster requested, so adding another session later (London/Tokyo/Sydney)
 * is just another thin wrapper.
 *
 * The badge icon and the pill wording are pluggable (`icon`/`pillText`), and
 * an optional soft `pulse` ring can wrap the badge — so a second session
 * reuses the exact same skeleton (panel, pill, badge, title stack, time chip,
 * tagline) without reading as a recolored copy of the first. `drawCandleIcon`
 * + `generateFuturesOpenImage` is that second session: the CME Globex Sunday
 * reopen, told through a small candlestick read (two dim candles from the week
 * that just closed, one bright taller one for the new week's first print)
 * rather than a skyline.
 */

const {
  PNG, setPxBlend, dot, dotBlend, ringStroke, ringBlend, line,
  fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, fitScale, GLYPH_H,
} = require('./pixelArt');
const { RGBA: LIGHT, RGBA_DARK: SURF, darkCard, fillCanvas } = require('./brandTheme');

const GOOD = LIGHT.cyan;
const WHITE = SURF.ink;    // the brand's light-on-dark text colour, not literal white
const DARK = [10, 11, 15, 255];   // plain near-black — icon window/shadow shading only
// QuantLab's own purple — used for Sunday's futures reopen so the poster
// reads as a second step in the same family, not a recolored NYSE.
const PURPLE = LIGHT.purple;

function drawSkylineIcon(png, cx, cy, size, color) {
  const buildings = [
    { dx: -0.95, w: 0.32, h: 0.85 },
    { dx: -0.55, w: 0.38, h: 1.25 },
    { dx: -0.08, w: 0.42, h: 1.65 },
    { dx: 0.42, w: 0.34, h: 1.05 },
    { dx: 0.82, w: 0.3, h: 0.72 },
  ];
  const flagBuilding = buildings[2]; // the flag sits atop this (tallest, middle) building

  // The skyline's own silhouette isn't symmetric (the buildings/flag don't
  // straddle dx=0 evenly, and the flag adds extra height above the roofline),
  // so centering on (cx, cy) needs the actual drawn bounding box, not a
  // guessed offset. Compute it once here and shift the whole icon so its
  // true visual center — not just the building baseline — lands on (cx, cy).
  let minX = Infinity, maxX = -Infinity;
  for (const b of buildings) {
    minX = Math.min(minX, b.dx - b.w / 2);
    maxX = Math.max(maxX, b.dx + b.w / 2);
  }
  const topUnits = -(flagBuilding.h + 0.28 + 0.11); // flag rectangle's top edge — the highest drawn pixel
  const bottomUnits = 0; // every building's base

  const originX = cx - ((minX + maxX) / 2) * size;
  const baseY = cy - ((topUnits + bottomUnits) / 2) * size;

  for (const b of buildings) {
    const bx = originX + b.dx * size, bw = b.w * size, bh = b.h * size;
    fillRoundedRectBlend(png, bx - bw / 2, baseY - bh, bw, bh, 3, color, 1);
    for (let wy = baseY - bh + 10; wy < baseY - 6; wy += 12) {
      for (let wx = bx - bw / 2 + 6; wx < bx + bw / 2 - 6; wx += 10) {
        setPxBlend(png, wx, wy, DARK, 0.55);
      }
    }
  }
  const flagX = originX + flagBuilding.dx * size, flagTopY = baseY - flagBuilding.h * size;
  line(png, flagX, flagTopY, flagX, flagTopY - size * 0.28, color, 2);
  fillRoundedRectBlend(png, flagX, flagTopY - size * 0.28, size * 0.2, size * 0.11, 1, color, 0.9);
}

// A thin vertical stroke that can be translucent — the flat `line()` helper
// only ever draws opaque, and a candle's wick needs to dim along with its
// body for the "already closed" candles to read as behind the bright one.
function vWickBlend(png, x, yTop, yBot, color, alpha, th = 2) {
  const half = Math.floor(th / 2);
  const top = Math.round(Math.min(yTop, yBot)), bot = Math.round(Math.max(yTop, yBot));
  for (let y = top; y <= bot; y++) {
    for (let t = -half; t <= half; t++) setPxBlend(png, x + t, y, color, alpha);
  }
}

/**
 * Three candles instead of a skyline: two dim ones from the week that just
 * closed, and one bright, taller candle — the new week's first print. Each is
 * a plain body with a single straight wick through it. Candles float at their
 * own heights rather than sharing a baseline, so the bounding box (and the
 * centering on it) is computed in both axes rather than just measured
 * sideways like the skyline.
 */
function drawCandleIcon(png, cx, cy, size, color) {
  const candles = [
    { dx: -0.85, y: 0.20, w: 0.26, bodyH: 0.40, wick: 0.20, dim: true },
    { dx: -0.30, y: -0.02, w: 0.26, bodyH: 0.60, wick: 0.24, dim: true },
    { dx: 0.38, y: -0.44, w: 0.40, bodyH: 0.95, wick: 0.32, dim: false },
  ];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of candles) {
    minX = Math.min(minX, c.dx - c.w / 2);
    maxX = Math.max(maxX, c.dx + c.w / 2);
    minY = Math.min(minY, c.y - c.bodyH / 2 - c.wick);
    maxY = Math.max(maxY, c.y + c.bodyH / 2 + c.wick);
  }

  const originX = cx - ((minX + maxX) / 2) * size;
  const originY = cy - ((minY + maxY) / 2) * size;

  for (const c of candles) {
    const bx = originX + c.dx * size, bw = c.w * size;
    const bodyCy = originY + c.y * size, bh = c.bodyH * size;
    const top = bodyCy - bh / 2, bottom = bodyCy + bh / 2;
    const alpha = c.dim ? 0.4 : 1;
    vWickBlend(png, bx, top - c.wick * size, bottom + c.wick * size, color, alpha, 2);
    fillRoundedRectBlend(png, bx - bw / 2, top, bw, bh, 3, color, alpha);
  }
}

function drawBgBars(png, W, H, color) {
  const bars = 16;
  const colW = W / bars;
  for (let i = 0; i < bars; i++) {
    const bw = colW * 0.5;
    const bx = colW * i + (colW - bw) / 2;
    const bh = 24 + (i % 5) * 14 + i * 2.5;
    fillRoundedRectBlend(png, bx, H - 30 - bh, bw, bh, 2, color, 0.05);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.sessionLabel - e.g. "NYSE OPEN"
 * @param {string} opts.exchangeName - e.g. "NEW YORK STOCK EXCHANGE"
 * @param {string} opts.time - e.g. "9:30 AM EST"
 * @param {string} opts.tagline - e.g. "Markets are live. Follow your strategy and manage risk."
 * @param {[number,number,number,number]} [opts.accent] - RGBA accent color, defaults to green
 * @param {Function} [opts.icon] - (png, cx, cy, size, color) => void, drawn in the left badge; defaults to the skyline
 * @param {string} [opts.pillText] - top-right status pill text, defaults to "LIVE"
 * @param {boolean} [opts.pulse] - adds a soft outer glow ring around the badge, off by default
 * @returns {Buffer} PNG image data
 */
function generateMarketSessionImage(opts) {
  const {
    sessionLabel, exchangeName, time, tagline, accent = GOOD,
    icon = drawSkylineIcon, pillText = 'LIVE', pulse = false,
  } = opts;
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  fillCanvas(png, SURF.bg);
  drawBgBars(png, W, H, accent);
  darkCard(png, 20, 20, W - 40, H - 40, { radius: 28 });

  // ── Content column, shared by everything right of the badge ──────────────
  const contentLeft = 356, contentRight = W - 44, contentWidth = contentRight - contentLeft;
  const contentCx = (contentLeft + contentRight) / 2;

  // ── Status pill, top-right ────────────────────────────────────────────────
  const pillW = 40 + textWidth(pillText, 2);
  const pillX = W - 44 - pillW, pillY = 40;
  fillRoundedRectBlend(png, pillX, pillY, pillW, 42, 10, accent, 0.9);
  dot(png, pillX + 20, pillY + 21, 6, WHITE);
  drawText(png, pillText, pillX + 34, pillY + 13, 2, DARK);

  // ── Badge, left ──────────────────────────────────────────────────────────
  const bcx = 176, bcy = 230;
  if (pulse) ringBlend(png, bcx, bcy, 150, 12, accent, 0.14);
  ringStroke(png, bcx, bcy, 132, accent, 4);
  dotBlend(png, bcx, bcy, 118, accent, 0.12);
  icon(png, bcx, bcy, 78, accent);

  // ── Session name + exchange subtitle ────────────────────────────────────────
  // The title shares a band with the status pill, so its room stops short of
  // the pill rather than running underneath it — a long label steps down a
  // scale at a time instead, which is what fitScale is for. A short one
  // ("NYSE OPEN") never reaches the limit and keeps the full size.
  const titleText = sessionLabel.toUpperCase();
  const titleRoom = 2 * Math.min(contentCx - contentLeft, pillX - 14 - contentCx);
  const titleScale = fitScale(titleText, titleRoom, 6, 3);
  drawTextCentered(png, titleText, contentCx, 68, titleScale, WHITE);
  drawTextCentered(png, exchangeName.toUpperCase(), contentCx, 68 + titleScale * GLYPH_H + 16, 2, accent);

  // ── Bold time chip ──────────────────────────────────────────────────────────
  const timeText = time.toUpperCase();
  const chipW = 48 + textWidth(timeText, 3);
  const chipX = contentCx - chipW / 2, chipY = 190;
  fillRoundedRectBlend(png, chipX, chipY, chipW, 56, 12, WHITE, 0.12);
  drawTextCentered(png, timeText, contentCx, chipY + 16, 3, WHITE);

  // ── Tagline banner — confined to the right content column so it never
  //    runs into the skyline badge on the left ────────────────────────────────
  for (let x = contentLeft; x < contentRight; x++) setPxBlend(png, x, 288, accent, 0.3);
  const lines = wrapText(tagline.toUpperCase(), 2, contentWidth);
  let ty = 310;
  for (const l of lines.slice(0, 2)) { drawTextCentered(png, l, contentCx, ty, 2, SURF.grey1); ty += GLYPH_H * 2 + 10; }

  return PNG.sync.write(png);
}

function generateNyseOpenImage() {
  return generateMarketSessionImage({
    sessionLabel: 'NYSE OPEN',
    exchangeName: 'New York Stock Exchange',
    time: '9:30 AM EST',
    tagline: 'Markets are live. Follow your strategy and manage risk.',
  });
}

// CME Globex reopens for the new trading week Sunday at 6:00 PM EST — the
// futures "week open" everyone watching NYSE's 9:30 bell is also watching.
// Same poster skeleton as NYSE, told through the candle badge/blue accent
// instead of a second skyline in a different color.
function generateFuturesOpenImage() {
  return generateMarketSessionImage({
    sessionLabel: 'FUTURES OPEN',
    exchangeName: 'CME Globex',
    time: 'SUN 6:00 PM EST',
    tagline: "The week's first candle is forming - trade the plan, not your emotions.",
    accent: PURPLE,
    icon: drawCandleIcon,
    // 'LIVE' rather than a longer word: the pill shares the title's band, and
    // anything wider pushes "FUTURES OPEN" down a size to clear it. The
    // headline is the part worth the room.
    pillText: 'LIVE',
    pulse: true,
  });
}

// The icons are exported alongside the template because `icon` is a parameter
// now — a future session poster picks one of these or supplies its own.
module.exports = {
  generateMarketSessionImage, generateNyseOpenImage, generateFuturesOpenImage,
  drawSkylineIcon, drawCandleIcon,
};
