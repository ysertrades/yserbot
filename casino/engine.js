'use strict';

// ────────────────────────────────────────────────────────────────
// Casino Engine — pure game logic (no Discord, no side-effects)
// ────────────────────────────────────────────────────────────────

const { PNG } = require('pngjs');
const crypto = require('node:crypto');
const { randomInt } = crypto;

// ── Secure randomness ───────────────────────────────────────────────────────
// Every game outcome is decided with crypto.randomInt (CSPRNG-backed), not
// Math.random(). Math.random() is a fast, non-cryptographic PRNG — its
// internal state can in theory be fingerprinted from enough samples. Casino
// game outcomes should never be derivable/guessable by anyone watching the
// bot, so every "did they win" decision below goes through _rand()/_randInt().
function _rand() { return randomInt(0, 1_000_000_000) / 1_000_000_000; } // [0, 1)
function _randInt(maxExclusive) { return randomInt(0, maxExclusive); }   // [0, maxExclusive)

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = _randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─── COINFLIP (true 50/50, secure RNG) ─────────────────────────────────── */

function coinflip(choice) {
  const result = _rand() < 0.5 ? 'heads' : 'tails';
  return { result, won: result === choice };
}

/* ─── BLACKJACK ─────────────────────────────────────────────────────────── */

function createDeck(numDecks = 6) {
  const deck = [];
  for (let d = 0; d < numDecks; d++)
    for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  return shuffle(deck);
}

function cardVal(c) {
  if (c.r === 'A') return 11;
  if (['J', 'Q', 'K'].includes(c.r)) return 10;
  return parseInt(c.r, 10);
}

function handVal(hand) {
  let v = hand.reduce((t, c) => t + cardVal(c), 0);
  let aces = hand.filter(c => c.r === 'A').length;
  while (v > 21 && aces-- > 0) v -= 10;
  return v;
}

function isSoft(hand) {
  const hard = hand.reduce((t, c) => t + (c.r === 'A' ? 1 : cardVal(c)), 0);
  return handVal(hand) !== hard && handVal(hand) <= 21;
}

function cStr(c) { return `\`${c.r}${c.s}\``; }
function hStr(hand) { return hand.map(cStr).join(' '); }

function dealBJ() {
  const deck = createDeck(6);
  return {
    deck: deck.slice(4),
    player: [deck[0], deck[2]],
    dealer: [deck[1], deck[3]],
    splitHand: null, playingSplit: false, splitDone: false,
    insuranceTaken: false, insuranceDeclined: false, surrendered: false,
  };
}

function bjHit(state) {
  const deck = [...state.deck], card = deck.shift();
  if (state.playingSplit) return { ...state, deck, splitHand: [...state.splitHand, card] };
  return { ...state, deck, player: [...state.player, card] };
}
function bjDouble(state) {
  const deck = [...state.deck], card = deck.shift();
  return { ...state, deck, player: [...state.player, card] };
}
function bjStand(state) {
  if (state.splitHand && !state.playingSplit && !state.splitDone)
    return { ...state, playingSplit: true };
  return state;
}
function bjSplit(state) {
  const deck = [...state.deck], c1 = deck.shift(), c2 = deck.shift();
  return { ...state, deck, player: [state.player[0], c1], splitHand: [state.player[1], c2], playingSplit: false, splitDone: false };
}
function canSplit(state) {
  if (state.splitHand || state.player.length !== 2) return false;
  return cardVal(state.player[0]) === cardVal(state.player[1]);
}
function bjFirstHandDone(state) { return { ...state, splitDone: true, playingSplit: true }; }
function canInsure(state) {
  return state.dealer[0].r === 'A' && state.player.length === 2 && !state.insuranceTaken && !state.insuranceDeclined;
}
function bjInsure(state)        { return { ...state, insuranceTaken: true }; }
function bjDeclineInsure(state) { return { ...state, insuranceDeclined: true }; }

function dealerPlay(state) {
  let dealer = [...state.dealer], deck = [...state.deck];
  while (handVal(dealer) < 17 || (handVal(dealer) === 17 && isSoft(dealer)))
    dealer.push(deck.shift());
  return { ...state, deck, dealer };
}

function bjResultHand(playerHand, dealerHand) {
  const pv = handVal(playerHand), dv = handVal(dealerHand);
  const pBJ = playerHand.length === 2 && pv === 21;
  const dBJ = dealerHand.length === 2 && dv === 21;
  if (pBJ && dBJ) return 'push';
  if (pBJ) return 'blackjack';
  if (dBJ) return 'loss';
  if (pv > 21) return 'bust';
  if (dv > 21) return 'dealer_bust';
  if (pv > dv) return 'win';
  if (pv === dv) return 'push';
  return 'loss';
}

function bjResult(state) {
  const main = bjResultHand(state.player, state.dealer);
  if (!state.splitHand) return { main };
  return { main, split: bjResultHand(state.splitHand, state.dealer) };
}

/* ─── SLOTS ─────────────────────────────────────────────────────────────── */

const SLOT_SYMS = [
  { e: '🍒', w: 28, p3: 3,   p2: 1.5, name: 'Cherry'  },
  { e: '🍋', w: 22, p3: 5,   p2: 0,   name: 'Lemon'   },
  { e: '🍊', w: 17, p3: 10,  p2: 0,   name: 'Orange'  },
  { e: '🍇', w: 12, p3: 15,  p2: 0,   name: 'Grape'   },
  { e: '⭐', w: 8,  p3: 25,  p2: 0,   name: 'Star'    },
  { e: '💎', w: 5,  p3: 50,  p2: 0,   name: 'Diamond' },
  { e: '7️⃣', w: 3,  p3: 100, p2: 0,   name: 'Seven'   },
  { e: '🍀', w: 1,  p3: 500, p2: 0,   name: 'Clover'  },
];

const SLOT_TOTAL_W = SLOT_SYMS.reduce((s, x) => s + x.w, 0);

function spinReel() {
  let r = _rand() * SLOT_TOTAL_W;
  for (const s of SLOT_SYMS) { r -= s.w; if (r <= 0) return s; }
  return SLOT_SYMS[SLOT_SYMS.length - 1];
}

function spinSlots() {
  const reels = [spinReel(), spinReel(), spinReel()];
  let mult = 0, resultType = 'lose';

  if (reels[0].e === reels[1].e && reels[1].e === reels[2].e) {
    mult = reels[0].p3;
    resultType = mult >= 100 ? 'jackpot' : 'triple';
  } else {
    let matchSym = null;
    if (reels[0].e === reels[1].e)      matchSym = reels[0];
    else if (reels[1].e === reels[2].e) matchSym = reels[1];
    else if (reels[0].e === reels[2].e) matchSym = reels[0];
    if (matchSym && matchSym.p2 > 0) { mult = matchSym.p2; resultType = 'pair'; }
  }

  return { reels, mult, resultType, won: mult > 0 };
}

/* ─── CRASH (secure RNG) ──────────────────────────────────────────────────── */

function generateCrashPoint() {
  if (_rand() < 0.01) return 1.00; // 1% instant crash
  const r = _rand() * 0.97;
  return Math.max(1.01, parseFloat((0.99 / (1 - r)).toFixed(2)));
}

const TICK_MS       = 2500; // 2.5 seconds per tick
const TICK_GROWTH   = 1.12; // each tick multiplies by 1.12

function tickMultiplier(tick) {
  return parseFloat(Math.pow(TICK_GROWTH, tick).toFixed(2));
}

/* ─── RACE (secure RNG) ───────────────────────────────────────────────────── */

const HORSES = [
  { id: 1, name: 'Thunder', emoji: '🐎' },
  { id: 2, name: 'Blaze',   emoji: '🐎' },
  { id: 3, name: 'Shadow',  emoji: '🐎' },
  { id: 4, name: 'Storm',   emoji: '🐎' },
  { id: 5, name: 'Flash',   emoji: '🐎' },
];

const TURTLES = [
  { id: 1, name: 'Speedy', emoji: '🐢' },
  { id: 2, name: 'Turbo',  emoji: '🐢' },
  { id: 3, name: 'Rocket', emoji: '🐢' },
];

