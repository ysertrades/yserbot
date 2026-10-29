'use strict';

/**
 * giveawayCardVisual.js — the giveaway banner, drawn crisp with a real canvas
 * (the old one, prizeGiveawayVisual.js, is pixel art and reads blurry when
 * Discord scales it). House style of the countdown card: a dark ground, the
 * Quantbot logo, the bundled Inter / JetBrains Mono / Instrument Serif fonts,
 * drawn at 1.5×.
 *
 * The idea: the whole banner is one big raffle ticket, so it stops the scroll.
 *   - the main part is dark, and the prize is the loudest thing on it: huge,
 *     heavy type that sizes itself to fit;
 *   - the stub on the right is a solid block of the state's colour (cobalt while
 *     it's live, green once it's drawn, rose if it closed empty), torn off at a
 *     perforated line with real notches bitten out of the edges, and carries the
 *     winner count in huge figures;
 *   - a burst of confetti cut from the logo's slab shape spills from the stub
 *     toward the prize while it's live, and settles once it's drawn.
 * Flat colour only: no gradients, no glows.
 *
 * It is synchronous (the memoised dynamic-image cache calls it that way), so the
 * logo is preloaded and ready() lets the boot warm-up wait for it.
 */

const path = require('path');
const fs = require('fs');

const W = 1200, H = 420, S = 1.5;
const C = {
  ink: '#0b0c0f', body: '#121419', rim: 'rgba(255,255,255,0.07)', text: '#f4f5f7', muted: '#8b8f99',
  live: '#4f6dff', won: '#3ccf7a', empty: '#e8607a', cyan: '#5cc8f2', lilac: '#a99cf5',
};

let Canvas = null;
try { Canvas = require('@napi-rs/canvas'); } catch { /* the old pixel banner is used instead */ }

let fontsReady = false;
function fonts() {
  if (fontsReady || !Canvas) return;
  const dir = path.join(__dirname, '..', 'assets', 'fonts', 'countdown');
  const reg = (file, alias) => { try { const p = path.join(dir, file); if (fs.existsSync(p)) Canvas.GlobalFonts.registerFromPath(p, alias); } catch {} };
  reg('Inter-ExtraBold.ttf', 'GW Sans'); reg('Inter-SemiBold.ttf', 'GW Sans');
  reg('JetBrainsMono-Regular.ttf', 'GW Mono'); reg('InstrumentSerif-Italic.ttf', 'GW Serif');
  fontsReady = true;
}
const SANS = '"GW Sans", "Segoe UI", Arial, sans-serif', MONO = '"GW Mono", Consolas, monospace', SERIF = '"GW Serif", Georgia, serif';

// the logo decodes asynchronously, so it is loaded once up front
let logoImg = null;
const logoReady = (async () => {
  if (!Canvas) return;
  const file = [path.join(__dirname, '..', 'Quantbot.jpg'), path.join(__dirname, '..', 'web', 'public', 'Quantbot.jpg')].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (file) { try { logoImg = await Canvas.loadImage(fs.readFileSync(file)); } catch { logoImg = null; } }
})();
const ready = () => logoReady;

