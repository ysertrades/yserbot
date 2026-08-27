'use strict';

/**
 * workVisual.js
 *
 * Visuals for /work — reuses generateJobCardImage from jobsVisual.js (the
 * same portrait card layout as the /jobs completion cards and /fish, /mine
 * catch cards) so the whole economy feature set reads as one consistent
 * system, with its own set of task icons matching work.js's TASKS list.
 */

const {
  setPxBlend, dot, dotBlend, ringStroke, line, fillRoundedRectBlend,
} = require('./pixelArt');
const { generateJobCardImage } = require('./jobsVisual');

const WHITE = [255, 255, 255, 255];
const DARK = [15, 20, 30, 255];

function drawLaptopIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size, cy - size * 0.65, size * 2, size * 1.15, 4, color, 1);
  for (let dy = -size * 0.45; dy <= size * 0.15; dy += 3) {
    for (let dx = -size * 0.75; dx <= size * 0.75; dx += 1) setPxBlend(png, cx + dx, cy + dy, DARK, 0.6);
  }
  const bx = cx - size * 0.22, by = cy - size * 0.28, bw = size * 0.16, bh = size * 0.16;
  line(png, bx + bw, by - bh, bx, by, WHITE, 2);
  line(png, bx, by, bx + bw, by + bh, WHITE, 2);
  line(png, bx + size * 0.44 - bw, by - bh, bx + size * 0.44, by, WHITE, 2);
  line(png, bx + size * 0.44, by, bx + size * 0.44 - bw, by + bh, WHITE, 2);
  line(png, cx - size * 1.15, cy + size * 0.5, cx + size * 1.15, cy + size * 0.5, color, 4);
}

function drawPizzaIcon(png, cx, cy, size, color) {
  // Triangular slice, point down, with a crust arc and pepperoni dots.
  for (let dy = -size * 0.9; dy <= size * 0.9; dy += 1) {
    const t = (dy + size * 0.9) / (size * 1.8);
    const halfW = size * 0.85 * t;
    for (let dx = -halfW; dx <= halfW; dx += 1) setPxBlend(png, cx + dx, cy + dy, color, 1);
  }
  line(png, cx - size * 0.85, cy + size * 0.9, cx + size * 0.85, cy + size * 0.9, [200, 150, 60, 255], 4);
  const pep = [200, 50, 50, 255];
  dot(png, cx - size * 0.25, cy + size * 0.35, size * 0.13, pep);
  dot(png, cx + size * 0.15, cy + size * 0.55, size * 0.13, pep);
  dot(png, cx, cy + size * 0.05, size * 0.13, pep);
}

function drawBookIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size, cy - size * 0.75, size * 0.95, size * 1.5, 3, color, 1);
  fillRoundedRectBlend(png, cx + size * 0.05, cy - size * 0.75, size * 0.95, size * 1.5, 3, color, 0.85);
  line(png, cx, cy - size * 0.75, cx, cy + size * 0.75, DARK, 2);
  for (const dy of [-size * 0.35, 0, size * 0.35]) {
    line(png, cx - size * 0.75, cy + dy, cx - size * 0.15, cy + dy, DARK, 1);
    line(png, cx + size * 0.15, cy + dy, cx + size * 0.75, cy + dy, DARK, 1);
  }
}

function drawPaletteIcon(png, cx, cy, size, color) {
  for (let dy = -size; dy <= size; dy += 1) {
    for (let dx = -size; dx <= size * 0.7; dx += 1) {
      if ((dx * dx) / (size * size) + (dy * dy) / (size * 0.85 * size * 0.85) > 1) continue;
      if (Math.hypot(dx - size * 0.25, dy + size * 0.1) < size * 0.35) continue; // thumb hole
      setPxBlend(png, cx + dx, cy + dy, color, 1);
    }
  }
  const blobs = [[-0.5, -0.4, [231, 76, 60, 255]], [0.1, -0.6, [241, 196, 15, 255]], [-0.6, 0.3, [52, 152, 219, 255]], [-0.1, 0.5, [46, 204, 113, 255]]];
  for (const [fx, fy, col] of blobs) dot(png, cx + fx * size, cy + fy * size, size * 0.14, col);
}