function runRace(racers) {
  const speeds    = racers.map(() => _rand() * 0.6 + _rand() * 0.4);
  const maxSpeed  = Math.max(...speeds);
  const winnerIdx = speeds.indexOf(maxSpeed);
  const progress  = speeds.map(s => Math.min(99, Math.round((s / maxSpeed) * 88 + 8)));
  progress[winnerIdx] = 100;
  return { winnerIdx, progress };
}

/* ─── TRADING ─────────────────────────────────────────────────────────────── */
// RR economics: choosing "1:R" risk/reward means a win returns exactly
// (R + 1)× the stake — the +1 is the stake itself coming back, the R is the
// reward. So 1:1 → 2×, 1:2 → 3×, 1:3 → 4×, with zero randomness layered on
// top of that ratio. Outcome (win/lose) is decided purely by which price
// level — take-profit or stop-loss — the simulated market path touches
// first; the payout multiplier itself is always exactly the chosen RR, never
// a random/bonus number.

const RR_REWARD      = { '1:1': 1, '1:2': 2, '1:3': 3 };
const RR_MULTIPLIER  = { '1:1': 2, '1:2': 3, '1:3': 4 };
const TRADING_GUARDRAILS = {
  SPREAD_BPS: 5,
  BASE_SLIPPAGE_BPS: 3,
  MAX_MOVE_PCT: 0.022,
  HIST_POINTS: 34,
  FUTURE_POINTS: 26,
};
const CANDLE_GROUP = 2; // ticks per rendered candlestick

function _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function _hashSeed(input) {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0);
}

function _mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function _buildPricePath(rng, startPrice, points, maxStepPct, drift = 0) {
  const out = [startPrice];
  for (let i = 1; i < points; i++) {
    const noise = (rng() - 0.5) * 2 * maxStepPct;
    const movePct = _clamp(noise + drift, -maxStepPct, maxStepPct);
    out.push(Math.max(1, out[i - 1] * (1 + movePct)));
  }
  return out;
}

function _calcATR(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < prices.length; i++) total += Math.abs(prices[i] - prices[i - 1]);
  return total / (prices.length - 1);
}

function _toCandles(prices, groupSize) {
  const candles = [];
  for (let i = 0; i < prices.length; i += groupSize) {
    const slice = prices.slice(i, i + groupSize);
    if (!slice.length) continue;
    candles.push({
      open: slice[0],
      close: slice[slice.length - 1],
      high: Math.max(...slice),
      low: Math.min(...slice),
    });
  }
  return candles;
}

/* ─── Pixel-art / glassmorphism primitives ──────────────────────────────── */

function _setPx(png, x, y, c) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) * 4;
  png.data[i] = c[0];
  png.data[i + 1] = c[1];
  png.data[i + 2] = c[2];
  png.data[i + 3] = c[3] === undefined ? 255 : c[3];
}

function _blendColor(bg, fg, alpha) {
  return [
    Math.round(bg[0] + (fg[0] - bg[0]) * alpha),
    Math.round(bg[1] + (fg[1] - bg[1]) * alpha),
    Math.round(bg[2] + (fg[2] - bg[2]) * alpha),
    255,
  ];
}

/** Alpha-blend a color onto whatever pixel is already there — the core trick
 *  that makes translucent "glass" panels/glows possible with raw pixel ops. */
function _setPxBlend(png, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height || alpha <= 0) return;
  if (alpha >= 1) { _setPx(png, x, y, color); return; }
  const i = (png.width * y + x) * 4;
  const bg = [png.data[i], png.data[i + 1], png.data[i + 2]];
  _setPx(png, x, y, _blendColor(bg, color, alpha));
}

function _fillRect(png, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) _setPx(png, xx, yy, c);
  }
}

function _fillRectBlend(png, x, y, w, h, c, alpha) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) _setPxBlend(png, xx, yy, c, alpha);
  }
}

function _rect(png, x, y, w, h, c, th = 1) {
  for (let t = 0; t < th; t++) {
    _line(png, x + t, y + t, x + w - 1 - t, y + t, c, 1);
    _line(png, x + t, y + h - 1 - t, x + w - 1 - t, y + h - 1 - t, c, 1);
    _line(png, x + t, y + t, x + t, y + h - 1 - t, c, 1);
    _line(png, x + w - 1 - t, y + t, x + w - 1 - t, y + h - 1 - t, c, 1);
  }
}

// Bresenham stepping only ever moves by whole pixels, so the exit condition
// (x === x2 && y === y2) can only be reached if the endpoints are integers —
// a fractional target would step past it forever. Round defensively here
// once, rather than relying on every call site to round its own coordinates.
function _line(png, x1, y1, x2, y2, c, th = 1) {
  x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
  const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
  let err = dx + dy, x = x1, y = y1;
  const halfTh = Math.floor(th / 2);
  let guard = (Math.abs(dx) + Math.abs(dy)) * 2 + th * 4 + 16;
  while (true) {
    for (let tx = -halfTh; tx <= halfTh; tx++) {
      for (let ty = -halfTh; ty <= halfTh; ty++) _setPx(png, x + tx, y + ty, c);
    }
    if (x === x2 && y === y2) break;
    if (--guard <= 0) break; // safety net — should be unreachable with integer endpoints
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function _lineBlend(png, x1, y1, x2, y2, c, alpha, th = 1) {
  x1 = Math.round(x1); y1 = Math.round(y1); x2 = Math.round(x2); y2 = Math.round(y2);
  const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
  let err = dx + dy, x = x1, y = y1;
  const halfTh = Math.floor(th / 2);
  let guard = (Math.abs(dx) + Math.abs(dy)) * 2 + th * 4 + 16;
  while (true) {
    for (let tx = -halfTh; tx <= halfTh; tx++) {
      for (let ty = -halfTh; ty <= halfTh; ty++) _setPxBlend(png, x + tx, y + ty, c, alpha);
    }
    if (x === x2 && y === y2) break;
    if (--guard <= 0) break; // safety net — should be unreachable with integer endpoints
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function _hLine(png, y, x1, x2, c, th = 1) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    for (let t = 0; t < th; t++) _setPx(png, x, y + t, c);
  }
}

function _hLineBlend(png, y, x1, x2, c, alpha, th = 1) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    for (let t = 0; t < th; t++) _setPxBlend(png, x, y + t, c, alpha);
  }
}

function _dot(png, x, y, radius, c) {
  const r2 = radius * radius;
  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      if ((xx * xx) + (yy * yy) <= r2) _setPx(png, x + xx, y + yy, c);
    }
  }
}

function _dotBlend(png, x, y, radius, c, alpha) {
  const r2 = radius * radius;
  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      if ((xx * xx) + (yy * yy) <= r2) _setPxBlend(png, x + xx, y + yy, c, alpha);
    }
  }
}

function _oval(png, x, y, rx, ry, c) {
  for (let yy = -ry; yy <= ry; yy++) {
    for (let xx = -rx; xx <= rx; xx++) {
      if (((xx * xx) / (rx * rx)) + ((yy * yy) / (ry * ry)) <= 1) _setPx(png, x + xx, y + yy, c);
    }
  }
}

/** Soft radial glow — many concentric alpha-fading rings, the workhorse of
 *  the neon/glass accent lighting used across every game. */
function _radialGlow(png, cx, cy, radius, color, maxAlpha = 0.4) {
  const x0 = Math.max(0, cx - radius), x1 = Math.min(png.width - 1, cx + radius);
  const y0 = Math.max(0, cy - radius), y1 = Math.min(png.height - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) continue;
      _setPxBlend(png, x, y, color, maxAlpha * (1 - d / radius));
    }
  }
}

function _vGradientBg(png, top, bottom) {
  for (let y = 0; y < png.height; y++) {
    const t = y / Math.max(1, png.height - 1);
    const c = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
      255,
    ];
    for (let x = 0; x < png.width; x++) _setPx(png, x, y, c);
  }
}

