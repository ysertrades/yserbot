'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Casino Engine — pure game logic (no Discord, no side-effects)
// ─────────────────────────────────────────────────────────────────────────────

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

/* ─── CRASH ─────────────────────────────────────────────────────────────── */

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
    // exponential curve: higher t → higher row from bottom
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

/* ─── RACE ──────────────────────────────────────────────────────────────── */

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
  // Purely random speeds — no predictable pattern
  const speeds    = racers.map(() => Math.random() * 0.6 + Math.random() * 0.4);
  const maxSpeed  = Math.max(...speeds);
  const winnerIdx = speeds.indexOf(maxSpeed);
  // Scale to progress % (winner always 100%, others proportionally behind)
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

/* ─── TRADING ───────────────────────────────────────────────────────────── */

const RR_WIN_CHANCE  = { '1:1': 0.52, '1:2': 0.40, '1:3': 0.30 };
const RR_REWARD      = { '1:1': 1,    '1:2': 2,    '1:3': 3    };
const RR_MULTIPLIER  = { '1:1': 2,    '1:2': 3,    '1:3': 4    };

function generateChart() {
  const candles = [];
  let price     = 500 + Math.random() * 1500;
  const bias    = (Math.random() - 0.5) * 0.3;
  for (let i = 0; i < 8; i++) {
    const bull = Math.random() > 0.5 - bias;
    const body = price * (0.008 + Math.random() * 0.016);
    const open = price, close = bull ? open + body : open - body;
    const wk   = body * (0.25 + Math.random() * 0.55);
    const high = Math.max(open, close) + wk, low = Math.min(open, close) - wk;
    candles.push({ open, close, high, low, bull });
    price = close;
  }
  const hHigh = Math.max(...candles.map(c => c.high));
  const hLow  = Math.min(...candles.map(c => c.low));
  const ru    = Math.max((hHigh - hLow) * 0.25, price * 0.018);
  return { candles, entryPrice: price, riskUnit: ru, chartStr: renderSetupChart(candles, price) };
}

function _drawLine(grid, x1, y1, x2, y2, ROWS) {
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return;
  const ch = dy < 0 ? '/' : dy > 0 ? '\\' : '─';
  if (dx === 0) {
    const step = dy > 0 ? 1 : -1;
    for (let r = y1; r !== y2 + step; r += step) if (r >= 0 && r < ROWS) grid[r][x1] = ch;
    return;
  }
  for (let x = x1; x <= x2; x++) {
    const y = Math.round(y1 + dy * (x - x1) / dx);
    if (y >= 0 && y < ROWS) grid[y][x] = ch;
  }
  if (Math.abs(dy) > 1) {
    const step = dy > 0 ? 1 : -1;
    for (let r = y1 + step; r !== y2; r += step) {
      if (r < 0 || r >= ROWS) continue;
      const x = Math.round(x1 + dx * (r - y1) / dy);
      if (x >= x1 && x <= x2) grid[r][x] = ch;
    }
  }
}

function _interpolate(prices, N) {
  const out = [], segs = prices.length - 1;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * segs;
    const idx = Math.min(Math.floor(t), segs - 1);
    out.push(prices[idx] * (1 - (t - idx)) + prices[idx + 1] * (t - idx));
  }
  return out;
}

function renderSetupChart(candles, entryPrice) {
  const ROWS = 7, HCOLS = 18;
  const pts   = _interpolate(candles.map(c => c.close), HCOLS);
  const rawMin = Math.min(...pts), rawMax = Math.max(...pts);
  const pad = (rawMax - rawMin) * 0.2, minP = rawMin - pad, maxP = rawMax + pad;
  const range = maxP - minP || 1;
  const toRow = v => Math.max(0, Math.min(ROWS - 1, Math.round((1 - (v - minP) / range) * (ROWS - 1))));
  const rows  = pts.map(toRow);
  const SEP   = HCOLS + 1, GWIDTH = SEP + 8;
  const grid  = Array.from({ length: ROWS }, () => Array(GWIDTH).fill(' '));
  for (let i = 1; i < pts.length; i++) _drawLine(grid, i - 1, rows[i - 1], i, rows[i], ROWS);
  for (let r = 0; r < ROWS; r++) grid[r][SEP] = '│';
  const er = rows[rows.length - 1];
  '◄ENTRY'.split('').forEach((ch, i) => { grid[er][SEP + 1 + i] = ch; });
  const axis = '└' + '─'.repeat(SEP - 1) + '┘';
  return [...grid.map(r => '│' + r.join('').trimEnd()), axis].join('\n');
}

