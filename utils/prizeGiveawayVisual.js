'use strict';

/**
 * prizeGiveawayVisual.js
 *
 * The banner for a prize giveaway — the /giveaway kind, where what is being
 * given away is a thing rather than a pile of coins.
 *
 * The coins banner could not be reused for this: it is built around a
 * jackpot coin and casino chips, which says "currency" about a giveaway that
 * might be a funded account, a course seat or a piece of hardware. This one
 * leads with a gift box and leaves the prize itself as the largest words on
 * the card, so the same artwork carries any prize.
 *
 * QuantLab "Phantom" house style: dark neutral card, text inverted to the
 * brand's light Background hex, and the signature sky→periwinkle gradient
 * held to the two hero moments a giveaway actually has — the soft glow
 * behind the gift, and the rule under the heading. Confetti stays inside
 * the brand's own palette (purple, cyan, sky) rather than reaching for gold
 * or neon, so "celebratory" still reads as "calm, geometric, craft" rather
 * than hype.
 *
 * With @napi-rs/canvas (every host the bot runs on) the banner is the ticket
 * design at the bottom of this file, drawn crisp at 2×; the pixel-font
 * version below is only the fallback.
 *
 * Every line is editable in Studio. The defaults are written to make sense
 * unchanged, so a server that never opens Studio still gets a usable banner.
 */

const {
  PNG, setPxBlend, fillRect, dot, dotBlend, ringStroke,
  roundedMask, fillRoundedRectBlend, drawTextCentered, wrapText,
  fitScale, textWidth, drawText, GLYPH_H,
} = require('./pixelArt');
const { drawFlowLattice, drawFlowSignature, signatureWidth } = require('./brandSignature');
const { RGBA: LIGHT, RGBA_DARK: DARK, gradientColorAt, gradientRect, darkCard, fillCanvas } = require('./brandTheme');

const TEXT   = DARK.ink;     // body text — inverted onto the dark card
const SUBTLE = DARK.grey1;
const WHITE  = [255, 255, 255, 255];
const PURPLE = LIGHT.purple;
const PURPLE_L = LIGHT.purpleLight;
const PURPLE_D = LIGHT.purpleDeep;
const CYAN   = LIGHT.cyan;
const SKY    = LIGHT.sky;
// Soft rose/coral for empty-state headings — sits with purple brand, not neon red
const ROSE_A = [232, 96, 118, 255];
const ROSE_B = [196, 64, 96, 255];

/** Centered text with a left→right colour blend (per glyph). */
function drawCenteredGradientText(png, text, cx, y, scale, c0, c1) {
  const s = String(text || '');
  if (!s) return;
  const total = textWidth(s, scale);
  let x = Math.round(cx - total / 2);
  const n = Math.max(1, s.length - 1);
  for (let i = 0; i < s.length; i++) {
    const t = n === 0 ? 0 : i / n;
    const col = [
      Math.round(c0[0] + (c1[0] - c0[0]) * t),
      Math.round(c0[1] + (c1[1] - c0[1]) * t),
      Math.round(c0[2] + (c1[2] - c0[2]) * t),
      255,
    ];
    const ch = s[i];
    drawText(png, ch, x, y, scale, col);
    x += textWidth(ch, scale);
  }
}

// Passing nothing has to produce a finished card — the same rule the other
// two banners follow, so the no-arg render keeps its cache entry.
const PRIZE_DEFAULTS = {
  pill:     '', // empty = no corner pill (keeps layout clean)
  heading:  'GIVEAWAY DROP',
  subtitle: 'ONE WINNER TAKES IT',
  tagline:  'HIT ENTER BELOW TO CLAIM YOUR ENTRY. WINNER DRAWN WHEN THE TIMER RUNS OUT.',
};

/**
 * The pixel-font banner, kept for hosts without @napi-rs/canvas.
 * @param {object} [copy] pill / heading / subtitle / tagline overrides
 * @returns {Buffer} PNG image data
 */
