'use strict';

// ────────────────────────────────────────────────────────────────
// Casino Engine — pure game logic (no Discord, no side-effects)
// ────────────────────────────────────────────────────────────────

const { PNG } = require('pngjs');

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─── COINFLIP (true 50/50) ─────────────────────────────────────────────── */

function coinflip(choice) {
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
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
  let r = Math.random() * SLOT_TOTAL_W;
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

function renderSlotsDisplay(reels, spinning = [false, false, false]) {
  const cells = reels.map((r, i) => spinning[i] ? '🎰' : r.e);
  return [
    '```',
    '┌────────────────────┐',
    `│  ${cells[0]}  │  ${cells[1]}  │  ${cells[2]}  │`,
    '└────────────────────┘',
    '```',
  ].join('\n');
}

/* ─── CRASH ────────────────────────────────────────────────────────────── */

function generateCrashPoint() {
  if (Math.random() < 0.01) return 1.00; // 1% instant crash
  const r = Math.random() * 0.97;
  return Math.max(1.01, parseFloat((0.99 / (1 - r)).toFixed(2)));
}

const TICK_MS       = 2500; // 2.5 seconds per tick
const TICK_GROWTH   = 1.12; // each tick multiplies by 1.12

function tickMultiplier(tick) {
  return parseFloat(Math.pow(TICK_GROWTH, tick).toFixed(2));
}

function renderCrashChart(tick, crashed, cashOutTick, crashTick) {
  const COLS   = 20;
  const ROWS   = 8;
  const maxTick = Math.max(tick, 3);
  const grid    = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));

  for (let t = 0; t <= Math.min(tick, maxTick); t++) {
    const x = Math.round((t / maxTick) * (COLS - 1));
    const yFrac = Math.min(1, Math.pow(TICK_GROWTH, t) / (Math.pow(TICK_GROWTH, maxTick) * 1.1));
    const y     = ROWS - 1 - Math.round(yFrac * (ROWS - 1));
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) grid[y][x] = t === tick && crashed ? '💥' : '•';
  }

  const lines = grid.map((row, i) => {
    const border = i === ROWS - 1 ? '└' : '│';
    return border + row.join('');
  });
  lines[ROWS - 1] = '└' + '─'.repeat(COLS);
  return '```\n' + lines.join('\n') + '\n```';
}

/* ─── RACE ─────────────────────────────────────────────────────────────── */

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
  const speeds    = racers.map(() => Math.random() * 0.6 + Math.random() * 0.4);
  const maxSpeed  = Math.max(...speeds);
  const winnerIdx = speeds.indexOf(maxSpeed);
  const progress  = speeds.map(s => Math.min(99, Math.round((s / maxSpeed) * 88 + 8)));
  progress[winnerIdx] = 100;
  return { winnerIdx, progress };
}

function renderRaceTrack(racers, progress, winnerIdx, picked) {
  const TRACK = 20;
  const lines  = ['```'];
  lines.push('🏁 ─────────────────────────────');
  for (let i = 0; i < racers.length; i++) {
    const r    = racers[i];
    const pct  = progress[i];
    const filled = Math.round((pct / 100) * TRACK);
    const empty  = TRACK - filled;
    const bar    = '█'.repeat(filled) + '░'.repeat(empty);
    const medal  = i === winnerIdx ? ' 🥇' : '';
    const arrow  = i === picked    ? ' ← YOU' : '';
    lines.push(`${r.emoji}${r.id} ${r.name.padEnd(7)} ${bar}${medal}${arrow}`);
  }
  lines.push('────────────────────────────────');
  lines.push('```');
  return lines.join('\n');
}

/* ─── TRADING ─────────────────────────────────────────────────────────── */

const RR_REWARD      = { '1:1': 1, '1:2': 2, '1:3': 3 };
const RR_MULTIPLIER  = { '1:1': 2, '1:2': 3, '1:3': 4 };
const TRADING_GUARDRAILS = {
  SPREAD_BPS: 5,
  BASE_SLIPPAGE_BPS: 3,
  MAX_MOVE_PCT: 0.022,
  HIST_POINTS: 34,
  FUTURE_POINTS: 26,
};

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

function _setPx(png, x, y, c) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) * 4;
  png.data[i] = c[0];
  png.data[i + 1] = c[1];
  png.data[i + 2] = c[2];
  png.data[i + 3] = c[3];
}

function _fillRect(png, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) _setPx(png, xx, yy, c);
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

