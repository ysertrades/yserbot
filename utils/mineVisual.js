'use strict';

const {
  PNG, setPxBlend, roundedMask, dot, dotBlend, ringStroke, line,
  fillRoundedRectBlend, drawText, drawTextCentered,
} = require('./pixelArt');

const RARITY_COLOR = {
  junk:      [148, 155, 168, 255],
  common:    [180, 140, 100, 255],
  uncommon:  [52, 152, 219, 255],
  rare:      [46, 204, 113, 255],
  legendary: [185, 90, 230, 255],
};

function darken(c, f = 0.65) {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f), 255];
}

// A handful of finds have a real-world color identity that would look wrong
// tinted by their rarity tier (a sapphire rendered in "rare" green reads as
// a mistake, not a stylization) — the outer ring/rarity label still use the
// tier color so rarity stays readable at a glance, but the icon itself uses
// its natural color when one is defined here.
const NAME_COLOR = {
  'Gold Nugget':   [255, 205, 60, 255],
  'Silver Vein':   [205, 210, 218, 255],
  'Emerald':       [46, 204, 113, 255],
  'Diamond':       [214, 234, 248, 255],
  'Sapphire':      [52, 120, 219, 255],
  'Ruby':          [231, 60, 90, 255],
  'Amethyst':      [155, 89, 182, 255],
  'Obsidian Shard': [80, 68, 100, 255],
  'Opal':          [225, 220, 232, 255],
  'Topaz':         [255, 170, 60, 255],
  'Platinum Bar':  [225, 228, 232, 255],
  'Fossilized Bone': [232, 222, 196, 255],
};

/* ─── Per-item icons — every find gets its own silhouette, not just a
       recolored generic gem ────────────────────────────────────────────── */

// Shared gem drawer — a rhombus "cut" by default, with an optional squarer
// "emerald cut" outline, so related gems (emerald/sapphire/ruby/diamond)
// read as different stones via silhouette, not just color.
function drawGemIcon(png, cx, cy, size, color, opts = {}) {
  const { squareCut = false } = opts;
  const rx = size, ry = size * 1.1;

  if (squareCut) {
    fillRoundedRectBlend(png, cx - rx * 0.75, cy - ry * 0.8, rx * 1.5, ry * 1.6, 6, color, 1);
    const facet = darken(color, 0.55);
    line(png, cx - rx * 0.75, cy - ry * 0.3, cx + rx * 0.75, cy - ry * 0.3, facet, 2);
    line(png, cx - rx * 0.75, cy + ry * 0.3, cx + rx * 0.75, cy + ry * 0.3, facet, 2);
  } else {
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if (Math.abs(dx) / rx + Math.abs(dy) / ry <= 1) setPxBlend(png, cx + dx, cy + dy, color, 1);
      }
    }
    const facet = darken(color, 0.55);
    line(png, cx, cy - ry, cx - rx * 0.5, cy, facet, 2);
    line(png, cx, cy - ry, cx + rx * 0.5, cy, facet, 2);
    line(png, cx - rx * 0.5, cy, cx, cy + ry, facet, 2);
    line(png, cx + rx * 0.5, cy, cx, cy + ry, facet, 2);
  }

  const sx = cx - rx * 0.35, sy = cy - ry * 0.4;
  line(png, sx - 10, sy, sx + 10, sy, [255, 255, 255, 255], 2);
  line(png, sx, sy - 10, sx, sy + 10, [255, 255, 255, 255], 2);
}

// Shared lumpy-rock drawer for ore/pebble/coal — an angle-perturbed circle
// (not a plain dot) so related rocks read as different materials via how
// jagged/round they are, not just color.
function drawRockIcon(png, cx, cy, size, color, opts = {}) {
  const { flecks = null, crack = false, smooth = false } = opts;
  const bumps = smooth ? 5 : 7;
  const jag   = smooth ? 0.08 : 0.22;
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      const wobble = 1 + Math.sin(ang * bumps) * jag;
      if (r <= size * 0.8 * wobble) setPxBlend(png, cx + dx, cy + dy, color, 1);
    }
  }
  if (crack) {
    const dark = darken(color, 0.5);
    line(png, cx - size * 0.5, cy - size * 0.3, cx - size * 0.1, cy + size * 0.1, dark, 2);
    line(png, cx - size * 0.1, cy + size * 0.1, cx + size * 0.4, cy - size * 0.2, dark, 2);
  }
  if (flecks) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const r = size * 0.4;
      dot(png, cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(2, size * 0.09), flecks);
    }
  }
}

