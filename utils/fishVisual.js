'use strict';

const {
  PNG, setPxBlend, roundedMask, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered,
} = require('./pixelArt');
const { drawChestIcon } = require('./mysteryBoxVisual');

const RARITY_COLOR = {
  junk:      [148, 155, 168, 255],
  common:    [46, 204, 113, 255],
  uncommon:  [52, 152, 219, 255],
  rare:      [155, 89, 182, 255],
  legendary: [241, 196, 15, 255],
};

function darken(c, f = 0.65) {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f), 255];
}

/* ─── Per-item icons — every catch gets its own silhouette, not just a
       recolored generic fish ────────────────────────────────────────────── */

// Shared fish-body drawer, parameterized so related catches (minnow, bass,
// catfish, trout, salmon, marlin) read as genuinely different fish instead
// of the same shape recolored — proportions and one signature detail vary.
function drawFishBody(png, cx, cy, size, color, opts = {}) {
  const { sleek = false, spotted = false, whiskers = false, spearNose = false, puffed = false } = opts;
  const rx = size * (sleek ? 1.25 : puffed ? 0.85 : 1);
  const ry = size * (sleek ? 0.42 : puffed ? 0.95 : 0.55);

  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx * 0.7; dx++) {
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) setPxBlend(png, cx + dx, cy + dy, color, 1);
    }
  }

  if (puffed) {
    // Pufferfish spikes — short strokes radiating off the round body.
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;
      const sx = cx + Math.cos(rad) * rx * 0.95, sy = cy + Math.sin(rad) * ry * 0.95;
      const ex = cx + Math.cos(rad) * rx * 1.3, ey = cy + Math.sin(rad) * ry * 1.3;
      line(png, sx, sy, ex, ey, color, 2);
    }
  } else {
    const tailBaseX = cx - rx * 0.75;
    const tailTipX = cx - rx * (sleek ? 1.7 : 1.5);
    line(png, tailBaseX, cy - ry * 0.5, tailTipX, cy - ry * 1.3, color, 6);
    line(png, tailBaseX, cy + ry * 0.5, tailTipX, cy + ry * 1.3, color, 6);
    line(png, cx - rx * 0.1, cy - ry * 0.85, cx + rx * 0.1, cy - ry * 1.7, color, 5);
  }

  if (spearNose) line(png, cx + rx * 0.65, cy, cx + rx * 1.35, cy, color, 4);

  if (spotted) {
    const dark = darken(color, 0.6);
    const spots = [[-0.3, -0.15], [0.05, 0.2], [-0.55, 0.15], [0.3, -0.1]];
    for (const [fx, fy] of spots) dot(png, cx + fx * rx, cy + fy * ry, Math.max(2, size * 0.06), dark);
  }

  if (whiskers) {
    const mx = cx + rx * (puffed ? 0.75 : 0.65), my = cy + ry * 0.3;
    line(png, mx, my, mx + size * 0.4, my + size * 0.18, color, 2);
    line(png, mx, my, mx + size * 0.4, my - size * 0.05, color, 2);
  }

  if (!puffed) {
    const eyeX = cx + rx * 0.35, eyeY = cy - ry * 0.15, eyeR = Math.max(2, size * 0.09);
    dot(png, eyeX, eyeY, eyeR, [15, 20, 30, 255]);
    dot(png, eyeX + eyeR * 0.3, eyeY - eyeR * 0.3, Math.max(1, eyeR * 0.35), [255, 255, 255, 255]);
  } else {
    dot(png, cx + rx * 0.3, cy - ry * 0.1, Math.max(2, size * 0.08), [15, 20, 30, 255]);
  }
}

function drawSharkIcon(png, cx, cy, size, color) {
  const rx = size * 1.35, ry = size * 0.5;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx * 0.75; dx++) {
      const t = (dx + rx) / (rx * 1.75);
      const taper = 1 - Math.max(0, t - 0.6) * 1.3;
      if ((dx * dx) / (rx * rx) + (dy * dy) / ((ry * Math.max(0.3, taper)) ** 2) <= 1) setPxBlend(png, cx + dx, cy + dy, color, 1);
    }
  }
  // Tall triangular dorsal fin — the shark's signature silhouette.
  line(png, cx - size * 0.1, cy - ry * 0.9, cx - size * 0.1, cy - ry * 2.3, color, 5);
  line(png, cx - size * 0.1, cy - ry * 2.3, cx + size * 0.35, cy - ry * 0.95, color, 5);
  // Crescent tail
  line(png, cx - rx * 0.85, cy, cx - rx * 1.35, cy - ry * 1.6, color, 6);
  line(png, cx - rx * 0.85, cy, cx - rx * 1.35, cy + ry * 1.6, color, 6);
  dot(png, cx + rx * 0.55, cy - ry * 0.1, Math.max(2, size * 0.08), [15, 20, 30, 255]);
  // Jagged mouth line
  line(png, cx + rx * 0.15, cy + ry * 0.35, cx + rx * 0.6, cy + ry * 0.25, [15, 20, 30, 255], 2);
}

