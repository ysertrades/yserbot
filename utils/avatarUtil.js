'use strict';

/**
 * avatarUtil.js
 *
 * Shared helpers for compositing a member's real Discord avatar into the
 * pixel-art visuals — fetching it as a static PNG, and drawing it clipped
 * to a circle (with a graceful colored-initial fallback when it can't be
 * fetched/decoded, so a network hiccup never breaks a visual). Extracted
 * from welcomeVisual.js so bankVisual.js and any future per-member visual
 * can reuse the exact same avatar-circle rendering instead of duplicating it.
 */

const { PNG } = require('pngjs');
const { setPxBlend, drawTextCentered } = require('./pixelArt');

const WHITE = [255, 255, 255, 255];

// A network hiccup or a decode failure here should never break the caller —
// every drawAvatarCircle() call below already handles a null buffer with a
// graceful initial-letter fallback.
async function fetchAvatarPng(avatarUrl) {
  try {
    const res = await fetch(avatarUrl);
    if (!res.ok) return null;
    return PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

// Nearest-neighbor resize of a decoded avatar PNG into an RGBA buffer of
// size x size — the avatar toolkit here is pixel-art scale, so a crisp
// nearest-neighbor sample fits the house look better than a soft blur would.
function resizeSquareRGBA(png, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.min(png.height - 1, Math.floor((y / size) * png.height));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(png.width - 1, Math.floor((x / size) * png.width));
      const si = (png.width * sy + sx) * 4;
      const di = (size * y + x) * 4;
      out[di] = png.data[si]; out[di + 1] = png.data[si + 1]; out[di + 2] = png.data[si + 2]; out[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

// Draws a member's real avatar clipped to a circle, or — if it couldn't be
// fetched/decoded — a colored circle with their initial as a fallback.
function drawAvatarCircle(png, cx, cy, radius, avatarPng, initial, accent) {
  const r2 = radius * radius;
  const size = radius * 2;
  const buf = avatarPng ? resizeSquareRGBA(avatarPng, size) : null;

  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      if (xx * xx + yy * yy > r2) continue;
      const x = cx + xx, y = cy + yy;
      if (buf) {
        const sx = xx + radius, sy = yy + radius;
        const si = (size * sy + sx) * 4;
        const alpha = buf[si + 3] / 255;
        setPxBlend(png, x, y, [buf[si], buf[si + 1], buf[si + 2], 255], alpha || 1);
      } else {
        setPxBlend(png, x, y, accent, 0.22);
      }
    }
  }

  if (!buf) drawTextCentered(png, initial, cx, cy - 21, 6, WHITE);
}

module.exports = { fetchAvatarPng, drawAvatarCircle };