function _roundedMask(w, h, radius, x, y) {
  const rx = Math.min(radius, w / 2), ry = Math.min(radius, h / 2);
  if (x < rx && y < ry) return Math.hypot(rx - x, ry - y) <= rx;
  if (x >= w - rx && y < ry) return Math.hypot(x - (w - rx), ry - y) <= rx;
  if (x < rx && y >= h - ry) return Math.hypot(rx - x, y - (h - ry)) <= rx;
  if (x >= w - rx && y >= h - ry) return Math.hypot(x - (w - rx), y - (h - ry)) <= rx;
  return true;
}

/** The signature "glass panel": a rounded, faintly-tinted translucent card
 *  with a soft border and a top sheen highlight — reused by every game so
 *  the whole casino shares one consistent glassmorphism look. */
function _glassPanel(png, px, py, w, h, opts = {}) {
  const {
    radius = 18,
    tint = [255, 255, 255],
    tintAlpha = 0.07,
    // tintAlphaBottom accepted-but-ignored: kept so existing call sites don't
    // need updating. The panel fill is one flat translucent color (a solid
    // "gloss" tint), never a top-to-bottom gradient wash.
    border = [255, 255, 255],
    borderAlpha = 0.25,
    accent = null,
    accentAlpha = 0.10,
  } = opts;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!_roundedMask(w, h, radius, x, y)) continue;
      _setPxBlend(png, px + x, py + y, tint, tintAlpha);
      if (accent) _setPxBlend(png, px + x, py + y, accent, accentAlpha);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!_roundedMask(w, h, radius, x, y)) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || !_roundedMask(w, h, radius, x - 1, y) || !_roundedMask(w, h, radius, x + 1, y)
        || !_roundedMask(w, h, radius, x, y - 1) || !_roundedMask(w, h, radius, x, y + 1);
      if (edge) _setPxBlend(png, px + x, py + y, border, borderAlpha);
    }
  }
  const sheenEnd = Math.max(radius, w - radius);
  for (let x = radius; x < sheenEnd; x++) _setPxBlend(png, px + x, py + 2, [255, 255, 255], 0.20);
}

function _ambientBackdrop(png, blooms) {
  for (const [cx, cy, r, color, a] of blooms) _radialGlow(png, cx, cy, r, color, a);
}

/* ─── Suit / card art (blackjack, coinflip) ─────────────────────────────── */

function _drawSuit(png, suit, x, y, scale = 1) {
  const red = [231, 76, 60, 255];
  const dark = [44, 62, 80, 255];
  const color = suit === '♥️' || suit === '♦️' ? red : dark;
  const r = Math.max(3, Math.round(4 * scale));

  if (suit === '♥️') {
    _dot(png, x - r, y - r, r, color);
    _dot(png, x + r, y - r, r, color);
    _line(png, x - (r * 2), y - r, x, y + (r * 2), color, 2);
    _line(png, x + (r * 2), y - r, x, y + (r * 2), color, 2);
  } else if (suit === '♦️') {
    _line(png, x, y - (r * 2), x - (r * 2), y, color, 2);
    _line(png, x - (r * 2), y, x, y + (r * 2), color, 2);
    _line(png, x, y + (r * 2), x + (r * 2), y, color, 2);
    _line(png, x + (r * 2), y, x, y - (r * 2), color, 2);
  } else if (suit === '♣️') {
    _dot(png, x, y - r, r, color);
    _dot(png, x - r, y + 1, r, color);
    _dot(png, x + r, y + 1, r, color);
    _line(png, x, y + (r * 2), x, y + (r * 4), color, 2);
  } else {
    _dot(png, x, y - (r * 2), r, color);
    _line(png, x, y - (r * 2), x - (r * 2), y + r, color, 2);
    _line(png, x, y - (r * 2), x + (r * 2), y + r, color, 2);
    _line(png, x, y + r, x, y + (r * 3), color, 2);
  }
}

function _rankBars(card) {
  const map = { A: 1, J: 11, Q: 12, K: 13 };
  const n = map[card.r] ?? Number(card.r);
  return Number.isFinite(n) ? n : 10;
}

function _drawCard(png, x, y, card, faceDown = false, highlight = false) {
  const w = 98; const h = 138;
  // drop shadow
  _fillRectBlend(png, x + 4, y + 6, w, h, [0, 0, 0, 255], 0.35);
  if (highlight) _radialGlow(png, x + w / 2, y + h / 2, Math.round(w * 0.9), [241, 196, 15, 255], 0.22);
  _fillRect(png, x, y, w, h, [244, 246, 249, 255]);
  _rect(png, x, y, w, h, highlight ? [241, 196, 15, 255] : [130, 146, 166, 255], 2);
  _fillRect(png, x + 4, y + 4, w - 8, h - 8, [255, 255, 255, 255]);
  // glassy sheen streak across the card face
  for (let i = 0; i < 14; i++) _lineBlend(png, x + 10 + i, y + 8, x + i - 6, y + h - 8, [255, 255, 255, 255], 0.06, 1);

  if (faceDown) {
    _fillRect(png, x + 10, y + 10, w - 20, h - 20, [41, 128, 185, 255]);
    for (let yy = y + 12; yy < y + h - 12; yy += 8) {
      _line(png, x + 12, yy, x + w - 12, yy, [174, 214, 241, 255], 1);
    }
    _radialGlow(png, x + w / 2, y + h / 2, 46, [255, 255, 255, 255], 0.12);
    return;
  }

  const bars = _rankBars(card);
  const barCount = Math.max(1, Math.min(10, Math.ceil(bars / 2)));
  for (let i = 0; i < barCount; i++) {
    _fillRect(png, x + 10 + (i * 7), y + 10, 5, 3, [85, 98, 112, 255]);
    _fillRect(png, x + w - 15 - (i * 7), y + h - 13, 5, 3, [85, 98, 112, 255]);
  }
  _drawSuit(png, card.s, x + Math.floor(w / 2), y + Math.floor(h / 2), 1.2);
}

function renderBlackjackTablePng({
  dealer = [],
  player = [],
  splitHand = null,
  hideDealerHole = true,
  playingSplit = false,
}) {
  const W = 1000; const H = 560;
  const png = new PNG({ width: W, height: H, colorType: 6 });

  _vGradientBg(png, [8, 46, 34, 255], [6, 26, 20, 255]);
  _ambientBackdrop(png, [
    [140, 90, 220, [40, 190, 130, 255], 0.16],
    [860, 460, 260, [20, 120, 90, 255], 0.14],
  ]);

  _glassPanel(png, 16, 16, W - 32, H - 32, {
    radius: 26, tint: [241, 196, 15], tintAlpha: 0.05, tintAlphaBottom: 0.02,
    border: [241, 196, 15], borderAlpha: 0.4,
  });
  _hLineBlend(png, 258, 40, W - 40, [120, 220, 190, 255], 0.25, 2);

  dealer.slice(0, 6).forEach((c, i) => _drawCard(png, 210 + (i * 108), 72, c, hideDealerHole && i === 1));

  if (splitHand && splitHand.length) {
    player.slice(0, 6).forEach((c, i) => _drawCard(png, 120 + (i * 84), 330, c, false, !playingSplit));
    splitHand.slice(0, 6).forEach((c, i) => _drawCard(png, 560 + (i * 84), 330, c, false, playingSplit));
  } else {
    player.slice(0, 8).forEach((c, i) => _drawCard(png, 130 + (i * 92), 330, c, false));
  }

  return PNG.sync.write(png);
}

/* ─── COINFLIP ───────────────────────────────────────────────────────────── */

