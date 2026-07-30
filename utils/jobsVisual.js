'use strict';

/**
 * jobsVisual.js
 *
 * Visuals for the /jobs feature: a bold "homepage" poster showing every job
 * at a glance (icon, pay range, cooldown, live ready/on-shift status for
 * whoever's viewing it — regenerated fresh per interaction like the other
 * dynamic visuals), plus a generic portrait "result card" generator (shift
 * complete / still on shift) in the same style as the /fish and /mine catch
 * cards. The result-card generator is intentionally generic — /work reuses
 * it directly (see workVisual.js) instead of duplicating the card layout.
 */

const {
  PNG, setPxBlend, roundedMask, dot, dotBlend, ringStroke, line,
  glassPanel, flatBg, fillRoundedRectBlend, drawText, drawTextCentered, wrapText, textWidth, GLYPH_H,
} = require('./pixelArt');

const GOOD = [46, 204, 113, 255];
const WHITE = [255, 255, 255, 255];
const DIM = [150, 158, 172, 255];
const DARK = [15, 20, 30, 255];

/* ─── Per-job icons ──────────────────────────────────────────────────────── */

function drawLaptopIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size, cy - size * 0.65, size * 2, size * 1.15, 4, color, 1);
  for (let dy = -size * 0.45; dy <= size * 0.15; dy += 3) {
    for (let dx = -size * 0.75; dx <= size * 0.75; dx += 1) setPxBlend(png, cx + dx, cy + dy, DARK, 0.6);
  }
  // Angle brackets drawn as lines — '<'/'>' have no glyph in the pixel font.
  const bx = cx - size * 0.22, by = cy - size * 0.28, bw = size * 0.16, bh = size * 0.16;
  line(png, bx + bw, by - bh, bx, by, WHITE, 2);
  line(png, bx, by, bx + bw, by + bh, WHITE, 2);
  line(png, bx + size * 0.44 - bw, by - bh, bx + size * 0.44, by, WHITE, 2);
  line(png, bx + size * 0.44, by, bx + size * 0.44 - bw, by + bh, WHITE, 2);
  line(png, cx - size * 1.15, cy + size * 0.5, cx + size * 1.15, cy + size * 0.5, color, 4);
}

function drawCandlestickIcon(png, cx, cy, size, color) {
  const bars = [
    { x: -0.7, top: -0.9, bodyTop: -0.5, bodyBot: 0.1, bot: 0.3, up: true },
    { x: -0.2, top: -0.5, bodyTop: 0.0, bodyBot: 0.6, bot: 0.8, up: false },
    { x: 0.3, top: -1.1, bodyTop: -0.7, bodyBot: -0.1, bot: 0.15, up: true },
    { x: 0.8, top: -0.3, bodyTop: 0.05, bodyBot: 0.5, bot: 0.7, up: true },
  ];
  for (const b of bars) {
    const bx = cx + b.x * size;
    const col = b.up ? GOOD : color;
    line(png, bx, cy + b.top * size, bx, cy + b.bot * size, col, 2);
    fillRoundedRectBlend(png, bx - size * 0.16, cy + b.bodyTop * size, size * 0.32, (b.bodyBot - b.bodyTop) * size, 1, col, 1);
  }
}

function drawColumnsIcon(png, cx, cy, size, color) {
  line(png, cx - size, cy + size * 0.6, cx + size, cy + size * 0.6, color, 4);
  for (let i = -1; i <= 1; i++) {
    const x = cx + i * size * 0.7;
    line(png, x, cy - size * 0.3, x, cy + size * 0.45, color, 5);
  }
  line(png, cx - size * 1.1, cy - size * 0.45, cx, cy - size * 0.95, color, 3);
  line(png, cx, cy - size * 0.95, cx + size * 1.1, cy - size * 0.45, color, 3);
}

function drawChipStackIcon(png, cx, cy, size, color) {
  for (const dy of [0.45, 0.1, -0.25]) {
    dotBlend(png, cx, cy + dy * size, size * 0.55, color, 1);
    ringStroke(png, cx, cy + dy * size, size * 0.55, DARK, 2);
  }
  dotBlend(png, cx, cy - size * 0.25, size * 0.2, WHITE, 0.8);
}