function _generateOutcomePrices(entryPrice, sl, tp, won, N = 14) {
  const prices = [], toTP = tp - entryPrice;
  if (!won) {
    const pk  = entryPrice + toTP * 0.28;
    const fN  = Math.max(1, Math.floor(N * 0.38)), cN = N - fN;
    for (let i = 0; i < fN; i++) {
      const t = (i + 1) / fN;
      prices.push(entryPrice + (pk - entryPrice) * t + (Math.random() - 0.3) * Math.abs(pk - entryPrice) * 0.12);
    }
    const cs = prices[prices.length - 1], cd = sl - cs;
    for (let i = 0; i < cN; i++) {
      const t = Math.pow((i + 1) / cN, 1.3);
      prices.push(i === cN - 1 ? sl : cs + cd * t + (Math.random() - 0.5) * Math.abs(cd) * 0.05);
    }
  } else {
    for (let i = 0; i < N; i++) {
      const t = Math.pow((i + 1) / N, 1.45);
      prices.push(i === N - 1 ? tp : entryPrice + toTP * t + (Math.random() - 0.34) * Math.abs(toTP) / N * 0.3);
    }
  }
  return prices;
}

function renderFullChart(hPts, pPts, entryPrice, sl, tp, isBuy, rr, won) {
  const ROWS = 9, HCOLS = 18, PCOLS = 10;
  const hI = _interpolate(hPts, HCOLS), pI = _interpolate(pPts, PCOLS);
  const all = [...hI, ...pI, entryPrice, sl, tp];
  const rawMin = Math.min(...all), rawMax = Math.max(...all), span = rawMax - rawMin || 1;
  const pad = span * 0.16, minP = rawMin - pad, maxP = rawMax + pad, range = maxP - minP;
  const toRow  = v => Math.max(0, Math.min(ROWS - 1, Math.round((1 - (v - minP) / range) * (ROWS - 1))));
  const eR = toRow(entryPrice), tR = toRow(tp), sR = toRow(sl);
  const SEP = HCOLS + 1, PS = SEP + 1, PE = PS + PCOLS - 1, LS = PE + 2, GW = LS + 11;
  const grid = Array.from({ length: ROWS }, () => Array(GW).fill(' '));
  for (let c = PS; c <= PE; c++) { if (grid[tR]) grid[tR][c] = '─'; if (grid[eR]) grid[eR][c] = '╌'; if (grid[sR]) grid[sR][c] = '─'; }
  for (let r = 0; r < ROWS; r++) grid[r][SEP] = '║';
  const hR = hI.map(toRow);
  for (let i = 1; i < hI.length; i++) _drawLine(grid, i - 1, hR[i - 1], i, hR[i], ROWS);
  const pR = [eR, ...pI.map(toRow)], pX = [PS, ...pI.map((_, i) => PS + 1 + i)];
  for (let i = 1; i < pR.length; i++) _drawLine(grid, pX[i - 1], pR[i - 1], pX[i], pR[i], ROWS);
  const fR = pR[pR.length - 1], fC = pX[pX.length - 1];
  if (fC < GW) grid[fR][fC] = won ? '▲' : '▼';
  const rrReward = RR_REWARD[rr] || 1;
  new Map([[tR, `◄TP+${rrReward}R${won ? '✓' : ''}`], [eR, `◄ENTRY`], [sR, `◄SL-1R${!won ? '✗' : ''}`]]).forEach((text, row) => {
    if (row < 0 || row >= ROWS) return;
    text.split('').forEach((ch, i) => { if (LS + i < GW) grid[row][LS + i] = ch; });
  });
  const lines = grid.map(r => '│' + r.join('').trimEnd());
  return [...lines, '└' + '─'.repeat(SEP - 1) + '╨' + '─'.repeat(PCOLS + 1)].join('\n');
}

