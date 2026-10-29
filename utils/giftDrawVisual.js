'use strict';

/**
 * giftDrawVisual.js — the "drawing winners" GIF, shown in the giveaway card
 * between the timer running out and the winners being revealed.
 *
 * The giveaway banner's own open gift (prizeGiveawayVisual.openGift) on the
 * banner's dark card and dot grid, animated as a raffle draw in a seamless 3 s
 * loop that starts and ends on the banner's still:
 *   - three entry tickets take turns rising out of the box and sinking back,
 *     the drop's own ticket first, so the box looks like it is being shuffled
 *   - the lid floats up and settles twice a loop, rocking a little
 *   - the sparkles twinkle
 */

const { buildPalette, GifWriter } = require('./gifEncoder');
const { openGift, registerFonts, TK } = require('./prizeGiveawayVisual');

let Canvas = null;
try { Canvas = require('@napi-rs/canvas'); } catch { /* the drawing card shows text only without it */ }

const W = 640, H = 320, T = 3;
const TAU = Math.PI * 2;

/** 1 at the loop position `at` (0–1), easing to 0 a `width` of the loop either side */
function bump(u, at, width) {
  let d = Math.abs(u - at) % 1; d = Math.min(d, 1 - d);
  return d >= width ? 0 : Math.cos((d / width) * (Math.PI / 2)) ** 2;
}

function pose(t, dropId) {
  const u = t / T;
  const code = dropId ? `QL-${String(dropId).toUpperCase().slice(0, 8)}` : 'NO. 0001';
  const tickets = [
    { dx: 0, rot: 0, code, rise: bump(u, 0, 0.3) },
    { dx: -16, rot: 0.15, code: 'NO. 0412', rise: bump(u, 1 / 3, 0.3) },
    { dx: 16, rot: -0.05, code: 'NO. 1187', rise: bump(u, 2 / 3, 0.3) },
  ].sort((a, b) => a.rise - b.rise);   // the one furthest out is drawn in front
  return {
    tickets,
    lid: { dy: 12 * (1 - Math.cos(TAU * 2 * u)) / 2, rot: 0.05 * Math.sin(TAU * u) },
    twinkle: [0.6 + 0.4 * Math.cos(TAU * 3 * u), 0.6 + 0.4 * Math.cos(TAU * 2 * u), 0.6 + 0.4 * Math.cos(TAU * 3 * u + 0)],
  };
}

function draw(x, t, dropId) {
  x.fillStyle = TK.card; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,255,255,0.035)';
  for (let gy = 22; gy < H; gy += 22) for (let gx = 22; gx < W; gx += 22) { x.beginPath(); x.arc(gx, gy, 1.3, 0, TAU); x.fill(); }
  openGift(x, W / 2, 170, dropId, pose(t, dropId));
}

/**
 * @param {{dropId?:string, scale?:number, fps?:number}} [opts]  scale 1.25 → 800 × 400
 * @returns {Buffer|null} GIF
 */
function renderGiftDrawGif({ dropId = null, scale = 1.25, fps = 25 } = {}) {
  if (!Canvas) return null;
  registerFonts();
  const w = Math.round(W * scale), h = Math.round(H * scale), n = Math.round(T * fps);
  const cv = Canvas.createCanvas(w, h), x = cv.getContext('2d');
  const frame = (t) => { x.setTransform(scale, 0, 0, scale, 0, 0); draw(x, t, dropId); return x.getImageData(0, 0, w, h).data; };
  const palette = buildPalette([frame(0), frame(T / 6), frame(T / 2)], [TK.card, TK.ink, TK.paper, TK.accent, TK.deep, TK.soft, TK.ribbon]);
  const gif = new GifWriter(w, h, palette);
  for (let i = 0; i < n; i++) gif.addFrame(frame(i / fps), 1000 / fps);
  return gif.finish();
}

// The size the shipped GIF is rendered at: 640 × 320, 20 fps, about 190 KB, so it loads fast.
const DRAWING_GIF_OPTS = { scale: 1, fps: 20 };

let shipped = null;
/**
 * The drawing GIF for the giveaway card: the pre-rendered file in
 * assets/giveaway (scripts/render-drawing-gif.js), drawn here only if it is missing.
 * @returns {Buffer|null}
 */
function drawingGif() {
  if (shipped) return shipped;
  try { shipped = require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'giveaway', 'drawing.gif')); }
  catch { shipped = renderGiftDrawGif(DRAWING_GIF_OPTS); }
  return shipped;
}

module.exports = { renderGiftDrawGif, drawingGif, DRAWING_GIF_OPTS };