function drawWheatIcon(png, cx, cy, size, color) {
  line(png, cx, cy + size * 1.1, cx, cy - size * 0.6, color, 3);
  for (let i = 0; i < 5; i++) {
    const y = cy - size * 0.6 + i * size * 0.32;
    const w = size * 0.55 * (1 - i * 0.12);
    line(png, cx, y, cx - w, y - size * 0.22, color, 2);
    line(png, cx, y, cx + w, y - size * 0.22, color, 2);
  }
  dot(png, cx, cy - size * 0.75, size * 0.14, color);
}

function drawCarIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size, cy - size * 0.15, size * 2, size * 0.55, 6, color, 1);
  fillRoundedRectBlend(png, cx - size * 0.55, cy - size * 0.6, size * 1.1, size * 0.5, 5, color, 1);
  dotBlend(png, cx - size * 0.55, cy + size * 0.45, size * 0.22, DARK, 1);
  dotBlend(png, cx + size * 0.55, cy + size * 0.45, size * 0.22, DARK, 1);
  dotBlend(png, cx - size * 0.55, cy + size * 0.45, size * 0.09, [200, 210, 220, 255], 1);
  dotBlend(png, cx + size * 0.55, cy + size * 0.45, size * 0.09, [200, 210, 220, 255], 1);
}

function drawChefHatIcon(png, cx, cy, size, color) {
  dotBlend(png, cx - size * 0.5, cy - size * 0.35, size * 0.4, color, 1);
  dotBlend(png, cx, cy - size * 0.55, size * 0.45, color, 1);
  dotBlend(png, cx + size * 0.5, cy - size * 0.35, size * 0.4, color, 1);
  fillRoundedRectBlend(png, cx - size * 0.55, cy - size * 0.25, size * 1.1, size * 0.55, 3, color, 1);
  line(png, cx - size * 0.55, cy + size * 0.3, cx + size * 0.55, cy + size * 0.3, DARK, 3);
}

function drawPhoneIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.55, cy - size * 1.05, size * 1.1, size * 2.1, 8, color, 1);
  dotBlend(png, cx, cy, size * 0.42, DARK, 1);
  // Play-button triangle, filled via horizontal scanlines that taper to a point.
  const t = size * 0.2;
  for (let yy = -t; yy <= t; yy += 1) {
    const width = t - Math.abs(yy);
    line(png, cx - t * 0.35, cy + yy, cx - t * 0.35 + width, cy + yy, WHITE, 1);
  }
}

const JOB_ICONS = {
  software_dev: drawLaptopIcon,
  day_trader: drawCandlestickIcon,
  banker: drawColumnsIcon,
  casino_dealer: drawChipStackIcon,
  farmer: drawWheatIcon,
  uber_driver: drawCarIcon,
  chef: drawChefHatIcon,
  content_creator: drawPhoneIcon,
};

const JOB_COLORS = {
  software_dev: [52, 152, 219, 255],
  day_trader: [46, 204, 113, 255],
  banker: [155, 89, 182, 255],
  casino_dealer: [231, 76, 60, 255],
  farmer: [230, 200, 60, 255],
  uber_driver: [241, 196, 15, 255],
  chef: [230, 126, 34, 255],
  content_creator: [233, 30, 99, 255],
};

function truncate(text, scale, maxWidth) {
  if (textWidth(text, scale) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && textWidth(`${t}...`, scale) > maxWidth) t = t.slice(0, -1);
  return `${t}...`;
}

/**
 * The Jobs Hub homepage — every job visible at once, bold enough to read
 * without opening the image full-size. Regenerated fresh per interaction
 * so it reflects whoever's looking at it: their own live ready/on-shift
 * status per job.
 * @param {Array} jobs - JOBS array from commands/economy/jobs.js
 * @param {(job: object) => {ready: boolean, ts: number}} statusFor
 * @param {object|null} boost - active coin_boost effect, or null
 */
