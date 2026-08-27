'use strict';

/**
 * badges.js
 *
 * Pixel-art badge icon definitions (same house style as fish/mine's icons —
 * flat filled silhouettes via pixelArt.js primitives, no photos). Each
 * badge's `draw(png, cx, cy, size)` renders it centered at (cx, cy); used
 * both for the rank card and anywhere else a badge preview is needed.
 */

const { setPxBlend, dot, line, fillRect } = require('./pixelArt');

function fillRhombus(png, cx, cy, rx, ry, color, alpha = 1) {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if (Math.abs(dx) / rx + Math.abs(dy) / ry <= 1) setPxBlend(png, cx + dx, cy + dy, color, alpha);
    }
  }
}

function fillEllipse(png, cx, cy, rx, ry, color, alpha = 1) {
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) setPxBlend(png, cx + dx, cy + dy, color, alpha);
    }
  }
}

function drawStar(png, cx, cy, size, color) {
  fillRhombus(png, cx, cy, size * 0.32, size * 0.32, color);
  line(png, cx - size, cy, cx + size, cy, color, 3);
  line(png, cx, cy - size, cx, cy + size, color, 3);
  line(png, cx - size * 0.68, cy - size * 0.68, cx + size * 0.68, cy + size * 0.68, color, 2);
  line(png, cx - size * 0.68, cy + size * 0.68, cx + size * 0.68, cy - size * 0.68, color, 2);
  dot(png, cx, cy, size * 0.2, [255, 255, 255, 255]);
}

function drawCrown(png, cx, cy, size, color) {
  fillRect(png, cx - size, cy + size * 0.35, size * 2, size * 0.4, color);
  [-1, 0, 1].forEach(i => {
    const sx = cx + i * size * 0.65;
    const sy = cy + size * 0.35 - (i === 0 ? size * 0.55 : size * 0.3);
    fillRhombus(png, sx, sy, size * 0.3, size * 0.4, color);
    dot(png, sx, sy - size * 0.35, size * 0.09, [255, 255, 255, 255]);
  });
}

function drawShield(png, cx, cy, size, color) {
  const w = size * 1.3, h = size * 1.7;
  for (let dy = -h * 0.5; dy <= h * 0.5; dy++) {
    for (let dx = -w * 0.5; dx <= w * 0.5; dx++) {
      const nx = dx / (w * 0.5), ny = dy / (h * 0.5);
      const inside = ny < 0 ? (nx * nx + (ny * 1.4) * (ny * 1.4) <= 1) : (Math.abs(nx) <= 1 - ny);
      if (inside) setPxBlend(png, cx + dx, cy + dy, color, 1);
    }
  }
  line(png, cx, cy - h * 0.32, cx, cy + h * 0.22, [255, 255, 255, 255], 2);
}

// Pointed top, bulging middle, rounded bottom — a proper flame silhouette
// rather than stacked circles (which reads as a lightbulb/snowman instead).
function fillFlameShape(png, cx, cy, size, color) {
  const w = size * 1.3, h = size * 2.1;
  const top = -h * 0.55, bottom = h * 0.45;
  for (let dy = top; dy <= bottom; dy++) {
    const ny = dy / (h * 0.5);
    let halfWidth;
    if (ny < -0.15) {
      const shrink = Math.max(0, (ny - top / (h * 0.5)) / (-0.15 - top / (h * 0.5)));
      halfWidth = shrink * 0.5 * (w * 0.5);
    } else {
      const t = (ny + 0.15) / (bottom / (h * 0.5) + 0.15);
      halfWidth = (0.35 + 0.65 * Math.sin(Math.min(t, 1) * Math.PI * 0.85)) * (w * 0.5);
    }
    for (let dx = -halfWidth; dx <= halfWidth; dx++) setPxBlend(png, cx + dx, cy + dy, color, 1);
  }
}

function drawFlame(png, cx, cy, size, color) {
  fillFlameShape(png, cx, cy, size, color);
  fillFlameShape(png, cx, cy + size * 0.25, size * 0.55, [255, 224, 130, 255]);
}

function drawDiamond(png, cx, cy, size, color) {
  fillRhombus(png, cx, cy, size, size * 1.1, color);
  const facet = [255, 255, 255, 180];
  line(png, cx, cy - size * 1.1, cx - size * 0.5, cy, facet, 1);
  line(png, cx, cy - size * 1.1, cx + size * 0.5, cy, facet, 1);
  dot(png, cx - size * 0.3, cy - size * 0.4, size * 0.12, [255, 255, 255, 255]);
}

const BADGE_DEFS = {
  star:    { label: 'Star',    emoji: '⭐', color: [255, 215, 0, 255],   draw: drawStar },
  crown:   { label: 'Crown',   emoji: '👑', color: [255, 190, 60, 255],  draw: drawCrown },
  shield:  { label: 'Shield',  emoji: '🛡️', color: [52, 152, 219, 255], draw: drawShield },
  flame:   { label: 'Flame',   emoji: '🔥', color: [230, 90, 40, 255],   draw: drawFlame },
  diamond: { label: 'Diamond', emoji: '💎', color: [110, 200, 255, 255], draw: drawDiamond },
};

module.exports = { BADGE_DEFS };