function legacyPrizeBanner(copy = {}) {
  const { pill, heading, subtitle, tagline, dropId, noEntries } = { ...PRIZE_DEFAULTS, ...copy };
  const empty = !!noEntries;
  const W = 1000, H = 400;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  // Dark neutral background — the brand book's own allowance for a dark
  // surface — since that's how most people actually read Discord.
  fillCanvas(png, DARK.bg);

  // A soft gradient glow from behind the gift — the signature asset used as
  // a hero surface, not a wash over the whole card.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 210, y - H + 40) / 460;
      if (d >= 1) continue;
      const c = gradientColorAt(0.5 + (x - 210) / 1400);
      setPxBlend(png, x, y, c, (1 - d) * (1 - d) * 0.35);
    }
  }

  // Woven in before anything sits on top, so it reaches every edge and cannot
  // be cropped off — same construction as the other two banners.
  drawFlowLattice(png, { color: PURPLE_L, alpha: 0.04 });

  // Inset card, flat "craft" edge rather than a glow — matches every other
  // QuantLab card in the bot.
  darkCard(png, 18, 18, W - 36, H - 36, { radius: 26 });

  confetti(png, W, H);

  // ── The gift, left ────────────────────────────────────────────────────────
  giftBox(png, 176, 214, 150);

  // ── Status pill (optional) ───────────────────────────────────────────────
  if (pill && String(pill).trim()) {
    const pillW = 34 + textWidth(pill, 2);
    const pillX = W - 46 - pillW;
    fillRoundedRectBlend(png, pillX, 42, pillW, 40, 10, PURPLE, 1);
    dot(png, pillX + 17, 62, 5, WHITE);
    drawText(png, pill, pillX + 30, 52, 2, WHITE);
  }


  // ── Copy block, right of the gift ─────────────────────────────────────────
  const left = 330, right = W - 46;
  const cx = (left + right) / 2;
  const width = right - left;

  const headScale = fitScale(heading, width, 6, 2);
  const headY = 108 + (6 - headScale) * GLYPH_H / 2;
  if (empty) {
    // Same layout as a normal end card — only the heading uses a soft brand
    // rose→coral gradient (no full-card red wash).
    drawCenteredGradientText(png, heading, cx, headY, headScale, ROSE_A, ROSE_B);
  } else {
    drawTextCentered(png, heading, cx, headY, headScale, TEXT);
  }

  drawTextCentered(png, subtitle, cx, 108 + 6 * GLYPH_H + 14, fitScale(subtitle, width, 3, 1), empty ? ROSE_A : PURPLE_L);

  // The one signature gradient rule — sky → periwinkle, sparingly, as the
  // brand book asks — under the heading, where a hero surface belongs.
  gradientRect(png, left, 240, width, 4, 2);

  const lines = wrapText(tagline, 2, width);
  // Two lines is what the card has room for; anything past that gets a visible
  // ellipsis rather than being silently cut.
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] += '...';
  let ty = 268;
  for (const l of shown) { drawTextCentered(png, l, cx, ty, 2, SUBTLE); ty += GLYPH_H * 2 + 10; }

  // ── Signature, under the gift ─────────────────────────────────────────────
  drawFlowSignature(png, Math.round(176 - signatureWidth() / 2), 306, {
    chip: PURPLE, primary: TEXT, caption: SUBTLE,
    chipAlpha: 0.18, borderAlpha: 0.45, captionAlpha: 0.85,
    captionText: dropId ? ('QL-' + String(dropId)).toUpperCase().slice(0, 16) : '',
  });

  return PNG.sync.write(png);
}

/**
 * A wrapped gift, drawn rather than an emoji so it scales with the card and
 * carries the same palette as everything else on it. Purple body, white
 * ribbon (a white pill button's ribbon, effectively), cyan-accented bow —
 * the brand's one permitted flourish for a moment that is meant to feel
 * a little festive.
 */