function renderCoinflipPng(choice, result) {
  const W = 900; const H = 420;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  _vGradientBg(png, [14, 18, 30, 255], [22, 27, 42, 255]);

  const won = choice === result;
  const centerX = Math.floor(W / 2);
  const centerY = Math.floor(H / 2) + 4;

  _ambientBackdrop(png, [
    [centerX, centerY, 260, won ? [46, 204, 113, 255] : [231, 76, 60, 255], 0.14],
    [140, 90, 180, [120, 140, 255, 255], 0.10],
    [W - 140, H - 90, 180, [255, 200, 90, 255], 0.08],
  ]);

  _glassPanel(png, 24, 24, W - 48, H - 48, { radius: 26, tintAlpha: 0.05, tintAlphaBottom: 0.015, borderAlpha: 0.18 });

  // Metallic coin: layered concentric rings + a bright glint for a 3D feel.
  const isHeads = result === 'heads';
  const ring   = isHeads ? [214, 178, 60, 255]  : [176, 186, 196, 255];
  const face   = isHeads ? [246, 219, 130, 255] : [220, 228, 234, 255];
  const inner  = isHeads ? [252, 236, 176, 255] : [236, 241, 245, 255];
  const glowC  = won ? [46, 204, 113, 255] : [231, 76, 60, 255];

  _radialGlow(png, centerX, centerY, 150, glowC, 0.45);
  _dot(png, centerX, centerY, 106, ring);
  _dot(png, centerX, centerY, 94, face);
  _dot(png, centerX, centerY, 72, inner);
  _dotBlend(png, centerX - 26, centerY - 32, 34, [255, 255, 255, 255], 0.35); // glint
  _dot(png, centerX, centerY, 8, glowC);
  _drawSuit(png, isHeads ? '♥️' : '♠️', centerX, centerY, 2.3);

  // Glass chips showing the two possible sides, choice highlighted.
  const chipY = 205, chipR = 46;
  const leftIsChoice = choice === 'heads';
  const leftSuit = leftIsChoice ? '♥️' : '♣️';
  const rightSuit = leftIsChoice ? '♣️' : '♥️';
  const chipColor = (isSel) => isSel ? [46, 204, 113, 255] : [255, 255, 255, 255];
  const chipAlpha = (isSel) => isSel ? 0.22 : 0.08;

  _dotBlend(png, 175, chipY, chipR, chipColor(leftIsChoice), chipAlpha(leftIsChoice));
  _dotBlend(png, 175, chipY, chipR, [255, 255, 255, 255], 0.12);
  _drawSuit(png, leftSuit, 175, chipY, 1.4);

  _dotBlend(png, W - 175, chipY, chipR, chipColor(!leftIsChoice), chipAlpha(!leftIsChoice));
  _dotBlend(png, W - 175, chipY, chipR, [255, 255, 255, 255], 0.12);
  _drawSuit(png, rightSuit, W - 175, chipY, 1.4);

  return PNG.sync.write(png);
}

/* ─── SLOTS (glass cabinet, hand-drawn fruit icons) ─────────────────────── */

function _drawSlotIcon(png, sym, cx, cy, r) {
  const name = sym.name;
  if (name === 'Cherry') {
    const red = [220, 50, 60, 255], green = [60, 170, 70, 255];
    _line(png, cx, cy - r, cx - 4, cy - r * 0.4, green, 2);
    _line(png, cx, cy - r, cx + 4, cy - r * 0.4, green, 2);
    _dot(png, cx - Math.round(r * 0.35), cy + Math.round(r * 0.25), Math.round(r * 0.42), red);
    _dot(png, cx + Math.round(r * 0.35), cy + Math.round(r * 0.35), Math.round(r * 0.42), red);
    _dotBlend(png, cx - Math.round(r * 0.45), cy + Math.round(r * 0.1), Math.round(r * 0.12), [255, 255, 255, 255], 0.5);
  } else if (name === 'Lemon') {
    _oval(png, cx, cy, Math.round(r * 0.62), Math.round(r * 0.9), [240, 210, 50, 255]);
    _dotBlend(png, cx - Math.round(r * 0.15), cy - Math.round(r * 0.3), Math.round(r * 0.18), [255, 255, 255, 255], 0.5);
  } else if (name === 'Orange') {
    _dot(png, cx, cy, Math.round(r * 0.78), [240, 140, 30, 255]);
    _line(png, cx, cy - Math.round(r * 0.78), cx + Math.round(r * 0.25), cy - r, [60, 170, 70, 255], 2);
    _dotBlend(png, cx - Math.round(r * 0.2), cy - Math.round(r * 0.25), Math.round(r * 0.16), [255, 255, 255, 255], 0.45);
  } else if (name === 'Grape') {
    const purple = [130, 70, 170, 255];
    const pts = [[-0.3, -0.35], [0.3, -0.35], [0, -0.05], [-0.35, 0.3], [0.35, 0.3], [0, 0.55]];
    for (const [dx, dy] of pts) _dot(png, cx + Math.round(dx * r), cy + Math.round(dy * r), Math.round(r * 0.28), purple);
    _line(png, cx, cy - Math.round(r * 0.55), cx, cy - r, [60, 170, 70, 255], 2);
  } else if (name === 'Star') {
    const gold = [250, 210, 60, 255];
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      const rad = i % 2 === 0 ? r : r * 0.42;
      pts.push([cx + Math.round(Math.cos(ang) * rad), cy + Math.round(Math.sin(ang) * rad)]);
    }
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      _line(png, cx, cy, x1, y1, gold, 1);
      _line(png, x1, y1, x2, y2, gold, 3);
    }
  } else if (name === 'Diamond') {
    const teal = [70, 210, 210, 255], light = [180, 250, 250, 255];
    _line(png, cx, cy - r, cx - r, cy - Math.round(r * 0.15), teal, 3);
    _line(png, cx - r, cy - Math.round(r * 0.15), cx, cy + r, teal, 3);
    _line(png, cx, cy + r, cx + r, cy - Math.round(r * 0.15), teal, 3);
    _line(png, cx + r, cy - Math.round(r * 0.15), cx, cy - r, teal, 3);
    _line(png, cx, cy - r, cx, cy + r, light, 1);
  } else if (name === 'Seven') {
    const gold = [250, 200, 60, 255];
    _line(png, cx - r, cy - r, cx + r, cy - r, gold, 5);
    _line(png, cx + r, cy - r, cx - Math.round(r * 0.3), cy + r, gold, 5);
  } else if (name === 'Clover') {
    const green = [60, 190, 90, 255];
    const pts = [[0, -0.45], [-0.42, 0.22], [0.42, 0.22]];
    for (const [dx, dy] of pts) _dot(png, cx + Math.round(dx * r), cy + Math.round(dy * r), Math.round(r * 0.42), green);
    _line(png, cx, cy + Math.round(r * 0.3), cx, cy + Math.round(r * 1.1), [120, 90, 50, 255], 2);
  } else {
    _dot(png, cx, cy, r, [200, 200, 200, 255]);
  }
}

function renderSlotsPng(reels, spinning = [false, false, false]) {
  const W = 900, H = 420;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  _vGradientBg(png, [16, 12, 24, 255], [28, 20, 40, 255]);
  _ambientBackdrop(png, [
    [W / 2, H / 2, 320, [155, 89, 182, 255], 0.14],
    [110, 90, 160, [241, 196, 15, 255], 0.08],
  ]);

  _glassPanel(png, 40, 40, W - 80, H - 80, {
    radius: 26, tint: [155, 89, 182], tintAlpha: 0.06, tintAlphaBottom: 0.02, borderAlpha: 0.28,
  });

  const reelW = 220, reelH = 260, gap = 30;
  const startX = Math.floor((W - (reelW * 3 + gap * 2)) / 2);
  const reelY = 80;

  for (let i = 0; i < 3; i++) {
    const rx = startX + i * (reelW + gap);
    _glassPanel(png, rx, reelY, reelW, reelH, {
      radius: 20, tint: [10, 8, 16], tintAlpha: 0.35, tintAlphaBottom: 0.25, border: [241, 196, 15], borderAlpha: 0.35,
    });
    const cx = rx + reelW / 2, cy = reelY + reelH / 2;
    if (spinning[i]) {
      // Motion-blur look: several faded icons offset vertically.
      for (let k = -1; k <= 1; k++) {
        _drawSlotIcon(png, SLOT_SYMS[(i + k + SLOT_SYMS.length * 3) % SLOT_SYMS.length], cx, cy + k * 70, 46);
      }
      for (let yy = reelY; yy < reelY + reelH; yy += 3) _hLineBlend(png, yy, rx + 8, rx + reelW - 8, [255, 255, 255, 255], 0.03, 1);
    } else {
      _radialGlow(png, cx, cy, 90, [241, 196, 15, 255], 0.12);
      _drawSlotIcon(png, reels[i], cx, cy, 56);
    }
  }

  // Payline
  const lineY = reelY + reelH / 2;
  const allRevealed = spinning.every(v => !v);
  const won = allRevealed && reels[0].e === reels[1].e && reels[1].e === reels[2].e;
  _hLineBlend(png, lineY, startX - 10, startX + reelW * 3 + gap * 2 + 10, won ? [46, 204, 113, 255] : [241, 196, 15, 255], won ? 0.65 : 0.35, won ? 3 : 2);

  return PNG.sync.write(png);
}