function generateJobsHubImage(jobs, statusFor, boost) {
  const cols = 4, rows = 2;
  const W = 1200;
  const gridTop = 160, cellH = 210;
  const gridBottom = gridTop + rows * cellH;
  const H = gridBottom + 50;

  const png = new PNG({ width: W, height: H, colorType: 6 });
  const brand = [230, 126, 34, 255];
  flatBg(png, [16, 13, 9, 255]);
  glassPanel(png, 20, 20, W - 40, H - 40, { radius: 28, tint: brand, tintAlpha: 0.06, border: brand, borderAlpha: 0.4 });

  drawTextCentered(png, 'JOBS HUB', W / 2, 40, 5, WHITE);
  drawTextCentered(png,
    boost ? `ALL EARNINGS ${boost.multiplier || 1.5}X — COIN BOOST ACTIVE` : 'CLOCK IN AT ANY JOB FOR INSTANT PAY',
    W / 2, 40 + 5 * GLYPH_H + 14, 2, boost ? [255, 215, 0, 255] : [190, 180, 170, 255]);
  for (let x = 60; x < W - 60; x++) setPxBlend(png, x, 134, brand, 0.3);

  const cellW = (W - 120) / cols;

  jobs.forEach((job, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = 60 + col * cellW + cellW / 2;
    const cellTop = gridTop + row * cellH;
    const cy = cellTop + 78;
    const color = JOB_COLORS[job.id] || brand;
    const icon = JOB_ICONS[job.id];
    const { ready } = statusFor(job);

    ringStroke(png, cx, cy, 46, color, 3);
    dotBlend(png, cx, cy, 41, color, 0.14);
    if (icon) icon(png, cx, cy, 22, color);

    // Status ring accent — green dot for ready, dim for on cooldown.
    dotBlend(png, cx + 38, cy - 32, 10, ready ? GOOD : [90, 96, 108, 255], 1);
    ringStroke(png, cx + 38, cy - 32, 10, [16, 13, 9, 255], 3);

    const nameY = cy + 60;
    drawTextCentered(png, truncate(job.name.toUpperCase(), 2, cellW - 16), cx, nameY, 2, WHITE);
    drawTextCentered(png, `${job.min.toLocaleString()}-${job.max.toLocaleString()} COINS${job.variance ? ' *' : ''}`, cx, nameY + 2 * GLYPH_H + 10, 1, [210, 195, 160, 255]);
    drawTextCentered(png, ready ? 'READY NOW' : `COOLDOWN ${job.cooldownLabel}`, cx, nameY + 2 * GLYPH_H + 10 + GLYPH_H + 8, 1, ready ? GOOD : DIM);
  });

  return PNG.sync.write(png);
}

/**
 * Generic portrait result/status card — shared by every job AND by /work
 * (see workVisual.js). Matches the /fish, /mine catch-card proportions and
 * layout so the whole economy feature set reads as one consistent system.
 * @param {object} opts
 * @param {(png, cx, cy, size, color) => void} opts.icon
 * @param {[number,number,number,number]} opts.accent
 * @param {string} opts.kicker - small top label, e.g. "SOFTWARE DEVELOPER" or "WORK"
 * @param {string} opts.banner - big status line, e.g. "SHIFT COMPLETE" or "STILL ON SHIFT"
 * @param {string} [opts.task] - flavor text describing what happened (wraps to multiple lines)
 * @param {string} [opts.amountLabel] - big highlighted line, e.g. "+250 COINS" or a countdown label
 * @param {[number,number,number,number]} [opts.amountColor]
 * @returns {Buffer} PNG image data
 */
function generateJobCardImage(opts) {
  const { icon, accent, kicker, banner, task, amountLabel, amountColor = [255, 215, 0, 255] } = opts;
  const W = 640, H = 620;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const panelRadius = 22;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!roundedMask(W, H, panelRadius, x, y)) continue;
      const band = Math.floor((y / H) * 6);
      const shade = 20 - band * 2;
      setPxBlend(png, x, y, [shade + 10, shade + 8, shade + 6, 255], 1);
    }
  }

  drawText(png, kicker.toUpperCase(), 30, 26, 2, [190, 180, 170, 255]);

  const cx = W / 2, cy = 220;
  ringStroke(png, cx, cy, 120, accent, 4);
  dotBlend(png, cx, cy, 108, accent, 0.14);
  icon(png, cx, cy, 62, accent);

  drawTextCentered(png, banner.toUpperCase(), cx, cy + 150, 3, WHITE);

  let ty = cy + 150 + 3 * GLYPH_H + 30;
  if (task) {
    const lines = wrapText(task, 2, W - 100);
    for (const l of lines.slice(0, 3)) {
      drawTextCentered(png, l, cx, ty, 2, [200, 205, 215, 255]);
      ty += 2 * GLYPH_H + 10;
    }
    ty += 14;
  }

  if (amountLabel) {
    drawTextCentered(png, amountLabel, cx, ty, 3, amountColor);
  }

  return PNG.sync.write(png);
}

module.exports = {
  JOB_ICONS, JOB_COLORS,
  generateJobsHubImage,
  generateJobCardImage,
};