function drawNuggetIcon(png, cx, cy, size, color) {
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      if (Math.hypot(dx, dy) <= size * (0.7 + 0.15 * Math.sin(Math.atan2(dy, dx) * 3))) setPxBlend(png, cx + dx, cy + dy, color, 1);
    }
  }
  dotBlend(png, cx - size * 0.2, cy - size * 0.25, size * 0.18, [255, 255, 255, 255], 0.35);
}

function drawVeinIcon(png, cx, cy, size, color) {
  dotBlend(png, cx, cy, size * 0.9, darken(color, 0.35), 1);
  for (let i = -1; i <= 1; i++) {
    let px = cx - size * 0.9, py = cy + i * size * 0.3;
    for (let t = 0; t <= 8; t++) {
      const x = cx - size * 0.9 + (t / 8) * size * 1.8;
      const y = cy + i * size * 0.3 + Math.sin(t * 0.9 + i) * size * 0.18;
      line(png, px, py, x, y, color, 4);
      px = x; py = y;
    }
  }
}

function drawCrystalClusterIcon(png, cx, cy, size, color) {
  const spikes = [[-0.5, 1], [-0.15, 1.3], [0.2, 1.1], [0.55, 1.35], [0, 0.6]];
  const baseY = cy + size * 0.5;
  for (const [fx, fh] of spikes) {
    const bx = cx + fx * size, topY = baseY - fh * size;
    fillRoundedRectBlend(png, bx - size * 0.16, topY, size * 0.32, fh * size, 3, color, 1);
    line(png, bx - size * 0.16, topY, bx, topY - size * 0.15, color, 3);
    line(png, bx + size * 0.16, topY, bx, topY - size * 0.15, color, 3);
    setPxBlend(png, bx - size * 0.05, topY + 6, [255, 255, 255, 255], 0.3);
  }
}

function drawNailIcon(png, cx, cy, size, color) {
  line(png, cx - size * 0.3, cy - size * 0.7, cx + size * 0.5, cy + size * 0.9, color, 5);
  fillRoundedRectBlend(png, cx - size * 0.55, cy - size * 0.95, size * 0.55, size * 0.3, 4, color, 1);
}

function drawPickaxeHeadIcon(png, cx, cy, size, color) {
  line(png, cx - size * 0.9, cy - size * 0.4, cx + size * 0.2, cy + size * 0.5, color, 8);
  line(png, cx + size * 0.2, cy + size * 0.5, cx + size * 0.9, cy - size * 0.2, [15, 20, 30, 200], 2);
  fillRoundedRectBlend(png, cx - size * 0.15, cy - size * 0.15, size * 0.3, size * 0.9, 4, darken(color), 1);
}

function drawKeyIcon(png, cx, cy, size, color) {
  ringStroke(png, cx - size * 0.6, cy - size * 0.5, size * 0.35, color, 4);
  line(png, cx - size * 0.35, cy - size * 0.25, cx + size * 0.7, cy + size * 0.75, color, 5);
  line(png, cx + size * 0.5, cy + size * 0.55, cx + size * 0.75, cy + size * 0.3, color, 4);
  line(png, cx + size * 0.35, cy + size * 0.4, cx + size * 0.55, cy + size * 0.2, color, 4);
}

function drawRelicIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.55, cy - size * 0.85, size * 1.1, size * 1.7, 6, color, 1);
  const dark = darken(color, 0.5);
  ringStroke(png, cx, cy - size * 0.15, size * 0.32, dark, 3);
  line(png, cx, cy - size * 0.15, cx, cy - size * 0.55, dark, 2);
  line(png, cx - size * 0.3, cy + size * 0.35, cx + size * 0.3, cy + size * 0.35, dark, 2);
  line(png, cx - size * 0.3, cy + size * 0.55, cx + size * 0.3, cy + size * 0.55, dark, 2);
}