/* ─── CRASH (glass line chart with glow trail) ──────────────────────────── */

function renderCrashChart(tick, crashed = false) {
  const W = 900, H = 420;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  _vGradientBg(png, [10, 14, 24, 255], [18, 14, 26, 255]);
  _ambientBackdrop(png, [[W - 120, 90, 220, crashed ? [231, 76, 60, 255] : [52, 152, 219, 255], 0.16]]);

  const margin = { top: 30, right: 34, bottom: 30, left: 34 };
  _glassPanel(png, margin.left - 14, margin.top - 14, W - margin.left - margin.right + 28, H - margin.top - margin.bottom + 28, {
    radius: 20, tintAlpha: 0.05, tintAlphaBottom: 0.02, borderAlpha: 0.2,
  });

  const pw = W - margin.left - margin.right, ph = H - margin.top - margin.bottom;
  const maxTick = Math.max(tick, 4);
  const maxMultY = Math.pow(TICK_GROWTH, maxTick) * 1.18;

  for (let g = 1; g <= 4; g++) {
    const gy = margin.top + Math.round((g / 5) * ph);
    for (let x = margin.left; x < margin.left + pw; x += 5) _setPxBlend(png, x, gy, [255, 255, 255, 255], 0.05);
  }

  const xOf = t => margin.left + Math.round((t / maxTick) * pw);
  // Linear (not log) multiplier scale so the exponential growth actually
  // reads as an accelerating curve, matching the classic crash-game look.
  const yOf = m => margin.top + Math.round((1 - ((m - 1) / (maxMultY - 1))) * ph);

  const trailColor = crashed ? [255, 107, 107, 255] : [52, 211, 235, 255];
  let px = xOf(0), py = yOf(1);
  for (let t = 1; t <= tick; t++) {
    const m = tickMultiplier(t);
    const x = xOf(t), y = yOf(m);
    _lineBlend(png, px, py, x, y, trailColor, 0.9, 4);
    _radialGlow(png, x, y, 14, trailColor, 0.12);
    px = x; py = y;
  }

  if (crashed) {
    _radialGlow(png, px, py, 46, [255, 60, 60, 255], 0.55);
    _dot(png, px, py, 8, [255, 255, 255, 255]);
    _dot(png, px, py, 5, [231, 76, 60, 255]);
  } else {
    _radialGlow(png, px, py, 26, [120, 230, 255, 255], 0.4);
    // little plane marker: a bright triangle nose pointing along the trend
    const nose = [px + 10, py - 8], w1 = [px - 6, py + 6], w2 = [px - 2, py - 4];
    _line(png, nose[0], nose[1], w1[0], w1[1], [255, 255, 255, 255], 2);
    _line(png, nose[0], nose[1], w2[0], w2[1], [255, 255, 255, 255], 2);
    _line(png, w1[0], w1[1], w2[0], w2[1], [255, 255, 255, 255], 2);
  }

  return PNG.sync.write(png);
}

/* ─── RACE (glass lanes with hand-drawn racer silhouettes) ──────────────── */

function _drawRacer(png, x, y, isHorse, color) {
  if (isHorse) {
    _fillRect(png, x - 14, y - 8, 24, 12, color);
    _line(png, x + 10, y - 8, x + 18, y - 16, color, 4);
    _line(png, x - 14, y + 4, x - 14, y + 14, color, 3);
    _line(png, x - 6, y + 4, x - 6, y + 14, color, 3);
    _line(png, x + 4, y + 4, x + 4, y + 14, color, 3);
    _line(png, x + 12, y + 4, x + 12, y + 14, color, 3);
  } else {
    _dot(png, x, y, 12, color);
    _dot(png, x + 14, y - 2, 6, color);
    _line(png, x - 8, y + 8, x - 12, y + 14, color, 3);
    _line(png, x + 6, y + 8, x + 10, y + 14, color, 3);
  }
}

const RACER_COLORS = [
  [231, 76, 60, 255], [52, 152, 219, 255], [46, 204, 113, 255],
  [241, 196, 15, 255], [155, 89, 182, 255],
];

function renderRaceTrack(racers, progress, winnerIdx, picked) {
  const isHorse = racers[0]?.emoji === '🐎';
  const W = 960, laneH = 74, top = 60;
  const H = top + laneH * racers.length + 40;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  _vGradientBg(png, isHorse ? [26, 20, 12, 255] : [10, 26, 18, 255], isHorse ? [16, 12, 8, 255] : [8, 18, 14, 255]);
  _ambientBackdrop(png, [[W - 100, top, 260, isHorse ? [230, 126, 34, 255] : [39, 174, 96, 255], 0.14]]);

  const trackX = 60, trackW = W - 120;

  racers.forEach((r, i) => {
    const ly = top + i * laneH;
    const color = RACER_COLORS[i % RACER_COLORS.length];
    const isWinner = i === winnerIdx, isPicked = i === picked;
    _glassPanel(png, trackX, ly, trackW, laneH - 12, {
      radius: 14, tint: [255, 255, 255], tintAlpha: 0.05, tintAlphaBottom: 0.02,
      border: isWinner ? [241, 196, 15] : isPicked ? [120, 200, 255] : [255, 255, 255],
      borderAlpha: isWinner ? 0.55 : isPicked ? 0.4 : 0.16,
    });
    const pct = Math.max(0, Math.min(100, progress[i] || 0)) / 100;
    const fillW = Math.round((trackW - 16) * pct);
    if (fillW > 2) _fillRectBlend(png, trackX + 8, ly + (laneH - 12) / 2 - 5, fillW, 10, color, 0.5);
    const racerX = trackX + 20 + fillW, racerY = ly + (laneH - 12) / 2;
    if (isWinner) _radialGlow(png, racerX, racerY, 30, [241, 196, 15, 255], 0.35);
    _drawRacer(png, racerX, racerY, isHorse, color);
  });

  // finish line
  const finishX = trackX + trackW - 8;
  for (let y = top; y < top + laneH * racers.length - 12; y += 8) {
    _fillRectBlend(png, finishX, y, 4, 4, [255, 255, 255, 255], 0.6);
    _fillRectBlend(png, finishX, y + 4, 4, 4, [20, 20, 20, 255], 0.6);
  }

  return PNG.sync.write(png);
}

/* ─── WHEEL OF FORTUNE (real spinning prize wheel) ──────────────────────── */

const WHEEL_SEGMENTS = [
  { id: 'bankrupt', label: '💀 Bankrupt',  mult: 0,    weight: 3,   color: 'lose'    },
  { id: 'push',     label: '🔄 Push',      mult: 1,    weight: 2,   color: 'push'    },
  { id: 'x1_5',     label: '💵 1.5×',      mult: 1.5,  weight: 4,   color: 'win'     },
  { id: 'x2',       label: '💰 2×',        mult: 2,    weight: 3,   color: 'win'     },
  { id: 'x3',       label: '💎 3×',        mult: 3,    weight: 2,   color: 'win'     },
  { id: 'x5',       label: '🌟 5×',        mult: 5,    weight: 1,   color: 'bigwin'  },
  { id: 'x10',      label: '🚀 10×',       mult: 10,   weight: 0.3, color: 'jackpot' },
  { id: 'x25',      label: '🎊 25×',       mult: 25,   weight: 0.07,color: 'jackpot' },
];

const WHEEL_TOTAL_W = WHEEL_SEGMENTS.reduce((s, x) => s + x.weight, 0);
const WHEEL_SEG_COLOR = {
  lose:    [148, 40, 40, 255],
  push:    [90, 96, 110, 255],
  win:     [30, 140, 90, 255],
  bigwin:  [45, 90, 200, 255],
  jackpot: [200, 150, 30, 255],
};