function giftBox(png, cx, cy, size) {
  const half = size / 2;
  const lidH = Math.round(size * 0.22);
  const boxTop = cy - half + lidH;
  const boxH = size - lidH;

  // Body, with a lighter face on the left so the box reads as three
  // dimensional under the glow coming from that side.
  for (let y = 0; y < boxH; y++) {
    for (let x = 0; x < size; x++) {
      const lit = x < size * 0.46;
      setPxBlend(png, cx - half + x, boxTop + y, lit ? PURPLE : PURPLE_D, lit ? 0.95 : 0.9);
    }
  }

  // Lid, overhanging slightly on each side.
  const lidOver = Math.round(size * 0.07);
  for (let y = 0; y < lidH; y++) {
    for (let x = 0; x < size + lidOver * 2; x++) {
      setPxBlend(png, cx - half - lidOver + x, cy - half + y, PURPLE, 1);
    }
  }

  // Ribbon down the front and across the lid.
  const ribbonW = Math.max(6, Math.round(size * 0.12));
  fillRect(png, Math.round(cx - ribbonW / 2), boxTop, ribbonW, boxH, WHITE);
  fillRect(png, cx - half - lidOver, cy - half + Math.round(lidH / 2) - Math.round(ribbonW / 2),
    size + lidOver * 2, ribbonW, WHITE);

  // Bow — two loops and a knot. ringStroke takes the colour before the
  // thickness; passing them the other way round drew nothing visible at all.
  const loop = Math.round(size * 0.13);
  const bowY = cy - half - Math.round(loop * 0.55);
  ringStroke(png, cx - loop, bowY, loop, WHITE, 4);
  ringStroke(png, cx + loop, bowY, loop, WHITE, 4);
  dot(png, cx, bowY + Math.round(loop * 0.5), Math.max(4, Math.round(size * 0.055)), CYAN);

  // A highlight along the top edge of the lid.
  for (let x = 0; x < size + lidOver * 2; x++) {
    setPxBlend(png, cx - half - lidOver + x, cy - half, WHITE, 0.4);
  }
}

/** Scattered flecks, kept out of the middle where the copy sits. */
function confetti(png, W, H) {
  const seeds = [
    [70, 70], [120, 46], [58, 300], [96, 356], [250, 58], [292, 340],
    [612, 52], [700, 44], [840, 330], [900, 356], [946, 96], [954, 250],
    [420, 44], [470, 350], [780, 350], [660, 358],
  ];
  const palette = [PURPLE, CYAN, SKY, PURPLE_D];
  seeds.forEach(([x, y], i) => {
    const c = palette[i % palette.length];
    const r = 3 + (i % 3);
    if (i % 3 === 0) {
      // A short bar rather than a dot, so the scatter is not uniform.
      for (let d = -r; d <= r; d++) dotBlend(png, x + d, y + Math.round(d * 0.5), 1, c, 0.8);
    } else {
      dotBlend(png, x, y, r, c, 0.7);
    }
  });
}

// ── The ticket banner ────────────────────────────────────────────────────────
//
// The whole banner is a giveaway ticket: a dark card with a perforated stub on
// the left, notched top and bottom where it would tear off. The stub holds the
// gift, drawn flat and crisp at 2×: the lid has lifted off and an entry ticket
// is rising out of the box with the drop's ID printed on it. The copy sits on
// the right, the heading's last word in the serif italic, the way the countdown
// card ends. Countdown card palette and bundled fonts; no glows or gradients.

const path = require('path');
const fs = require('fs');

let Canvas = null;
try { Canvas = require('@napi-rs/canvas'); } catch { /* falls back to the pixel banner */ }

const TK = {
  ink: '#0b0c0f', card: '#14161b', rim: 'rgba(255,255,255,0.06)', text: '#f4f5f7', muted: '#8b8f99', faint: 'rgba(255,255,255,0.14)',
  accent: '#4f6dff', deep: '#2b3a9e', soft: '#8d9bff', ribbon: '#dfe3ff', paper: '#f4f5f7', rose: '#e86076',
};
const TSANS = '"CD Sans", "Segoe UI", Arial, sans-serif', TMONO = '"CD Mono", Consolas, monospace', TSERIF = '"CD Serif", Georgia, serif';

