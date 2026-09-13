'use strict';

/**
 * Loads Quantbot.jpg into a small RGBA buffer for pixel-art banners.
 * Async load; blit is sync once ready (warm() preloads at boot).
 */

const path = require('path');
const fs = require('fs');

const LOGO_CANDIDATES = [
  path.join(__dirname, '..', 'Quantbot.jpg'),
  path.join(__dirname, '..', 'web', 'public', 'Quantbot.jpg'),
];

let logo = null; // { w, h, data, fit }
let loading = null;

function findLogoPath() {
  for (const p of LOGO_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

async function loadQuantLogo(size = 64) {
  if (logo && logo.fit === size) return logo;
  if (loading) return loading;
  loading = (async () => {
    const file = findLogoPath();
    if (!file) {
      console.warn('[quantLogo] Quantbot.jpg not found');
      return null;
    }
    try {
      const { createCanvas, loadImage } = require('@napi-rs/canvas');
      const img = await loadImage(file);
      const c = createCanvas(size, size);
      const ctx = c.getContext('2d');
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2;
      const sy = (img.height - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      const id = ctx.getImageData(0, 0, size, size);
      logo = { w: size, h: size, data: id.data, fit: size };
      return logo;
    } catch (err) {
      console.warn('[quantLogo] load failed:', err.message);
      return null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function blitQuantLogo(png, dx, dy, box, { circle = true, alpha = 1 } = {}) {
  if (!logo) return false;
  const { setPxBlend } = require('./pixelArt');
  const r = box / 2;
  for (let y = 0; y < box; y++) {
    for (let x = 0; x < box; x++) {
      if (circle) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
        if (d > r - 0.5) continue;
      }
      const sx = Math.min(logo.w - 1, Math.floor((x / box) * logo.w));
      const sy = Math.min(logo.h - 1, Math.floor((y / box) * logo.h));
      const i = (sy * logo.w + sx) * 4;
      const a = (logo.data[i + 3] / 255) * alpha;
      if (a < 0.02) continue;
      setPxBlend(
        png,
        Math.round(dx + x),
        Math.round(dy + y),
        [logo.data[i], logo.data[i + 1], logo.data[i + 2], 255],
        a,
      );
    }
  }
  return true;
}

function hasQuantLogo() {
  return !!logo;
}

module.exports = { loadQuantLogo, blitQuantLogo, hasQuantLogo };