function spinWheel() {
  let r = _rand() * WHEEL_TOTAL_W;
  for (const seg of WHEEL_SEGMENTS) { r -= seg.weight; if (r <= 0) return seg; }
  return WHEEL_SEGMENTS[0];
}

function renderWheelPng(winner, spinning = false) {
  const W = 640, H = 640;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  _vGradientBg(png, [12, 16, 26, 255], [20, 16, 30, 255]);

  const cx = W / 2, cy = H / 2, R = 260;
  const n = WHEEL_SEGMENTS.length;
  const winIdx = winner ? WHEEL_SEGMENTS.indexOf(winner) : -1;

  _ambientBackdrop(png, [[cx, cy, R + 60, [241, 196, 15, 255], spinning ? 0.10 : 0.16]]);

  for (let py = cy - R - 6; py <= cy + R + 6; py++) {
    for (let pxl = cx - R - 6; pxl <= cx + R + 6; pxl++) {
      const dx = pxl - cx, dy = py - cy, d = Math.hypot(dx, dy);
      if (d > R + 6) continue;
      if (d > R) { _setPx(png, pxl, py, [200, 165, 55, 255]); continue; } // gold rim
      if (d < 26) { _setPx(png, pxl, py, [18, 14, 10, 255]); continue; }  // hub
      if (d < 32) { _setPx(png, pxl, py, [200, 165, 55, 255]); continue; }

      let ang = Math.atan2(dy, dx) + Math.PI / 2;
      if (ang < 0) ang += 2 * Math.PI;
      const idx = Math.floor((ang / (2 * Math.PI)) * n) % n;
      const frac = (ang - idx * (2 * Math.PI / n)) / (2 * Math.PI / n);
      if (frac < 0.02 || frac > 0.98) { _setPx(png, pxl, py, [200, 165, 55, 255]); continue; }

      const seg = WHEEL_SEGMENTS[idx];
      const base = WHEEL_SEG_COLOR[seg.color] || [80, 80, 80, 255];
      const isWin = !spinning && idx === winIdx;
      const shade = isWin ? base.map((v, k) => k < 3 ? Math.min(255, v + 60) : v) : base;
      _setPx(png, pxl, py, shade);
      if (isWin) _setPxBlend(png, pxl, py, [255, 255, 255, 255], 0.10);
    }
  }

  // Pointer at top
  const pW = 22;
  _line(png, cx - pW, cy - R - 4, cx + pW, cy - R - 4, [255, 255, 255, 255], 2);
  _line(png, cx - pW, cy - R - 4, cx, cy - R + 26, [255, 255, 255, 255], 4);
  _line(png, cx + pW, cy - R - 4, cx, cy - R + 26, [255, 255, 255, 255], 4);
  _dot(png, cx, cy - R - 4, 6, [231, 76, 60, 255]);

  if (spinning) {
    for (let a = 0; a < 360; a += 3) {
      const rad = a * Math.PI / 180;
      _dotBlend(png, Math.round(cx + Math.cos(rad) * (R + 20)), Math.round(cy + Math.sin(rad) * (R + 20)), 4, [255, 255, 255, 255], 0.10);
    }
  } else if (winner) {
    _radialGlow(png, cx, cy - R + 30, 40, [255, 255, 255, 255], 0.25);
  }

  return PNG.sync.write(png);
}

/* ─── DICE (glass 3D-style pip dice) ─────────────────────────────────────── */

const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function rollDie() { return _randInt(6) + 1; }

function randomDiceOdds() {
  const opts = [1.5, 1.6, 1.8, 2.0, 2.2, 2.5];
  return opts[_randInt(opts.length)];
}

function playDiceVsBot(odds) {
  let p = rollDie(), b = rollDie();
  if (p === b) { p = rollDie(); b = rollDie(); }
  return { playerRoll: p, botRoll: b, won: p > b, push: p === b, odds };
}

const PIP_LAYOUT = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

function _drawDie(png, x, y, size, value, glow) {
  if (glow) _radialGlow(png, x + size / 2, y + size / 2, size * 0.85, glow, 0.35);
  _fillRectBlend(png, x + 5, y + 8, size, size, [0, 0, 0, 255], 0.3);
  _glassPanel(png, x, y, size, size, { radius: 16, tint: [255, 255, 255], tintAlpha: 0.85, tintAlphaBottom: 0.7, border: glow || [255, 255, 255], borderAlpha: 0.5 });
  const step = size * 0.27;
  const cx = x + size / 2, cy = y + size / 2;
  for (const [dx, dy] of PIP_LAYOUT[value] || []) {
    _dot(png, Math.round(cx + dx * step), Math.round(cy + dy * step), Math.round(size * 0.08), [30, 34, 44, 255]);
  }
}

function renderDicePng(playerRoll, botRoll, outcome) {
  const W = 700, H = 340;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  const glowColor = outcome === 'win' ? [46, 204, 113, 255] : outcome === 'push' ? [149, 165, 166, 255] : [231, 76, 60, 255];
  _vGradientBg(png, [16, 12, 24, 255], [24, 18, 34, 255]);
  _ambientBackdrop(png, [[W / 2, H / 2, 300, glowColor, 0.14]]);
  _glassPanel(png, 30, 30, W - 60, H - 60, { radius: 24, tintAlpha: 0.05, tintAlphaBottom: 0.02, borderAlpha: 0.2 });

  const size = 140;
  _drawDie(png, W / 2 - size - 40, H / 2 - size / 2, size, playerRoll, outcome === 'win' ? [46, 204, 113, 255] : null);
  _drawDie(png, W / 2 + 40, H / 2 - size / 2, size, botRoll, outcome === 'loss' ? [231, 76, 60, 255] : null);

  const vsX = W / 2, vsY = H / 2;
  _dotBlend(png, vsX, vsY, 26, [255, 255, 255, 255], 0.10);
  _line(png, vsX - 8, vsY - 10, vsX + 8, vsY + 10, [255, 255, 255, 255], 3);
  _line(png, vsX + 8, vsY - 10, vsX - 8, vsY + 10, [255, 255, 255, 255], 3);

  return PNG.sync.write(png);
}

/* ─── TRADING: real candlesticks in a glass panel ───────────────────────── */