function _line(png, x1, y1, x2, y2, c, th = 1) {
  const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
  let err = dx + dy, x = x1, y = y1;
  while (true) {
    for (let tx = -Math.floor(th / 2); tx <= Math.floor(th / 2); tx++) {
      for (let ty = -Math.floor(th / 2); ty <= Math.floor(th / 2); ty++) _setPx(png, x + tx, y + ty, c);
    }
    if (x === x2 && y === y2) break;
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

function _dot(png, x, y, radius, c) {
  const r2 = radius * radius;
  for (let yy = -radius; yy <= radius; yy++) {
    for (let xx = -radius; xx <= radius; xx++) {
      if ((xx * xx) + (yy * yy) <= r2) _setPx(png, x + xx, y + yy, c);
    }
  }
}

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

function _drawCard(png, x, y, card, faceDown = false) {
  const w = 98; const h = 138;
  _fillRect(png, x, y, w, h, [244, 246, 249, 255]);
  _rect(png, x, y, w, h, [130, 146, 166, 255], 2);
  _fillRect(png, x + 4, y + 4, w - 8, h - 8, [255, 255, 255, 255]);

  if (faceDown) {
    _fillRect(png, x + 10, y + 10, w - 20, h - 20, [41, 128, 185, 255]);
    for (let yy = y + 12; yy < y + h - 12; yy += 8) {
      _line(png, x + 12, yy, x + w - 12, yy, [174, 214, 241, 255], 1);
    }
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

  _fillRect(png, 0, 0, W, H, [12, 60, 40, 255]);
  _rect(png, 12, 12, W - 24, H - 24, [241, 196, 15, 255], 3);
  _line(png, 20, 260, W - 20, 260, [22, 160, 133, 255], 2);

  dealer.slice(0, 6).forEach((c, i) => _drawCard(png, 210 + (i * 108), 72, c, hideDealerHole && i === 1));

  if (splitHand && splitHand.length) {
    player.slice(0, 6).forEach((c, i) => _drawCard(png, 120 + (i * 84), 330, c, false));
    splitHand.slice(0, 6).forEach((c, i) => _drawCard(png, 560 + (i * 84), 330, c, false));
    if (playingSplit) _rect(png, 548, 318, 430, 170, [46, 204, 113, 255], 3);
    else _rect(png, 108, 318, 430, 170, [46, 204, 113, 255], 3);
  } else {
    player.slice(0, 8).forEach((c, i) => _drawCard(png, 130 + (i * 92), 330, c, false));
  }

  return PNG.sync.write(png);
}

function renderCoinflipPng(choice, result) {
  const W = 900; const H = 420;
  const png = new PNG({ width: W, height: H, colorType: 6 });
  _fillRect(png, 0, 0, W, H, [18, 24, 38, 255]);

  for (let i = 0; i < 7; i++) _rect(png, 24 + i, 24 + i, W - 48 - (i * 2), H - 48 - (i * 2), [44 + i * 16, 62 + i * 10, 96 + i * 6, 255], 1);

  const won = choice === result;
  const centerX = Math.floor(W / 2);
  const centerY = Math.floor(H / 2) + 8;
  const ring = result === 'heads' ? [241, 196, 15, 255] : [149, 165, 166, 255];
  const fill = result === 'heads' ? [252, 243, 207, 255] : [236, 240, 241, 255];
  _dot(png, centerX, centerY, 106, ring);
  _dot(png, centerX, centerY, 94, fill);
  _dot(png, centerX, centerY, 72, won ? [46, 204, 113, 255] : [231, 76, 60, 255]);
  _dot(png, centerX, centerY, 54, [255, 255, 255, 255]);

  const sideColor = won ? [46, 204, 113, 255] : [231, 76, 60, 255];
  _fillRect(png, 90, 160, 170, 90, sideColor);
  _fillRect(png, W - 260, 160, 170, 90, sideColor);

  const leftIsChoice = choice === 'heads';
  const leftSuit = leftIsChoice ? '♥️' : '♣️';
  const rightSuit = leftIsChoice ? '♣️' : '♥️';
  _drawSuit(png, leftSuit, 175, 205, 1.4);
  _drawSuit(png, rightSuit, W - 175, 205, 1.4);
  _drawSuit(png, result === 'heads' ? '♥️' : '♠️', centerX, centerY, 2.5);

  return PNG.sync.write(png);
}

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
  const bg = [16, 22, 34, 255];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) _setPx(png, x, y, bg);
  }

  const margin = { top: 30, right: 24, bottom: 30, left: 24 };
  const pw = W - margin.left - margin.right;
  const ph = H - margin.top - margin.bottom;
  const histCount = historical.length;
  const futureCount = future.length;
  const totalCount = Math.max(2, histCount + futureCount);
  const allPrices = [...historical, ...future];
  if (entryPrice != null) allPrices.push(entryPrice);
  if (sl != null) allPrices.push(sl);
  if (tp != null) allPrices.push(tp);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const pad = (maxP - minP || 1) * 0.18;
  const yMin = minP - pad;
  const yMax = maxP + pad;
  const yRange = yMax - yMin || 1;

  const xOf = idx => margin.left + Math.round((idx / (totalCount - 1)) * pw);
  const yOf = val => margin.top + Math.round((1 - ((val - yMin) / yRange)) * ph);

  for (let g = 1; g <= 4; g++) {
    const gy = margin.top + Math.round((g / 5) * ph);
    _hLine(png, gy, margin.left, margin.left + pw, [46, 62, 88, 255], 1);
  }

  const histEndX = xOf(histCount - 1);
  _line(png, histEndX, margin.top, histEndX, margin.top + ph, [73, 88, 117, 180], 1);

  if (entryPrice != null) _hLine(png, yOf(entryPrice), margin.left, margin.left + pw, [138, 154, 181, 220], 1);
  if (tp != null) _hLine(png, yOf(tp), margin.left, margin.left + pw, [41, 196, 116, 230], 2);
  if (sl != null) _hLine(png, yOf(sl), margin.left, margin.left + pw, [231, 76, 60, 230], 2);

  for (let i = 1; i < historical.length; i++) {
    _line(png, xOf(i - 1), yOf(historical[i - 1]), xOf(i), yOf(historical[i]), [77, 171, 247, 255], 2);
  }

  if (future.length > 0) {
    for (let i = 1; i < future.length; i++) {
      const x1 = xOf(histCount + i - 1);
      const x2 = xOf(histCount + i);
      const y1 = yOf(future[i - 1]);
      const y2 = yOf(future[i]);
      _line(png, x1, y1, x2, y2, won === false ? [255, 117, 107, 255] : [52, 231, 153, 255], 3);
    }
    const markerIdx = finalIndex == null ? (future.length - 1) : _clamp(finalIndex, 0, future.length - 1);
    const markerX = xOf(histCount + markerIdx);
    const markerY = yOf(future[markerIdx]);
    _dot(png, markerX, markerY, 6, won ? [46, 204, 113, 255] : won === false ? [231, 76, 60, 255] : [241, 196, 15, 255]);
  }

  return PNG.sync.write(png);
}