let ticketFonts = false;
function registerFonts() {
  if (ticketFonts || !Canvas) return;
  const dir = path.join(__dirname, '..', 'assets', 'fonts', 'countdown');
  const reg = (file, alias) => { try { const p = path.join(dir, file); if (fs.existsSync(p)) Canvas.GlobalFonts.registerFromPath(p, alias); } catch { /* system face */ } };
  reg('Inter-ExtraBold.ttf', 'CD Sans');
  reg('Inter-SemiBold.ttf', 'CD Sans');
  reg('JetBrainsMono-Regular.ttf', 'CD Mono');
  reg('InstrumentSerif-Italic.ttf', 'CD Serif');
  ticketFonts = true;
}

// The banner renders synchronously, but images decode asynchronously, so the
// Quantbot mark is loaded once up front (dynamicEmbedImages.warm awaits it
// before the boot render); until it is ready the signature row shows the name only.
let markImg = null, markLoading = null;
function preloadPrizeMark() {
  if (!Canvas) return Promise.resolve(null);
  if (!markLoading) {
    const file = [path.join(__dirname, '..', 'Quantbot.jpg'), path.join(__dirname, '..', 'web', 'public', 'Quantbot.jpg')].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
    markLoading = file ? Canvas.loadImage(fs.readFileSync(file)).then((img) => (markImg = img)).catch(() => null) : Promise.resolve(null);
  }
  return markLoading;
}
preloadPrizeMark();