function _renderTradeChartPng({
  historical,
  future = [],
  entryPrice,
  sl = null,
  tp = null,
  finalIndex = null,
  won = null,
}) {
  const W = 980, H = 460;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  _vGradientBg(png, [10, 14, 24, 255], [16, 20, 32, 255]);
  _ambientBackdrop(png, [[W - 140, 80, 220, won === false ? [231, 76, 60, 255] : [46, 213, 145, 255], 0.10]]);

  const margin = { top: 30, right: 26, bottom: 28, left: 26 };
  _glassPanel(png, margin.left - 14, margin.top - 14, W - margin.left - margin.right + 28, H - margin.top - margin.bottom + 28, {
    radius: 20, tintAlpha: 0.045, tintAlphaBottom: 0.015, borderAlpha: 0.18,
  });

  const pw = W - margin.left - margin.right;
  const ph = H - margin.top - margin.bottom;

  const histCandles   = _toCandles(historical, CANDLE_GROUP);
  const futureCandles = _toCandles(future, CANDLE_GROUP);
  const totalCandles  = Math.max(2, histCandles.length + futureCandles.length);

  const allPrices = [...historical, ...future];
  if (entryPrice != null) allPrices.push(entryPrice);
  if (sl != null) allPrices.push(sl);
  if (tp != null) allPrices.push(tp);
  const minP = Math.min(...allPrices), maxP = Math.max(...allPrices);
  const pad = (maxP - minP || 1) * 0.18;
  const yMin = minP - pad, yMax = maxP + pad, yRange = yMax - yMin || 1;

  const slot = pw / totalCandles;
  const bodyW = Math.max(3, Math.floor(slot * 0.56));
  const xOf = i => margin.left + Math.round(i * slot + slot / 2);
  const yOf = v => margin.top + Math.round((1 - (v - yMin) / yRange) * ph);

  for (let g = 1; g <= 4; g++) {
    const gy = margin.top + Math.round((g / 5) * ph);
    for (let x = margin.left; x < margin.left + pw; x += 5) _setPxBlend(png, x, gy, [255, 255, 255, 255], 0.05);
  }

  if (futureCandles.length) {
    const histEndX = xOf(histCandles.length - 1) + Math.round(slot / 2);
    for (let y = margin.top; y < margin.top + ph; y += 3) _setPxBlend(png, histEndX, y, [255, 255, 255, 255], 0.16);
  }

  if (entryPrice != null) _hLineBlend(png, yOf(entryPrice), margin.left, margin.left + pw, [255, 255, 255, 255], 0.4, 1);
  if (tp != null) _hLineBlend(png, yOf(tp), margin.left, margin.left + pw, [46, 204, 113, 255], 0.8, 2);
  if (sl != null) _hLineBlend(png, yOf(sl), margin.left, margin.left + pw, [231, 76, 60, 255], 0.8, 2);

  const drawCandle = (i, c, isFuture) => {
    const x = xOf(i);
    const bull = c.close >= c.open;
    const color = isFuture
      ? (won === false ? [255, 107, 107, 255] : won === true ? [46, 213, 145, 255] : (bull ? [46, 213, 145, 255] : [255, 107, 107, 255]))
      : (bull ? [86, 176, 245, 255] : [110, 130, 170, 255]);
    const yHigh = yOf(c.high), yLow = yOf(c.low);
    const yOpen = yOf(c.open), yClose = yOf(c.close);
    _line(png, x, yHigh, x, yLow, color, 1);
    const bodyTop = Math.min(yOpen, yClose), bodyH = Math.max(2, Math.abs(yClose - yOpen));
    _fillRect(png, x - Math.floor(bodyW / 2), bodyTop, bodyW, bodyH, color);
  };

  histCandles.forEach((c, i) => drawCandle(i, c, false));
  futureCandles.forEach((c, i) => drawCandle(histCandles.length + i, c, true));

  if (futureCandles.length) {
    const markerCandleIdx = finalIndex == null
      ? futureCandles.length - 1
      : _clamp(Math.floor(finalIndex / CANDLE_GROUP), 0, futureCandles.length - 1);
    const mc = futureCandles[markerCandleIdx];
    const markerX = xOf(histCandles.length + markerCandleIdx);
    const markerY = yOf(mc.close);
    const markerColor = won ? [46, 204, 113, 255] : won === false ? [231, 76, 60, 255] : [241, 196, 15, 255];
    _radialGlow(png, markerX, markerY, 20, markerColor, 0.55);
    _dot(png, markerX, markerY, 5, markerColor);
    _dot(png, markerX, markerY, 2, [255, 255, 255, 255]);
  }

  return PNG.sync.write(png);
}

function generateChart({ bet = 0, userId = 'anon' } = {}) {
  const entropy = `${userId}:${bet}:${Date.now()}:${randomInt(0, 1_000_000)}`;
  const seed = _hashSeed(entropy);
  const rng = _mulberry32(seed);
  const positionSize = _clamp(1 + (Number(bet) || 0) / 2500, 1, 25);
  const start = 500 + rng() * 1500;
  const drift = (rng() - 0.5) * 0.002;
  const historical = _buildPricePath(rng, start, TRADING_GUARDRAILS.HIST_POINTS, TRADING_GUARDRAILS.MAX_MOVE_PCT, drift);
  const future = _buildPricePath(rng, historical[historical.length - 1], TRADING_GUARDRAILS.FUTURE_POINTS, TRADING_GUARDRAILS.MAX_MOVE_PCT, drift * 0.6).slice(1);
  const entryPrice = historical[historical.length - 1];
  const atr = _calcATR(historical);
  const riskUnit = Math.max(entryPrice * 0.01, atr * (1.15 + Math.log10(positionSize + 1) * 0.55));
  const spread = entryPrice * (TRADING_GUARDRAILS.SPREAD_BPS / 10000);
  const slippage = entryPrice * (TRADING_GUARDRAILS.BASE_SLIPPAGE_BPS / 10000) * (1 + Math.min(1.5, positionSize / 12));
  const tradeId = `${seed.toString(16)}-${Math.floor(rng() * 1_000_000).toString(16)}`;
  return {
    tradeId,
    seed,
    historical,
    future,
    entryPrice,
    riskUnit,
    positionSize: Number(positionSize.toFixed(2)),
    spread,
    slippage,
    setupChartPng: _renderTradeChartPng({ historical, entryPrice }),
  };
}

function resolveTradeWithChart(tradeState, direction, rr, bet = 0) {
  if (direction !== 'buy' && direction !== 'sell') return { validation: { ok: false, reason: 'Invalid direction.' } };
  const valid = tradeState && Array.isArray(tradeState.historical) && Array.isArray(tradeState.future)
    && Number.isFinite(tradeState.entryPrice) && Number.isFinite(tradeState.riskUnit)
    && typeof tradeState.tradeId === 'string' && Number(tradeState.positionSize) >= 1;
  if (!valid) return { validation: { ok: false, reason: 'Invalid trade state.' } };

  // Exact RR economics — no randomness layered on the payout multiplier.
  // 1:1 → win pays 2×, 1:2 → 3×, 1:3 → 4× (stake back + R× reward).
  const rrReward = RR_REWARD[rr] || 1;
  const mult = RR_MULTIPLIER[rr] || 2;
  const isBuy = direction === 'buy';
  const spreadHalf = (tradeState.spread || 0) / 2;
  const slippage = tradeState.slippage || 0;
  const stateBet = Number(bet) || 0;
  const entryPrice = tradeState.entryPrice + (isBuy ? spreadHalf : -spreadHalf);
  const sl = isBuy ? entryPrice - tradeState.riskUnit : entryPrice + tradeState.riskUnit;
  const tp = isBuy ? entryPrice + tradeState.riskUnit * rrReward : entryPrice - tradeState.riskUnit * rrReward;

  let hitType = null;
  let hitIndex = tradeState.future.length - 1;
  for (let i = 0; i < tradeState.future.length; i++) {
    const p = tradeState.future[i];
    if (isBuy && p >= tp) { hitType = 'tp'; hitIndex = i; break; }
    if (isBuy && p <= sl) { hitType = 'sl'; hitIndex = i; break; }
    if (!isBuy && p <= tp) { hitType = 'tp'; hitIndex = i; break; }
    if (!isBuy && p >= sl) { hitType = 'sl'; hitIndex = i; break; }
  }

  const won = hitType === 'tp';
  const stopped = hitType === 'sl';
  const finalRaw = tradeState.future[hitIndex];
  const finalPrice = won
    ? (isBuy ? Math.max(tp - slippage, finalRaw) : Math.min(tp + slippage, finalRaw))
    : stopped
      ? (isBuy ? Math.min(sl - slippage, finalRaw) : Math.max(sl + slippage, finalRaw))
      : finalRaw;

  const visibleFuture = tradeState.future.slice(0, hitIndex + 1);
  if (visibleFuture.length > 0) visibleFuture[visibleFuture.length - 1] = finalPrice;

  const chartPng = _renderTradeChartPng({
    historical: tradeState.historical,
    future: visibleFuture,
    entryPrice,
    sl,
    tp,
    finalIndex: visibleFuture.length - 1,
    won: hitType ? won : null,
  });

  return {
    won,
    isBuy,
    sl,
    tp,
    rrReward,
    multiplier: mult,
    entryPrice,
    finalPrice,
    hitType: hitType || 'timeout',
    tradeId: tradeState.tradeId,
    positionSize: tradeState.positionSize,
    spread: tradeState.spread || 0,
    slippage,
    bet: stateBet,
    chartPng,
    validation: { ok: true },
  };
}

/* ─── ROULETTE (secure RNG; glass-consistent styling) ───────────────────── */

const ROULETTE_RED   = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const ROULETTE_BLACK = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]);

function spinRoulette() {
  const num   = randomInt(37);
  const color = num === 0 ? 'green' : ROULETTE_RED.has(num) ? 'red' : 'black';
  return { num, color };
}