function drawMeteoriteIcon(png, cx, cy, size, color) {
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      if (Math.hypot(dx, dy) <= size * 0.85) setPxBlend(png, cx + dx, cy + dy, [40, 34, 30, 255], 1);
    }
  }
  // Glowing cracks — the legendary detail.
  line(png, cx - size * 0.4, cy - size * 0.2, cx, cy, color, 3);
  line(png, cx, cy, cx + size * 0.35, cy - size * 0.35, color, 3);
  line(png, cx, cy, cx - size * 0.1, cy + size * 0.45, color, 3);
  for (let a = 0; a < 360; a += 45) {
    const rad = (a * Math.PI) / 180;
    setPxBlend(png, cx + Math.cos(rad) * size * 0.95, cy + Math.sin(rad) * size * 0.95, color, 0.4);
  }
}

function drawChainIcon(png, cx, cy, size, color) {
  const links = [[-0.5, -0.3], [0, 0], [0.5, 0.3]];
  for (const [fx, fy] of links) ringStroke(png, cx + fx * size, cy + fy * size, size * 0.35, color, 5);
}

function drawVialIcon(png, cx, cy, size, color) {
  const dark = darken(color, 0.6);
  fillRoundedRectBlend(png, cx - size * 0.25, cy - size * 0.95, size * 0.5, size * 0.3, 3, dark, 1);
  fillRoundedRectBlend(png, cx - size * 0.35, cy - size * 0.65, size * 0.7, size * 1.5, 10, color, 0.75);
  line(png, cx - size * 0.2, cy - size * 0.1, cx + size * 0.05, cy + size * 0.2, [15, 20, 30, 220], 2);
  line(png, cx + size * 0.05, cy + size * 0.2, cx - size * 0.1, cy + size * 0.5, [15, 20, 30, 220], 2);
}

function drawGraniteIcon(png, cx, cy, size, color) {
  drawRockIcon(png, cx, cy, size, color);
  const dark = darken(color, 0.55);
  for (let i = -1; i <= 1; i++) line(png, cx - size * 0.55, cy + i * size * 0.28, cx + size * 0.55, cy + i * size * 0.28 + 6, dark, 2);
}

function drawObsidianIcon(png, cx, cy, size, color) {
  const rx = size * 0.5, ry = size * 1.25;
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      if (Math.abs(dx) / rx + Math.abs(dy) / ry <= 1) setPxBlend(png, cx + dx, cy + dy, color, 1);
    }
  }
  line(png, cx - size * 0.15, cy - size * 0.85, cx - size * 0.15, cy + size * 0.5, [255, 255, 255, 255], 2);
}

function drawOpalIcon(png, cx, cy, size, color) {
  drawGemIcon(png, cx, cy, size, color);
  const hues = [[255, 130, 190, 255], [130, 210, 255, 255], [190, 255, 160, 255]];
  hues.forEach(([r, g, b], i) => dot(png, cx + (i - 1) * size * 0.28, cy - size * 0.15 + (i % 2) * size * 0.3, size * 0.09, [r, g, b, 255]));
}

function drawIngotIcon(png, cx, cy, size, color) {
  fillRoundedRectBlend(png, cx - size * 0.9, cy - size * 0.35, size * 1.8, size * 0.7, 6, color, 1);
  const dark = darken(color, 0.6);
  line(png, cx - size * 0.9, cy - size * 0.1, cx + size * 0.9, cy - size * 0.1, dark, 2);
  for (let x = -size * 0.85; x < size * 0.85; x++) setPxBlend(png, cx + x, cy - size * 0.3, [255, 255, 255, 255], 0.4);
}

function drawBoneIcon(png, cx, cy, size, color) {
  line(png, cx - size * 0.6, cy, cx + size * 0.6, cy, color, 8);
  for (const [fx, fy] of [[-0.65, -0.2], [-0.65, 0.2], [0.65, -0.2], [0.65, 0.2]]) dot(png, cx + fx * size, cy + fy * size, size * 0.22, color);
}