/** "GIVEAWAY DROP. ONE WINNER" → "Giveaway drop. One winner"; text with any lower case is left as written */
const calm = (s) => {
  const t = String(s || '').trim();
  if (!t || t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
};

function wrapLines(x, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && x.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.replace(/\s+$/, '')}…`;
    return kept;
  }
  return lines;
}

/** a four-point sparkle, flat */
function sparkle(x, cx, cy, r, color) {
  x.fillStyle = color; x.beginPath();
  x.moveTo(cx, cy - r);
  x.quadraticCurveTo(cx + r * 0.16, cy - r * 0.16, cx + r, cy);
  x.quadraticCurveTo(cx + r * 0.16, cy + r * 0.16, cx, cy + r);
  x.quadraticCurveTo(cx - r * 0.16, cy + r * 0.16, cx - r, cy);
  x.quadraticCurveTo(cx - r * 0.16, cy - r * 0.16, cx, cy - r);
  x.fill();
}

/** one entry ticket, centred on (px, py), with its side notches cut clean through */
function entryTicket(x, px, py, rot, code, stamp = '') {
  x.save(); x.translate(px, py); x.rotate(rot);
  const tw = 112, th = 64;
  x.save(); x.beginPath(); x.roundRect(-tw / 2, -th / 2, tw, th, 8); x.clip();
  x.fillStyle = TK.paper; x.beginPath(); x.roundRect(-tw / 2, -th / 2, tw, th, 8);
  x.moveTo(-tw / 2 + 7, 0); x.arc(-tw / 2, 0, 7, 0, Math.PI * 2);
  x.moveTo(tw / 2 + 7, 0); x.arc(tw / 2, 0, 7, 0, Math.PI * 2);
  x.fill('evenodd'); x.restore();
  x.strokeStyle = 'rgba(11,12,15,0.25)'; x.lineWidth = 1.5; x.setLineDash([3, 4]);
  x.beginPath(); x.moveTo(-tw / 2 + 30, -th / 2 + 8); x.lineTo(-tw / 2 + 30, th / 2 - 8); x.stroke(); x.setLineDash([]);
  sparkle(x, -tw / 2 + 15, 0, 8, TK.accent);
  if (!stamp) {
    x.fillStyle = TK.ink; x.font = `600 10px ${TMONO}`; x.letterSpacing = '2px';
    x.fillText('ENTRY', -tw / 2 + 40, -6);
    x.font = `600 12px ${TMONO}`; x.letterSpacing = '1px'; x.fillStyle = '#2a2d35';
    x.fillText(code, -tw / 2 + 40, 12);
    x.letterSpacing = '0px';
  } else {   // once the draw is done the ticket's face carries a rubber stamp instead
    x.save(); x.translate(15, 0); x.rotate(-0.16);
    x.font = `600 13px ${TMONO}`; x.letterSpacing = '2px';
    const sw = x.measureText(stamp).width + 18;
    x.fillStyle = TK.paper; x.beginPath(); x.roundRect(-sw / 2, -13, sw, 26, 6); x.fill();
    x.strokeStyle = TK.accent; x.lineWidth = 2.5; x.beginPath(); x.roundRect(-sw / 2, -13, sw, 26, 6); x.stroke();
    x.fillStyle = TK.accent; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(stamp, 1, 1);
    x.textAlign = 'left'; x.textBaseline = 'alphabetic'; x.letterSpacing = '0px';
    x.restore();
  }
  x.restore();
}

/**
 * The open gift: box, lifted lid with its bow, and an entry ticket rising out.
 * `pose` moves it for the drawing animation (giftDrawVisual.js); without one it
 * is the banner's still.
 *   lid: { dy, rot }  extra lift and tilt for the lid
 *   tickets: [{ dx, rise, rot, code }]  rise 1 = out like the banner's, 0 = hidden in the box
 *   twinkle: [s, s, s]  sparkle scales
 */
function openGift(x, cx, cy, dropId, pose = null) {
  const bw = 156, bh = 112, bx = cx - bw / 2, by = cy + 6;
  const code = dropId ? `QL-${String(dropId).toUpperCase().slice(0, 8)}` : 'NO. 0001';
  const tickets = pose?.tickets || [{ dx: 0, rise: 1, rot: 0, code }];

  // the box's back wall, seen through the open top
  x.fillStyle = TK.deep; x.beginPath(); x.roundRect(bx + 6, by - 14, bw - 12, 22, 6); x.fill();

  // the tickets, rising from inside, tilted; a lowered one sits hidden behind the front
  // (kept inside the box's walls below its rim, so a sinking ticket never pokes out the side)
  x.save(); x.beginPath(); x.rect(cx - 400, by - 400, 800, 386); x.rect(bx + 6, by - 14, bw - 12, bh + 14); x.clip();
  for (const tk of tickets) {
    if (tk.rise <= 0) continue;
    entryTicket(x, cx + 4 + (tk.dx || 0), by + 44 - tk.rise * 78, -0.09 + (tk.rot || 0), tk.code || code, tk.stamp || pose?.stamp || '');
  }
  x.restore();

  // the box: a flat slab shadow, the front, the ribbon
  x.fillStyle = TK.deep; x.beginPath(); x.roundRect(bx + 10, by + 10, bw, bh, 14); x.fill();
  x.fillStyle = TK.accent; x.beginPath(); x.roundRect(bx, by, bw, bh, 14); x.fill();
  x.fillStyle = TK.ribbon; x.fillRect(cx - 13, by, 26, bh);
  x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillRect(bx + 14, by + 12, 4, bh - 24);   // one crisp highlight line

  // the lid, lifted and tipped back, with the bow riding on it
  x.save(); x.translate(cx - 16, by - 86 - (pose?.lid?.dy || 0)); x.rotate(-0.22 + (pose?.lid?.rot || 0));
  const lw = 176, lh = 36;
  x.fillStyle = TK.deep; x.beginPath(); x.roundRect(-lw / 2 + 8, -lh / 2 + 8, lw, lh, 10); x.fill();
  x.fillStyle = TK.soft; x.beginPath(); x.roundRect(-lw / 2, -lh / 2, lw, lh, 10); x.fill();
  x.fillStyle = TK.ribbon; x.fillRect(-13, -lh / 2, 26, lh);
  // bow: two loops and two tails, flat
  x.fillStyle = TK.ribbon;
  const loop = (dir) => {
    x.beginPath(); x.moveTo(0, -lh / 2 + 2);
    x.bezierCurveTo(dir * 18, -lh / 2 - 46, dir * 62, -lh / 2 - 30, dir * 38, -lh / 2 - 4);
    x.bezierCurveTo(dir * 26, -lh / 2 + 6, dir * 10, -lh / 2 + 4, 0, -lh / 2 + 2);
    x.fill();
  };
  loop(-1); loop(1);
  x.fillStyle = TK.ink; // the loops' holes, so they read as ribbon and not blobs
  x.beginPath(); x.ellipse(-24, -lh / 2 - 18, 7, 4, -0.7, 0, Math.PI * 2); x.ellipse(24, -lh / 2 - 18, 7, 4, 0.7, 0, Math.PI * 2); x.fill();
  x.fillStyle = TK.paper; x.beginPath(); x.roundRect(-9, -lh / 2 - 8, 18, 14, 5); x.fill();
  x.restore();

  // a few sparkles where the lid came off
  const tw = pose?.twinkle || [1, 1, 1];
  sparkle(x, cx + 84, by - 92, 11 * tw[0], TK.paper);
  sparkle(x, cx + 64, by - 128, 6 * tw[1], TK.soft);
  sparkle(x, cx - 92, by - 30, 7 * tw[2], TK.soft);
}

/**
 * @param {object} [copy] pill / heading / subtitle / tagline overrides, plus dropId, noEntries and
 *   drawn (the reveal card: the gift's ticket is stamped DRAWN)
 * @returns {Buffer} PNG image data
 */
function generatePrizeGiveawayBannerImage(copy = {}) {
  if (!Canvas) return legacyPrizeBanner(copy);
  registerFonts();
  const { pill, heading, subtitle, tagline, dropId, noEntries, drawn } = { ...PRIZE_DEFAULTS, ...copy };
  const empty = !!noEntries;
  const W = 1000, H = 400, S = 2, STUB = 330;
  const cv = Canvas.createCanvas(W * S, H * S), x = cv.getContext('2d');
  x.scale(S, S);
  x.fillStyle = TK.ink; x.fillRect(0, 0, W, H);

  // the ticket: card, rim, the two tear-off notches and the perforation
  const M = 18;
  x.fillStyle = TK.card; x.beginPath(); x.roundRect(M, M, W - M * 2, H - M * 2, 26); x.fill();
  x.strokeStyle = TK.rim; x.lineWidth = 1.5; x.beginPath(); x.roundRect(M + 0.75, M + 0.75, W - M * 2 - 1.5, H - M * 2 - 1.5, 25.5); x.stroke();
  x.fillStyle = TK.ink; x.beginPath(); x.arc(STUB, M, 20, 0, Math.PI * 2); x.arc(STUB, H - M, 20, 0, Math.PI * 2); x.fill();
  x.strokeStyle = TK.faint; x.lineWidth = 2; x.lineCap = 'round'; x.setLineDash([2, 10]);
  x.beginPath(); x.moveTo(STUB, M + 34); x.lineTo(STUB, H - M - 34); x.stroke(); x.setLineDash([]);

  // a faint dot grid on the stub only, never behind the copy
  x.fillStyle = 'rgba(255,255,255,0.035)';
  for (let gy = 48; gy < H - 40; gy += 22) for (let gx = 48; gx < STUB - 24; gx += 22) { x.beginPath(); x.arc(gx, gy, 1.3, 0, Math.PI * 2); x.fill(); }

  openGift(x, 172, 196, dropId, drawn && !noEntries ? { stamp: 'DRAWN' } : null);

  // ── copy ─────────────────────────────────────────────────────────────────
  const L = STUB + 52, R = W - 62, width = R - L;
  if (pill && String(pill).trim()) {
    x.font = `600 13px ${TMONO}`; x.letterSpacing = '2px';
    const label = String(pill).toUpperCase().slice(0, 20), pw = x.measureText(label).width + 40;
    x.fillStyle = 'rgba(79,109,255,0.16)'; x.beginPath(); x.roundRect(R - pw, 46, pw, 30, 15); x.fill();
    x.fillStyle = TK.accent; x.beginPath(); x.arc(R - pw + 16, 61, 4, 0, Math.PI * 2); x.fill();
    x.fillStyle = TK.soft; x.textBaseline = 'middle'; x.fillText(label, R - pw + 28, 62); x.textBaseline = 'alphabetic';
    x.letterSpacing = '0px';
  }
  x.fillStyle = empty ? TK.rose : TK.accent; x.beginPath(); x.arc(L + 6, 92, 6, 0, Math.PI * 2); x.fill();
  x.font = `600 15px ${TMONO}`; x.letterSpacing = '3px'; x.fillStyle = empty ? TK.rose : TK.soft; x.textBaseline = 'middle';
  x.fillText(String(subtitle || '').toUpperCase().slice(0, 34), L + 24, 93);
  x.textBaseline = 'alphabetic'; x.letterSpacing = '0px';

  // the heading: all but its last word in the sans, the last word in the serif italic
  const words = calm(heading || 'Giveaway drop').split(/\s+/), tail = words.length > 1 ? words.pop() : '', lead = words.join(' ');
  let size = 72;
  const measure = () => {
    x.font = `800 ${size}px ${TSANS}`; x.letterSpacing = `${-size * 0.03}px`;
    const a = x.measureText(lead ? `${lead} ` : '').width;
    x.font = `400 ${size * 1.12}px ${TSERIF}`; x.letterSpacing = '0px';
    return a + x.measureText(tail || '').width;
  };
  while (size > 36 && measure() > width) size -= 2;
  const hy = 182;
  x.font = `800 ${size}px ${TSANS}`; x.letterSpacing = `${-size * 0.03}px`; x.fillStyle = TK.text;
  x.fillText(lead || tail, L - 3, hy);
  if (lead && tail) {
    const lw = x.measureText(`${lead} `).width;
    x.letterSpacing = '0px'; x.font = `400 ${size * 1.12}px ${TSERIF}`; x.fillStyle = empty ? TK.rose : TK.soft;
    x.fillText(tail, L - 3 + lw, hy);
  }
  x.letterSpacing = '0px';

  x.font = `600 19px ${TSANS}`; x.fillStyle = TK.muted;
  wrapLines(x, calm(tagline), width, 2).forEach((l, i) => x.fillText(l, L, 236 + i * 30));

  // signature row: the Quantbot mark, and the drop ID on the right
  const sy = H - M - 52;
  x.strokeStyle = TK.rim; x.lineWidth = 1.5; x.beginPath(); x.moveTo(L, sy - 28); x.lineTo(R, sy - 28); x.stroke();
  const img = markImg;
  if (img) {
    x.save(); x.beginPath(); x.arc(L + 16, sy, 16, 0, Math.PI * 2); x.clip();
    const s = Math.max(32 / img.width, 32 / img.height);
    x.drawImage(img, L + 16 - (img.width * s) / 2, sy - (img.height * s) / 2, img.width * s, img.height * s);
    x.restore();
  }
  x.font = `600 13px ${TMONO}`; x.letterSpacing = '2px'; x.fillStyle = TK.muted; x.textBaseline = 'middle';
  x.fillText('QUANTBOT', L + 44, sy + 1);
  if (dropId) {
    const id = `QL-${String(dropId).toUpperCase().slice(0, 12)}`;
    x.textAlign = 'right'; x.fillStyle = TK.soft; x.fillText(id, R, sy + 1);
    x.fillStyle = TK.muted; x.fillText('DROP', R - x.measureText(id).width - 14, sy + 1);
    x.textAlign = 'left';
  }
  x.textBaseline = 'alphabetic'; x.letterSpacing = '0px';

  return cv.toBuffer('image/png');
}

module.exports = { generatePrizeGiveawayBannerImage, preloadPrizeMark, PRIZE_DEFAULTS, openGift, registerFonts, TK };