const rr = (x, cx, cy, w, h, r) => { x.beginPath(); x.roundRect(cx, cy, w, h, r); };
function lines(x, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), out = [];
  let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (x.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; } }
  if (cur) out.push(cur);
  return out.length <= maxLines ? out : null;
}
/** the largest size (in steps) at which the text fits maxLines lines of maxW */
function fit(x, text, maxW, maxLines, sizes, font) {
  for (const s of sizes) { x.font = font(s); const l = lines(x, text, maxW, maxLines); if (l) return { size: s, lines: l }; }
  const s = sizes[sizes.length - 1]; x.font = font(s);
  let t = String(text); while (t.length > 4 && !lines(x, `${t}…`, maxW, maxLines)) t = t.slice(0, -1);
  return { size: s, lines: lines(x, `${t.trim()}…`, maxW, maxLines) || [t] };
}
function soften(s) { const t = String(s || '').trim(); return t && t === t.toUpperCase() && /[A-Z]{3}/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t; }
function rand(seed) { let h = 2166136261; for (const ch of String(seed || 'drop')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }

/** one confetti piece: the logo's slab, a rounded parallelogram */
function slab(x, cx, cy, w, h, rot, color) {
  x.save(); x.translate(cx, cy); x.rotate(rot); x.transform(1, 0, -0.42, 1, 0, 0);
  rr(x, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.28); x.fillStyle = color; x.fill(); x.restore();
}

/**
 * @param {object} copy { heading, subtitle, tagline, dropId, prize?, winners?, state? ('live'|'won'|'empty'), noEntries? }
 * @returns {Buffer|null} PNG
 */
function generateGiveawayCard(copy = {}) {
  if (!Canvas) return null;
  fonts();
  const state = copy.state || (copy.noEntries ? 'empty' : 'live');
  const col = state === 'won' ? C.won : state === 'empty' ? C.empty : C.live;
  const winners = Math.max(1, Number(copy.winners) || 1);
  const prize = String(copy.prize || '').trim() || soften(copy.heading) || 'Giveaway drop';
  const dropId = String(copy.dropId || '').slice(-8).toUpperCase();

  const cv = Canvas.createCanvas(W * S, H * S), x = cv.getContext('2d');
  x.scale(S, S);
  x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic';

  // ── the ticket: dark body, solid stub, a tear line with notches ───────────
  const M = 14, TX = M, TY = M, TW = W - M * 2, TH = H - M * 2, cut = 880, notch = 18;
  rr(x, TX, TY, TW, TH, 26); x.fillStyle = C.body; x.fill();
  x.save(); rr(x, TX, TY, TW, TH, 26); x.clip(); x.fillStyle = col; x.fillRect(cut, TY, TX + TW - cut, TH); x.restore();
  x.strokeStyle = C.rim; x.lineWidth = 1.5; x.beginPath(); x.roundRect(TX + .75, TY + .75, cut - TX, TH - 1.5, [25.5, 0, 0, 25.5]); x.stroke();
  for (const ny of [TY, TY + TH]) { x.fillStyle = C.ink; x.beginPath(); x.arc(cut, ny, notch, 0, Math.PI * 2); x.fill(); }
  x.fillStyle = C.ink;
  for (let py = TY + notch + 14; py < TY + TH - notch - 8; py += 14) { x.beginPath(); x.arc(cut, py, 2.6, 0, Math.PI * 2); x.fill(); }

  // ── lay the prize out first (as large as it fits: one or two lines), so the confetti can keep clear of it ──
  const kick = state === 'won' ? 'GIVEAWAY · DRAWN' : state === 'empty' ? 'GIVEAWAY · CLOSED' : 'GIVEAWAY · LIVE';
  const top = 104, floor = TY + TH - 82;          // under the kicker pill, above the brand row
  let big = null;
  for (const s of [96, 88, 80, 72, 64, 58, 52, 46]) {
    x.font = `800 ${s}px ${SANS}`; x.letterSpacing = `${-s * 0.035}px`;
    const l = lines(x, prize, 770, 2);
    if (l && l.length * s + 46 <= floor - top) { big = { size: s, lines: l }; break; }
  }
  if (!big) { x.letterSpacing = '-1.6px'; big = fit(x, prize, 770, 2, [46], (s) => `800 ${s}px ${SANS}`); }
  const lh = big.size, blockH = big.lines.length * lh + 46;
  const y0 = top + (floor - top - blockH) / 2 + big.size * 0.82;     // the block sits centred between kicker and brand row
  x.font = `800 ${big.size}px ${SANS}`; x.letterSpacing = `${-big.size * 0.035}px`;
  const textRight = 52 + Math.max(...big.lines.map((l) => x.measureText(l).width));
  x.letterSpacing = '0px';

  // ── confetti spilling from the stub toward the prize (fewer and dimmer when it closed empty) ──
  const r = rand(dropId || prize), pal = state === 'live' ? [C.live, C.cyan, C.lilac, '#f4f5f7'] : state === 'won' ? [C.won, C.cyan, C.lilac, '#f4f5f7'] : [C.empty, '#5b5f6b'];
  const pieces = state === 'empty' ? 7 : 22;
  const blockTop = y0 - big.size * 0.9, blockBot = y0 + (big.lines.length - 1) * lh + 60;
  for (let i = 0, placed = 0; i < 80 && placed < pieces; i++) {
    const t = r(), px = cut - 28 - Math.pow(t, 0.8) * 330, py = TY + 26 + r() * (TH - 52), sz = 8 + r() * 13, rot = r() * Math.PI * 2, c = pal[Math.floor(r() * pal.length)];
    if (px < textRight + 26 && py > blockTop && py < blockBot) continue;   // never over the prize or its line
    if (py > TY + TH - 66 && px < cut - 10) continue;                        // never over the bottom labels
    if (py < 96 && px < 340) continue;                                       // never over the kicker
    x.globalAlpha = state === 'empty' ? 0.35 : 0.45 + (1 - t) * 0.5;
    slab(x, px, py, sz * 0.62, sz, rot, c); placed++;
  }
  x.globalAlpha = 1;

  // ── the main part: kicker, the prize, the line under it, the brand ────────
  x.font = `600 14px ${MONO}`; x.letterSpacing = '3px';
  const kw = x.measureText(kick).width + 46;
  rr(x, 54, 50, kw, 34, 17); x.fillStyle = state === 'won' ? 'rgba(60,207,122,0.14)' : state === 'empty' ? 'rgba(232,96,122,0.14)' : 'rgba(79,109,255,0.16)'; x.fill();
  x.fillStyle = col; x.beginPath(); x.arc(74, 67, 5.5, 0, Math.PI * 2); x.fill();
  x.textBaseline = 'middle'; x.fillStyle = state === 'live' ? '#a9b4ff' : col; x.fillText(kick, 88, 68); x.textBaseline = 'alphabetic'; x.letterSpacing = '0px';

  x.font = `800 ${big.size}px ${SANS}`; x.letterSpacing = `${-big.size * 0.035}px`; x.fillStyle = C.text;
  big.lines.forEach((l, i) => x.fillText(l, 52, y0 + i * lh));
  if (state === 'empty') {   // a clean strike through each line of a prize nobody entered for
    x.strokeStyle = C.empty; x.lineWidth = 5; x.lineCap = 'round';
    big.lines.forEach((l, i) => { const w0 = x.measureText(l).width, ly = y0 + i * lh - big.size * 0.32; x.beginPath(); x.moveTo(50, ly); x.lineTo(54 + w0, ly); x.stroke(); });
  }
  x.letterSpacing = '0px';

  const yLine = y0 + (big.lines.length - 1) * lh + 46;
  const say = state === 'won' ? [winners === 1 ? 'Winner ' : 'Winners ', 'selected.', ' Tap Reveal below.'] : state === 'empty' ? ['No ', 'entries.', ' Catch the next one.'] : ['Hit ', 'Enter', ' below to join the draw.'];
  x.font = `600 24px ${SANS}`; x.fillStyle = 'rgba(244,245,247,0.78)';
  x.fillText(say[0], 54, yLine); let sx = 54 + x.measureText(say[0]).width;
  x.font = `400 30px ${SERIF}`; x.fillStyle = state === 'live' ? '#a9b4ff' : col; x.fillText(say[1], sx, yLine + 1); sx += x.measureText(say[1]).width;
  x.font = `600 24px ${SANS}`; x.fillStyle = 'rgba(244,245,247,0.78)'; x.fillText(say[2], sx, yLine);

  // brand and drop number along the bottom of the main part
  const by = TY + TH - 44;
  if (logoImg) {
    x.save(); x.beginPath(); x.arc(74, by, 20, 0, Math.PI * 2); x.clip();
    const s = Math.max(40 / logoImg.width, 40 / logoImg.height);
    x.drawImage(logoImg, 74 - (logoImg.width * s) / 2, by - (logoImg.height * s) / 2, logoImg.width * s, logoImg.height * s); x.restore();
  }
  x.font = `600 13px ${MONO}`; x.letterSpacing = '2.5px'; x.textBaseline = 'middle'; x.fillStyle = C.muted;
  x.fillText('QUANTBOT', logoImg ? 106 : 54, by + 1);
  if (dropId) { x.textAlign = 'right'; x.fillText(`DROP #${dropId}`, cut - 38, by + 1); x.textAlign = 'left'; }
  x.letterSpacing = '0px'; x.textBaseline = 'alphabetic';

  // ── the stub: winner count, huge, in the ground's ink ────────────────────
  const sx0 = cut + notch + 8, sw = TX + TW - sx0 - 22, mid = sx0 + sw / 2 - 14;
  x.fillStyle = C.ink; x.textAlign = 'center';
  x.font = `600 14px ${MONO}`; x.letterSpacing = '3px'; x.fillText(winners === 1 ? 'WINNER' : 'WINNERS', mid, TY + 92);
  x.font = `800 132px ${SANS}`; x.letterSpacing = '-6px'; x.fillText(String(Math.min(winners, 99)).padStart(2, '0'), mid, TY + 238);
  x.font = `800 17px ${SANS}`; x.letterSpacing = '3px';
  x.fillText(state === 'won' ? 'DRAWN' : state === 'empty' ? 'VOID' : 'ADMIT ONE', mid, TY + TH - 52);
  x.textAlign = 'left'; x.letterSpacing = '0px';
  // the stub's own edge marks: a short row of ticks, like a ticket's counterfoil
  x.strokeStyle = 'rgba(11,12,15,0.45)'; x.lineWidth = 2; x.lineCap = 'round';
  for (let i = 0; i < 11; i++) { const tx = mid - 50 + i * 10; x.beginPath(); x.moveTo(tx, TY + TH - 92); x.lineTo(tx, TY + TH - (i % 5 === 0 ? 76 : 82)); x.stroke(); }
  // and down the far edge, sideways: the drop id
  if (dropId) {
    x.save(); x.translate(TX + TW - 26, TY + TH / 2); x.rotate(Math.PI / 2);
    x.font = `600 12px ${MONO}`; x.letterSpacing = '4px'; x.textAlign = 'center'; x.fillStyle = 'rgba(11,12,15,0.6)'; x.fillText(`NO. ${dropId}`, 0, 4);
    x.restore();
  }
  return cv.toBuffer('image/png');
}

module.exports = { generateGiveawayCard, ready };