const ICONS = {
  'Loose Pebble':            (p, x, y, s, c) => drawRockIcon(p, x, y, s * 0.7, c),
  'Chunk of Coal':           (p, x, y, s, c) => drawRockIcon(p, x, y, s, c, { smooth: true }),
  'Cracked Rock':            (p, x, y, s, c) => drawRockIcon(p, x, y, s, c, { crack: true }),
  'Bent Nail':               drawNailIcon,
  'Broken Pickaxe Head':     drawPickaxeHeadIcon,
  'Iron Ore':                (p, x, y, s, c) => drawRockIcon(p, x, y, s, c, { flecks: [210, 214, 220, 255] }),
  'Copper Ore':              (p, x, y, s, c) => drawRockIcon(p, x, y, s, c, { flecks: [230, 145, 70, 255] }),
  'Tin Ore':                 (p, x, y, s, c) => drawRockIcon(p, x, y, s, c, { flecks: [200, 200, 210, 255] }),
  'Silver Vein':             drawVeinIcon,
  'Gold Nugget':             drawNuggetIcon,
  'Quartz Crystal':          drawCrystalClusterIcon,
  'Amethyst':                (p, x, y, s, c) => drawGemIcon(p, x, y, s, c),
  'Emerald':                 (p, x, y, s, c) => drawGemIcon(p, x, y, s, c, { squareCut: true }),
  'Diamond':                 (p, x, y, s, c) => drawGemIcon(p, x, y, s, c),
  'Sapphire':                (p, x, y, s, c) => drawGemIcon(p, x, y, s, c, { squareCut: true }),
  'Ruby':                    (p, x, y, s, c) => drawGemIcon(p, x, y, s, c),
  'Ancient Relic':           drawRelicIcon,
  "Buried Skeleton Key":     drawKeyIcon,
  'Meteorite Fragment':      drawMeteoriteIcon,
  'Rusty Chain':             drawChainIcon,
  'Cracked Vial':            drawVialIcon,
  'Granite Chunk':           drawGraniteIcon,
  'Obsidian Shard':          drawObsidianIcon,
  'Opal':                    drawOpalIcon,
  'Topaz':                   (p, x, y, s, c) => drawGemIcon(p, x, y, s, c, { squareCut: true }),
  'Platinum Bar':            drawIngotIcon,
  'Fossilized Bone':         drawBoneIcon,
};

function drawDefaultGemIcon(png, cx, cy, size, color) {
  drawGemIcon(png, cx, cy, size, color);
}

function fmtCoins(n) {
  return `+${Number(n).toLocaleString('en-US')} COINS`;
}

/**
 * Renders the /mine result as a tall PNG matching the fishing/blackjack
 * visual scale — the find, its rarity, and the reward are drawn into the
 * image itself; the embed around it stays to a title. Every find name gets
 * its own hand-drawn icon (see ICONS above) instead of one generic gem
 * shape recolored by rarity.
 * @param {{name: string, rarity: string, reward: number}} findData
 * @returns {Buffer} PNG image data
 */
function generateMineImage(findData) {
  const { name, rarity, reward } = findData;
  const color = RARITY_COLOR[rarity] || RARITY_COLOR.common;
  const iconColor = NAME_COLOR[name] || color;
  const drawIcon = ICONS[name] || drawDefaultGemIcon;

  const W = 640, H = 620;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const panelRadius = 22;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!roundedMask(W, H, panelRadius, x, y)) continue;
      const band = Math.floor((y / H) * 8);
      const shade = 14 - band;
      setPxBlend(png, x, y, [shade + 10, shade + 8, shade + 8, 255], 1);
    }
  }

  // Rock-strata texture — jagged translucent horizontal bands, not a gradient.
  for (let s = 0; s < 6; s++) {
    const sy = 80 + s * 90;
    for (let x = 15; x < W - 15; x++) {
      const yy = sy + Math.sin((x + s * 55) * 0.045) * 8 + (Math.floor(x / 23) % 2) * 3;
      setPxBlend(png, x, Math.round(yy), [255, 255, 255, 255], 0.04);
    }
  }

  drawText(png, 'MINING', 30, 26, 2, [190, 180, 170, 255]);

  const cx = W / 2, cy = 250;
  ringStroke(png, cx, cy, 130, color, 4);
  dotBlend(png, cx, cy, 118, color, 0.14);
  drawIcon(png, cx, cy, 62, iconColor);

  const rarityLabel = rarity.toUpperCase();
  drawTextCentered(png, rarityLabel, cx, cy + 160, 2, color);

  const nameScale = 4;
  drawTextCentered(png, name.toUpperCase(), cx, cy + 195, nameScale, [255, 255, 255, 255]);

  drawTextCentered(png, fmtCoins(reward), cx, cy + 195 + 7 * nameScale + 26, 3, [255, 215, 0, 255]);

  return PNG.sync.write(png);
}

module.exports = { generateMineImage, RARITY_COLOR };