function drawJellyfishIcon(png, cx, cy, size, color) {
  dotBlend(png, cx, cy - size * 0.2, size * 0.75, color, 1);
  for (let x = -size * 0.6; x <= size * 0.6; x += size * 0.28) {
    const wobble = Math.sin(x) * 6;
    line(png, cx + x, cy + size * 0.3, cx + x + wobble, cy + size * 1.3, color, 3);
  }
  for (let x = -size * 0.5; x < size * 0.5; x++) setPxBlend(png, cx + x, cy - size * 0.2, [255, 255, 255, 255], 0.15);
}

function drawTurtleIcon(png, cx, cy, size, color) {
  dotBlend(png, cx, cy, size * 0.85, color, 1);
  const dark = darken(color, 0.6);
  ringStroke(png, cx, cy, size * 0.5, dark, 2);
  ringStroke(png, cx - size * 0.35, cy - size * 0.15, size * 0.22, dark, 2);
  ringStroke(png, cx + size * 0.35, cy - size * 0.15, size * 0.22, dark, 2);
  ringStroke(png, cx, cy + size * 0.4, size * 0.22, dark, 2);
  dot(png, cx + size * 0.75, cy - size * 0.55, size * 0.22, color);
  dot(png, cx + size * 0.9, cy - size * 0.62, Math.max(2, size * 0.06), [15, 20, 30, 255]);
}

function drawEelIcon(png, cx, cy, size, color) {
  let px = cx - size * 1.3, py = cy;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = cx - size * 1.3 + t * size * 2.4;
    const y = cy + Math.sin(t * Math.PI * 2.4) * size * 0.55;
    line(png, px, py, x, y, color, 6);
    px = x; py = y;
  }
  dot(png, px + size * 0.15, py, Math.max(2, size * 0.1), [15, 20, 30, 255]);
  // Little lightning-bolt spark to signal "electric"
  const sx = cx, sy = cy - size * 1.1;
  line(png, sx - 6, sy, sx + 4, sy + 10, [255, 240, 120, 255], 3);
  line(png, sx + 4, sy + 10, sx - 4, sy + 10, [255, 240, 120, 255], 3);
  line(png, sx - 4, sy + 10, sx + 6, sy + 20, [255, 240, 120, 255], 3);
}

function drawSquidIcon(png, cx, cy, size, color) {
  dotBlend(png, cx, cy - size * 0.3, size * 0.6, color, 1);
  for (let i = 0; i < 6; i++) {
    const baseX = cx - size * 0.5 + i * size * 0.2;
    const sway = (i % 2 === 0 ? 1 : -1) * size * 0.18;
    line(png, baseX, cy + size * 0.15, baseX + sway, cy + size * 1.3, color, 4);
  }
  dot(png, cx - size * 0.2, cy - size * 0.35, Math.max(2, size * 0.09), [15, 20, 30, 255]);
  dot(png, cx + size * 0.2, cy - size * 0.35, Math.max(2, size * 0.09), [15, 20, 30, 255]);
}

function drawCrawfishIcon(png, cx, cy, size, color) {
  dotBlend(png, cx, cy, size * 0.55, color, 1);
  line(png, cx - size * 0.4, cy - size * 0.2, cx - size * 0.9, cy - size * 0.55, color, 5);
  line(png, cx - size * 0.9, cy - size * 0.55, cx - size * 1.15, cy - size * 0.3, color, 4);
  line(png, cx - size * 0.9, cy - size * 0.55, cx - size * 1.15, cy - size * 0.75, color, 4);
  line(png, cx - size * 0.4, cy + size * 0.2, cx - size * 0.9, cy + size * 0.55, color, 5);
  line(png, cx - size * 0.9, cy + size * 0.55, cx - size * 1.15, cy + size * 0.3, color, 4);
  line(png, cx - size * 0.9, cy + size * 0.55, cx - size * 1.15, cy + size * 0.75, color, 4);
  for (let i = 0; i < 4; i++) {
    const tx = cx + size * 0.3 + i * size * 0.22;
    line(png, tx, cy - size * 0.35, tx - size * 0.1, cy + size * 0.35, color, 4);
  }
}