function drawMusicNoteIcon(png, cx, cy, size, color) {
  line(png, cx + size * 0.35, cy - size, cx + size * 0.35, cy + size * 0.55, color, 4);
  line(png, cx + size * 0.35, cy - size, cx + size * 0.95, cy - size * 0.75, color, 4);
  dotBlend(png, cx - size * 0.15, cy + size * 0.65, size * 0.4, color, 1);
}

function drawBoltIcon(png, cx, cy, size, color) {
  const pts = [[0.15, -1], [-0.35, 0.15], [0.05, 0.15], [-0.15, 1], [0.35, -0.1], [-0.05, -0.1]];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    line(png, cx + ax * size, cy + ay * size, cx + bx * size, cy + by * size, color, 3);
  }
}

function drawSuitBriefcaseIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size, cy - size * 0.4, size * 2, size * 0.95, 6, color, 1);
  line(png, cx - size * 0.35, cy - size * 0.4, cx - size * 0.35, cy - size * 0.65, color, 3);
  line(png, cx + size * 0.35, cy - size * 0.4, cx + size * 0.35, cy - size * 0.65, color, 3);
  line(png, cx - size * 0.35, cy - size * 0.65, cx + size * 0.35, cy - size * 0.65, color, 3);
  line(png, cx - size, cy + size * 0.05, cx + size, cy + size * 0.05, DARK, 3);
}

function drawCraneIcon(png, cx, cy, size, color) {
  line(png, cx - size * 0.6, cy + size, cx - size * 0.6, cy - size * 0.9, color, 4);
  line(png, cx - size * 0.6, cy - size * 0.9, cx + size * 0.9, cy - size * 0.5, color, 4);
  line(png, cx - size * 0.6, cy - size * 0.6, cx - size * 0.1, cy - size * 1.05, color, 3);
  line(png, cx + size * 0.5, cy - size * 0.6, cx + size * 0.5, cy + size * 0.1, color, 2);
  fillRoundedRectBlend(png, cx + size * 0.3, cy + size * 0.1, size * 0.4, size * 0.3, 2, [230, 180, 40, 255], 1);
}

const TASK_ICONS = {
  '💻': drawLaptopIcon,
  '🍕': drawPizzaIcon,
  '📚': drawBookIcon,
  '🎨': drawPaletteIcon,
  '🎵': drawMusicNoteIcon,
  '⚡': drawBoltIcon,
  '🧑‍💼': drawSuitBriefcaseIcon,
  '🏗️': drawCraneIcon,
};

const TASK_COLORS = {
  '💻': [52, 152, 219, 255],
  '🍕': [230, 126, 34, 255],
  '📚': [155, 89, 182, 255],
  '🎨': [231, 76, 60, 255],
  '🎵': [46, 204, 113, 255],
  '⚡': [241, 196, 15, 255],
  '🧑‍💼': [149, 165, 166, 255],
  '🏗️': [230, 126, 34, 255],
};

/**
 * @param {object} opts
 * @param {string} opts.taskEmoji - one of work.js's TASKS[].emoji, used to pick the icon/accent
 * @param {string} opts.task - the flavor text, e.g. "coded a Discord bot from scratch"
 * @param {number} opts.earnings
 * @param {boolean} [opts.boostActive]
 * @returns {Buffer} PNG image data
 */
function generateWorkResultImage(opts) {
  const { taskEmoji, task, earnings, boostActive = false } = opts;
  const icon = TASK_ICONS[taskEmoji] || drawSuitBriefcaseIcon;
  const accent = boostActive ? [255, 215, 0, 255] : (TASK_COLORS[taskEmoji] || [46, 204, 113, 255]);

  return generateJobCardImage({
    icon, accent,
    kicker: 'Work',
    banner: 'Work Complete',
    task: `You ${task}${boostActive ? ' (coin boost active!)' : ''}.`,
    amountLabel: `+${earnings.toLocaleString()} COINS`,
  });
}

/**
 * @param {object} opts
 * @param {string} opts.hours
 * @param {string} opts.minutes
 * @returns {Buffer} PNG image data
 */
function generateWorkCooldownImage(opts) {
  const { hours, minutes } = opts;
  return generateJobCardImage({
    icon: drawSuitBriefcaseIcon, accent: [231, 76, 60, 255],
    kicker: 'Work',
    banner: 'Still Recovering',
    task: `Back on the clock in ${hours}h ${minutes}m.`,
    amountLabel: null,
  });
}

module.exports = { generateWorkResultImage, generateWorkCooldownImage, TASK_ICONS, TASK_COLORS };