function generateChart({ bet = 0, userId = 'anon' } = {}) {
  const entropy = `${userId}:${bet}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)}`;
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

/* ─── ROULETTE ─────────────────────────────────────────────────────────── */

const ROULETTE_RED   = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const ROULETTE_BLACK = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]);

function spinRoulette() {
  const num   = Math.floor(Math.random() * 37);
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

function renderRouletteWheel(num, color) {
  const colorEmoji = color === 'red' ? '🔴' : color === 'black' ? '⚫' : '🟢';
  const rows = ['```', '  ╔══════════════════════╗'];
  const neighbors = [];
  for (let i = -3; i <= 3; i++) {
    const n = ((num + i) % 37 + 37) % 37;
    const c = n === 0 ? '🟢' : ROULETTE_RED.has(n) ? '🔴' : '⚫';
    neighbors.push(i === 0 ? `[${c}${String(n).padStart(2, '0')}]` : ` ${c}${String(n).padStart(2, '0')} `);
  }
  rows.push('  ║  ' + neighbors.join('') + '  ║');
  rows.push(`  ║         ▲  ${colorEmoji} ${String(num).padStart(2, '0')}  ▲         ║`);
  rows.push('  ╚══════════════════════╝', '```');
  return rows.join('\n');
}

/* ─── WHEEL OF FORTUNE ──────────────────────────────────────────────────── */

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

function spinWheel() {
  let r = Math.random() * WHEEL_TOTAL_W;
  for (const seg of WHEEL_SEGMENTS) { r -= seg.weight; if (r <= 0) return seg; }
  return WHEEL_SEGMENTS[0];
}

function renderWheelDisplay(winner, spinning = false) {
  if (spinning) {
    return '```\n🎡  Spinning...\n\n  🌀🌀🌀🌀🌀🌀🌀🌀\n\n  Round and round it goes...\n```';
  }
  const lines = WHEEL_SEGMENTS.map(s =>
    s.id === winner.id
      ? `  ▶  ${s.label.padEnd(14)}  ◀  LANDED`
      : `     ${s.label}`,
  );
  return '```\n🎡  Wheel of Fortune\n\n' + lines.join('\n') + '\n```';
}

/* ─── DICE ─────────────────────────────────────────────────────────────── */

const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function rollDie() { return Math.floor(Math.random() * 6) + 1; }

function randomDiceOdds() {
  const opts = [1.5, 1.6, 1.8, 2.0, 2.2, 2.5];
  return opts[Math.floor(Math.random() * opts.length)];
}

function playDiceVsBot(odds) {
  let p = rollDie(), b = rollDie();
  if (p === b) { p = rollDie(); b = rollDie(); }
  return { playerRoll: p, botRoll: b, won: p > b, push: p === b, odds };
}

/* ─── BLACKJACK CARD ART ────────────────────────────────────────────────── */

function _cardLines(card, faceDown = false) {
  if (faceDown) return ['┌────┐', '│▒▒▒▒│', '│▒▒▒▒│', '│▒▒▒▒│', '└────┘'];
  const suit = card.s.replace(/\uFE0F/g, '');
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
  SLOT_SYMS, spinSlots, renderSlotsDisplay,
  generateCrashPoint, tickMultiplier, renderCrashChart, TICK_MS, TICK_GROWTH,
  HORSES, TURTLES, runRace, renderRaceTrack,
  generateChart, resolveTradeWithChart, RR_REWARD, RR_MULTIPLIER,
  spinRoulette, rouletteResult, renderRouletteWheel, ROULETTE_RED, ROULETTE_BLACK,
  WHEEL_SEGMENTS, spinWheel, renderWheelDisplay,
  DICE_FACES, rollDie, randomDiceOdds, playDiceVsBot,
};