function drawKrakenEyeIcon(png, cx, cy, size, color) {
  for (let a = 0; a < 360; a += 15) {
    const rad = (a * Math.PI) / 180;
    const spiral = size * 0.9 + (a / 360) * size * 0.4;
    setPxBlend(png, cx + Math.cos(rad) * spiral, cy + Math.sin(rad) * spiral, color, 0.35);
  }
  ringStroke(png, cx, cy, size * 0.85, color, 4);
  dotBlend(png, cx, cy, size * 0.7, [10, 10, 16, 255], 1);
  dot(png, cx, cy, size * 0.4, color);
  dot(png, cx, cy, size * 0.16, [10, 10, 16, 255]);
}

function drawBootIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.35, cy - size * 0.9, size * 0.7, size * 1.3, 6, color, 1);
  fillRoundedRectBlend(png, cx - size * 0.35, cy + size * 0.15, size * 1.15, size * 0.4, 8, color, 1);
  const dark = darken(color);
  fillRoundedRectBlend(png, cx - size * 0.35, cy + size * 0.42, size * 1.15, size * 0.14, 4, dark, 1);
  line(png, cx - size * 0.1, cy - size * 0.75, cx - size * 0.1, cy - size * 0.1, dark, 2);
}

function drawCanIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.55, cy - size, size * 1.1, size * 2, 8, color, 1);
  const dark = darken(color);
  for (let y = -size * 0.8; y < size * 0.8; y += size * 0.35) setPxBlend(png, cx - size * 0.2, cy + y, dark, 0.4);
  ringStroke(png, cx, cy - size * 0.95, size * 0.55, dark, 3);
  line(png, cx - size * 0.5, cy - size * 0.55, cx + size * 0.5, cy - size * 0.4, dark, 2);
}

function drawSeaweedIcon(png, cx, cy, size, color) {
  for (let i = -2; i <= 2; i++) {
    let px = cx + i * size * 0.35, py = cy + size;
    for (let t = 0; t <= 10; t++) {
      const y = cy + size - t * size * 0.2;
      const x = cx + i * size * 0.35 + Math.sin(t * 0.8 + i) * size * 0.25;
      line(png, px, py, x, y, color, 4);
      px = x; py = y;
    }
  }
}

function drawBottleIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.25, cy - size * 1.1, size * 0.5, size * 0.4, 4, color, 1);
  fillRoundedRectBlend(png, cx - size * 0.45, cy - size * 0.75, size * 0.9, size * 1.7, 10, color, 1);
  // Jagged crack line across the middle — signals "broken".
  line(png, cx - size * 0.35, cy - size * 0.1, cx - size * 0.05, cy + size * 0.15, [15, 20, 30, 220], 2);
  line(png, cx - size * 0.05, cy + size * 0.15, cx + size * 0.2, cy - size * 0.05, [15, 20, 30, 220], 2);
  line(png, cx + size * 0.2, cy - size * 0.05, cx + size * 0.4, cy + size * 0.3, [15, 20, 30, 220], 2);
}

function drawBagIcon(png, cx, cy, size, color) {
  for (let dy = -size; dy <= size; dy++) {
    const t = (dy + size) / (2 * size);
    const w = size * (0.55 + Math.sin(t * 3.4) * 0.12);
    for (let dx = -w; dx <= w; dx++) setPxBlend(png, cx + dx, cy + dy, color, 0.85);
  }
  line(png, cx - size * 0.25, cy - size * 1.05, cx - size * 0.1, cy - size * 0.75, darken(color), 3);
  line(png, cx + size * 0.25, cy - size * 1.05, cx + size * 0.1, cy - size * 0.75, darken(color), 3);
}

function drawNewspaperIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.7, cy - size * 0.55, size * 1.4, size * 1.1, 4, color, 1);
  const dark = darken(color, 0.55);
  for (let i = 0; i < 4; i++) {
    const ly = cy - size * 0.3 + i * size * 0.22;
    line(png, cx - size * 0.5, ly, cx + size * 0.5 - (i % 2) * size * 0.2, ly, dark, 2);
  }
}