function rouletteResult(spin, betType, betValue) {
  const { num, color } = spin;
  switch (betType) {
    case 'red':    return { won: color === 'red',                         mult: 2 };
    case 'black':  return { won: color === 'black',                       mult: 2 };
    case 'odd':    return { won: num > 0 && num % 2 !== 0,                mult: 2 };
    case 'even':   return { won: num > 0 && num % 2 === 0,                mult: 2 };
    case '1-12':   return { won: num >= 1  && num <= 12,                  mult: 3 };
    case '13-24':  return { won: num >= 13 && num <= 24,                  mult: 3 };
    case '25-36':  return { won: num >= 25 && num <= 36,                  mult: 3 };
    case 'straight': return { won: parseInt(betValue, 10) === num,        mult: 36 };
    default:       return { won: false, mult: 0 };
  }
}

function renderRoulettePng({ num, color, won }) {
  const W = 980, H = 460;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  _vGradientBg(png, [10, 13, 22, 255], [15, 19, 30, 255]);
  _ambientBackdrop(png, [[230, 230, 260, [200, 165, 55, 255], 0.10]]);

  const WHEEL  = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  const N      = 37;
  const SLICE  = (2 * Math.PI) / N;
  const winIdx = WHEEL.indexOf(num);
  const GOLD   = [200, 165, 55, 255];
  const cx = 230, cy = 230;

  for (let py = cy - 215; py <= cy + 215; py++) {
    for (let px = cx - 215; px <= cx + 215; px++) {
      if (px < 0 || px >= 490 || py < 0 || py >= H) continue;
      const dx = px - cx, dy = py - cy;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d > 212) continue;

      if (d > 200) { _setPx(png, px, py, GOLD); continue; }
      if (d > 188) { _setPx(png, px, py, [16, 20, 32, 255]); continue; }
      if (d > 182) { _setPx(png, px, py, GOLD); continue; }
      if (d < 72)  { _setPx(png, px, py, [14, 18, 28, 255]); continue; }
      if (d < 80)  { _setPx(png, px, py, GOLD); continue; }

      let cw = Math.atan2(dy, dx) + Math.PI / 2;
      if (cw < 0) cw += 2 * Math.PI;
      else if (cw >= 2 * Math.PI) cw -= 2 * Math.PI;

      const pIdx = Math.floor(cw / SLICE) % N;
      const frac = (cw - pIdx * SLICE) / SLICE;
      if (frac < 0.05 || frac > 0.95) { _setPx(png, px, py, GOLD); continue; }

      const n = WHEEL[pIdx], isWin = (n === num);
      let pc;
      if (n === 0)                  pc = isWin ? [38, 220, 105, 255] : [15, 105, 45, 255];
      else if (ROULETTE_RED.has(n)) pc = isWin ? [255, 72, 72, 255]  : [148, 28, 28, 255];
      else                          pc = isWin ? [115, 120, 135, 255] : [20, 22, 30, 255];
      _setPx(png, px, py, pc);
    }
  }

  const bAng = (winIdx + 0.5) * SLICE - Math.PI / 2;
  const bx = Math.round(cx + Math.cos(bAng) * 194);
  const by = Math.round(cy + Math.sin(bAng) * 194);
  _dot(png, bx, by, 10, [255, 255, 255, 255]);
  _dot(png, bx, by,  7, [241, 196, 15, 255]);
  _dot(png, bx, by,  3, [255, 255, 255, 255]);

  for (let sy = 18; sy < H - 18; sy++) _setPxBlend(png, 488, sy, [255, 255, 255, 255], 0.14);

  const rcx = 735, rcy = 150;
  const glowC = won ? [46, 204, 113, 255] : [231, 76, 60, 255];
  const ringC = color === 'green' ? [30, 200, 90, 255]
              : color === 'red'   ? [215, 52, 52, 255]
              :                     [72, 76, 92, 255];
  const fillC = color === 'green' ? [14, 106, 48, 255]
              : color === 'red'   ? [126, 22, 22, 255]
              :                     [30, 32, 46, 255];
  _radialGlow(png, rcx, rcy, 110, glowC, 0.4);
  _dot(png, rcx, rcy, 83, ringC);
  _dot(png, rcx, rcy, 67, fillC);
  _dot(png, rcx, rcy, 18, [255, 255, 255, 255]);
  _dot(png, rcx, rcy,  9, [12, 17, 28, 255]);

  const TY = 328, TX0 = 543, TGAP = 64;
  for (let i = 0; i < 7; i++) {
    const ni = ((winIdx + (i - 3)) % N + N) % N;
    const nn = WHEEL[ni], isCenter = (i === 3);
    const tcx = TX0 + i * TGAP, tRad = isCenter ? 25 : 17;
    let tc;
    if (nn === 0)                  tc = isCenter ? [38, 220, 105, 255] : [14, 110, 48, 255];
    else if (ROULETTE_RED.has(nn)) tc = isCenter ? [255, 72, 72, 255]  : [160, 28, 28, 255];
    else                           tc = isCenter ? [115, 120, 135, 255] : [28, 28, 40, 255];
    _dot(png, tcx, TY, tRad, tc);
    if (isCenter) {
      for (let a = 0; a < 360; a += 2) {
        const gx = Math.round(tcx + Math.cos(a * Math.PI / 180) * (tRad + 6));
        const gy = Math.round(TY  + Math.sin(a * Math.PI / 180) * (tRad + 6));
        if (gx >= 0 && gx < W && gy >= 0 && gy < H) _setPx(png, gx, gy, GOLD);
      }
    }
  }

  _glassPanel(png, 506, 385, 455, 58, {
    radius: 14, tint: won ? [46, 204, 113] : [176, 36, 36], tintAlpha: 0.55, tintAlphaBottom: 0.4,
    border: [255, 255, 255], borderAlpha: 0.5,
  });
  if (won) {
    _line(png, 536, 415, 558, 435, [255, 255, 255, 255], 4);
    _line(png, 558, 435, 595, 400, [255, 255, 255, 255], 4);
  } else {
    _line(png, 534, 397, 590, 437, [255, 255, 255, 255], 4);
    _line(png, 534, 437, 590, 397, [255, 255, 255, 255], 4);
  }

  return PNG.sync.write(png);
}

/* ─── BLACKJACK CARD ART (plain-text fallback, kept for compatibility) ──── */

function _cardLines(card, faceDown = false) {
  if (faceDown) return ['┌────┐', '│▒▒▒▒│', '│▒▒▒▒│', '│▒▒▒▒│', '└────┘'];
  const suit = card.s.replace(/️/g, '');
  const r = card.r;
  return ['┌────┐', `│${r.padEnd(4)}│`, `│ ${suit}  │`, `│${r.padStart(4)}│`, '└────┘'];
}

function renderHandArt(cards, faceDownIndices = []) {
  const cls = cards.map((c, i) => _cardLines(c, faceDownIndices.includes(i)));
  return Array.from({ length: 5 }, (_, row) => cls.map(cl => cl[row]).join(' ')).join('\n');
}

module.exports = {
  shuffle, coinflip,
  dealBJ, bjHit, bjDouble, bjStand, bjSplit, bjFirstHandDone,
  bjInsure, bjDeclineInsure, canSplit, canInsure, dealerPlay,
  bjResult, bjResultHand, handVal, isSoft, cStr, hStr, renderHandArt,
  renderBlackjackTablePng, renderCoinflipPng,
  SLOT_SYMS, spinSlots, renderSlotsPng,
  generateCrashPoint, tickMultiplier, renderCrashChart, TICK_MS, TICK_GROWTH,
  HORSES, TURTLES, runRace, renderRaceTrack,
  generateChart, resolveTradeWithChart, RR_REWARD, RR_MULTIPLIER,
  spinRoulette, rouletteResult, renderRoulettePng, ROULETTE_RED, ROULETTE_BLACK,
  WHEEL_SEGMENTS, spinWheel, renderWheelPng,
  DICE_FACES, rollDie, randomDiceOdds, playDiceVsBot, renderDicePng,
};
