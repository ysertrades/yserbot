'use strict';

/**
 * lockVisual.js
 *
 * A compact, minimal card for /lock and /unlock — a single padlock icon
 * (closed or open), the status line, the channel, and the reason ONLY when
 * one was actually given (no reserved title/space for it otherwise).
 */

const {
  PNG, setPx, setPxBlend, line, dotBlend, ringStroke,
  flatBg, glassPanel, GLYPH_H, drawTextCentered, wrapText,
} = require('./pixelArt');

const BG    = [14, 12, 12, 255];
const WHITE = [255, 255, 255, 255];
const DIM   = [160, 168, 178, 255];
const RED   = [220, 60, 60, 255];
const GREEN = [46, 204, 113, 255];

function arcStroke(png, cx, cy, r, th, startDeg, endDeg, color) {
  const half = th / 2;
  const startRad = (startDeg * Math.PI) / 180, endRad = (endDeg * Math.PI) / 180;
  const steps = 480;
  for (let i = 0; i <= steps; i++) {
    const ang = startRad + (endRad - startRad) * (i / steps);
    for (let d = -half; d <= half; d++) {
      const rr = r + d;
      setPx(png, cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, color);
    }
  }
}

// A classic padlock — closed (shackle looped fully into the body) or open
// (shackle swung up on its right hinge, left leg lifted clear of the body).
function drawPadlock(png, cx, cy, size, color, locked) {
  const bodyW = size * 1.3, bodyH = size * 1.05;
  const bodyTop = cy + size * 0.15;
  const shackleR = size * 0.6, shackleTh = size * 0.22;

  if (locked) {
    const shackleCy = bodyTop - size * 0.02;
    arcStroke(png, cx, shackleCy, shackleR, shackleTh, 180, 360, color);
    line(png, cx - shackleR, shackleCy, cx - shackleR, bodyTop + 2, color, shackleTh);
    line(png, cx + shackleR, shackleCy, cx + shackleR, bodyTop + 2, color, shackleTh);
  } else {
    // Hinge pivot: the right leg's anchor at the body. The loop (arc + left
    // leg) is rotated ~50° up and to the left around that pivot.
    const pivotX = cx + shackleR, pivotY = bodyTop;
    line(png, pivotX, bodyTop - size * 0.5, pivotX, bodyTop + 2, color, shackleTh);
    const theta = (-50 * Math.PI) / 180;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const rotate = (x, y) => {
      const dx = x - pivotX, dy = y - (bodyTop - size * 0.5);
      return [pivotX + dx * cos - dy * sin, (bodyTop - size * 0.5) + dx * sin + dy * cos];
    };
    const arcCx = cx - shackleR, arcCy = bodyTop - size * 0.5;
    const [rArcCx, rArcCy] = rotate(arcCx, arcCy);
    // Approximate the rotated arc by stepping the original arc's points
    // through the same rotation (arcStroke only draws axis-aligned arcs).
    const half = shackleTh / 2;
    const steps = 240;
    for (let i = 0; i <= steps; i++) {
      const ang = Math.PI + (Math.PI * i) / steps; // 180deg -> 360deg sweep, centered at arcCx/arcCy
      const px = arcCx + Math.cos(ang) * shackleR, py = arcCy + Math.sin(ang) * shackleR;
      const [rx, ry] = rotate(px, py);
      for (let d = -half; d <= half; d++) {
        setPx(png, rx + d * 0.3, ry, color);
        setPx(png, rx, ry + d * 0.3, color);
      }
    }
    const legX = arcCx - shackleR, legY1 = arcCy, legY2 = arcCy + size * 0.02;
    const [lx1, ly1] = rotate(legX, legY1), [lx2, ly2] = rotate(legX, legY2);
    line(png, lx1, ly1, lx2, ly2, color, shackleTh);
  }

  const radius = size * 0.22;
  for (let y = 0; y < bodyH; y++) {
    for (let x = 0; x < bodyW; x++) {
      const rx = Math.min(radius, bodyW / 2), ry = Math.min(radius, bodyH / 2);
      let inside = true;
      if (x < rx && y < ry) inside = Math.hypot(rx - x, ry - y) <= rx;
      else if (x >= bodyW - rx && y < ry) inside = Math.hypot(x - (bodyW - rx), ry - y) <= rx;
      else if (x < rx && y >= bodyH - ry) inside = Math.hypot(rx - x, y - (bodyH - ry)) <= rx;
      else if (x >= bodyW - rx && y >= bodyH - ry) inside = Math.hypot(x - (bodyW - rx), y - (bodyH - ry)) <= rx;
      if (inside) setPx(png, cx - bodyW / 2 + x, bodyTop + y, color);
    }
  }

  dotBlend(png, cx, bodyTop + bodyH * 0.38, size * 0.1, BG, 1);
  for (let y = 0; y < size * 0.32; y++) {
    for (let x = -size * 0.05; x <= size * 0.05; x++) setPx(png, cx + x, bodyTop + bodyH * 0.38 + y, BG);
  }
}

/**
 * @param {object} opts
 * @param {boolean} opts.locked - true for /lock, false for /unlock
 * @param {string} opts.channelName - e.g. "general" (no leading #)
 * @param {string|null} [opts.reason] - omit/null to skip the reason line entirely
 * @returns {Buffer} PNG image data
 */
function generateLockToggleImage(opts) {
  const { locked, channelName, reason } = opts;
  const color = locked ? RED : GREEN;

  const W = 720;
  const iconCy = 150;
  const titleY = 260;
  const channelY = titleY + 4 * GLYPH_H + 20;
  let H = channelY + 2 * GLYPH_H + 50;

  const reasonScale = 2;
  const reasonLines = reason ? wrapText(reason.toUpperCase(), reasonScale, W - 200) : [];

  let reasonY = null;
  if (reasonLines.length) {
    reasonY = H - 10;
    H = reasonY + 18 + reasonLines.length * (GLYPH_H * reasonScale + 8) + 26;
  }

  const png = new PNG({ width: W, height: H, colorType: 6 });
  flatBg(png, BG);
  glassPanel(png, 16, 16, W - 32, H - 32, { radius: 26, tint: color, tintAlpha: 0.05, border: color, borderAlpha: 0.4 });

  ringStroke(png, W / 2, iconCy, 78, color, 3);
  dotBlend(png, W / 2, iconCy, 73, color, 0.13);
  drawPadlock(png, W / 2, iconCy, 46, color, locked);

  drawTextCentered(png, locked ? 'CHANNEL LOCKED' : 'CHANNEL UNLOCKED', W / 2, titleY, 4, WHITE);
  drawTextCentered(png, `#${channelName}`.toUpperCase(), W / 2, channelY, 2, DIM);

  if (reasonY !== null) {
    for (let x = 100; x < W - 100; x++) setPxBlend(png, x, reasonY, color, 0.3);
    reasonLines.forEach((line_, i) => {
      drawTextCentered(png, line_, W / 2, reasonY + 18 + i * (GLYPH_H * reasonScale + 8), reasonScale, [230, 220, 210, 255]);
    });
  }

  return PNG.sync.write(png);
}

module.exports = { generateLockToggleImage };