function drawChestFish(png, cx, cy, size, color) {
  drawChestIcon(png, cx, cy + size * 0.1, size * 0.85, color);
}

const ICONS = {
  'Old Boot':              drawBootIcon,
  'Rusty Can':              drawCanIcon,
  'Tangled Seaweed':        drawSeaweedIcon,
  'Broken Bottle':          drawBottleIcon,
  'Plastic Bag':            drawBagIcon,
  'Soggy Newspaper':        drawNewspaperIcon,
  'Minnow':                 (p, x, y, s, c) => drawFishBody(p, x, y, s * 0.6, c),
  'Bluegill Bass':          (p, x, y, s, c) => drawFishBody(p, x, y, s, c),
  'Catfish':                (p, x, y, s, c) => drawFishBody(p, x, y, s, c, { whiskers: true }),
  'Jellyfish':              drawJellyfishIcon,
  'Crawfish':               drawCrawfishIcon,
  'Rainbow Trout':          (p, x, y, s, c) => drawFishBody(p, x, y, s, c, { spotted: true }),
  'Silver Salmon':          (p, x, y, s, c) => drawFishBody(p, x, y, s, c, { sleek: true }),
  'Pufferfish':             (p, x, y, s, c) => drawFishBody(p, x, y, s, c, { puffed: true }),
  'Sea Turtle':             drawTurtleIcon,
  'Golden Marlin':          (p, x, y, s, c) => drawFishBody(p, x, y, s, c, { sleek: true, spearNose: true }),
  'Great White Shark':      drawSharkIcon,
  'Electric Eel':           drawEelIcon,
  'Giant Squid':            drawSquidIcon,
  'Ancient Treasure Chest': drawChestFish,
  "Kraken's Eye":           drawKrakenEyeIcon,
};

function drawFishIcon(png, cx, cy, size, color) {
  drawFishBody(png, cx, cy, size, color);
}

function fmtCoins(n) {
  return `+${Number(n).toLocaleString('en-US')} COINS`;
}

/**
 * Renders the /fish result as a tall PNG (matching the blackjack card
 * visual's scale/proportions) — the catch, its rarity, and the reward are
 * all drawn into the image itself; the embed around it stays to a title.
 * Every catch name gets its own hand-drawn icon (see ICONS above) instead
 * of one generic fish shape recolored by rarity.
 * @param {{name: string, rarity: string, reward: number}} catchData
 * @returns {Buffer} PNG image data
 */
function generateFishImage(catchData) {
  const { name, rarity, reward } = catchData;
  const color = RARITY_COLOR[rarity] || RARITY_COLOR.common;
  const drawIcon = ICONS[name] || drawFishIcon;

  const W = 640, H = 620;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const panelRadius = 22;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!roundedMask(W, H, panelRadius, x, y)) continue;
      const depth = y / H; // subtle vertical shift, deeper = darker — still flat bands, no smooth gradient
      const band = Math.floor(depth * 6);
      const shade = 22 - band * 2;
      setPxBlend(png, x, y, [8, shade + 20, shade + 38, 255], 1);
    }
  }

  // Wave texture — layered translucent horizontal bands, not a gradient.
  for (let w = 0; w < 5; w++) {
    const wy = 90 + w * 95 + Math.sin(w) * 10;
    for (let x = 20; x < W - 20; x++) {
      const yy = wy + Math.sin((x + w * 40) * 0.03) * 6;
      setPxBlend(png, x, Math.round(yy), [255, 255, 255, 255], 0.05);
    }
  }

  drawText(png, 'FISHING', 30, 26, 2, [190, 210, 230, 255]);

  const cx = W / 2, cy = 250;
  ringStroke(png, cx, cy, 130, color, 4);
  dotBlend(png, cx, cy, 118, color, 0.14);
  drawIcon(png, cx, cy, 70, color);

  const rarityLabel = rarity.toUpperCase();
  drawTextCentered(png, rarityLabel, cx, cy + 160, 2, color);

  const nameScale = 4;
  drawTextCentered(png, name.toUpperCase(), cx, cy + 195, nameScale, [255, 255, 255, 255]);

  drawTextCentered(png, fmtCoins(reward), cx, cy + 195 + 7 * nameScale + 26, 3, [255, 215, 0, 255]);

  return PNG.sync.write(png);
}

module.exports = { generateFishImage, RARITY_COLOR };