function resolveTradeWithChart(tradeState, direction, rr) {
  const { candles: historical, entryPrice, riskUnit } = tradeState;
  const rrReward = RR_REWARD[rr] || 1, mult = RR_MULTIPLIER[rr] || 2;
  const won  = Math.random() < (RR_WIN_CHANCE[rr] || 0.5);
  const isBuy = direction === 'buy';
  const sl   = isBuy ? entryPrice - riskUnit           : entryPrice + riskUnit;
  const tp   = isBuy ? entryPrice + riskUnit * rrReward : entryPrice - riskUnit * rrReward;
  const pPts = _generateOutcomePrices(entryPrice, sl, tp, won);
  return { won, isBuy, sl, tp, rrReward, multiplier: mult,
    chartStr: renderFullChart(historical.map(c => c.close), pPts, entryPrice, sl, tp, isBuy, rr, won) };
}

/* ─── ROULETTE ──────────────────────────────────────────────────────────── */

const ROULETTE_RED   = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const ROULETTE_BLACK = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]);

function spinRoulette() {
  const num   = Math.floor(Math.random() * 37); // 0–36
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
  // Show a small number wheel around the result
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

/* ─── DICE ──────────────────────────────────────────────────────────────── */

const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function rollDie() { return Math.floor(Math.random() * 6) + 1; }

function randomDiceOdds() {
  const opts = [1.5, 1.6, 1.8, 2.0, 2.2, 2.5];
  return opts[Math.floor(Math.random() * opts.length)];
}

function playDiceVsBot(odds) {
  let p = rollDie(), b = rollDie();
  if (p === b) { p = rollDie(); b = rollDie(); } // reroll once on tie
  return { playerRoll: p, botRoll: b, won: p > b, push: p === b, odds };
}

/* ─── BLACKJACK CARD ART ────────────────────────────────────────────────── */

function _cardLines(card, faceDown = false) {
  if (faceDown) return ['┌────┐', '│▒▒▒▒│', '│▒▒▒▒│', '│▒▒▒▒│', '└────┘'];
  const suit = card.s.replace(/\uFE0F/g, ''); // strip variation selector
  const r = card.r;
  return ['┌────┐', `│${r.padEnd(4)}│`, `│ ${suit}  │`, `│${r.padStart(4)}│`, '└────┘'];
}

function renderHandArt(cards, faceDownIndices = []) {
  const cls = cards.map((c, i) => _cardLines(c, faceDownIndices.includes(i)));
  return Array.from({ length: 5 }, (_, row) => cls.map(cl => cl[row]).join(' ')).join('\n');
}

module.exports = {
  shuffle, coinflip,
  // Blackjack
  dealBJ, bjHit, bjDouble, bjStand, bjSplit, bjFirstHandDone,
  bjInsure, bjDeclineInsure, canSplit, canInsure, dealerPlay,
  bjResult, bjResultHand, handVal, isSoft, cStr, hStr, renderHandArt,
  // Slots
  SLOT_SYMS, spinSlots, renderSlotsDisplay,
  // Crash
  generateCrashPoint, tickMultiplier, renderCrashChart, TICK_MS, TICK_GROWTH,
  // Race
  HORSES, TURTLES, runRace, renderRaceTrack,
  // Trading
  generateChart, resolveTradeWithChart, RR_REWARD, RR_MULTIPLIER,
  // Roulette
  spinRoulette, rouletteResult, renderRouletteWheel, ROULETTE_RED, ROULETTE_BLACK,
  // Wheel
  WHEEL_SEGMENTS, spinWheel, renderWheelDisplay,
  // Dice
  DICE_FACES, rollDie, randomDiceOdds, playDiceVsBot,
};
