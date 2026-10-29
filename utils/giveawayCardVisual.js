'use strict';

/**
 * giveawayCardVisual.js — the giveaway banner, drawn crisp with a real canvas
 * (the old one, prizeGiveawayVisual.js, is pixel art and reads blurry when
 * Discord scales it). Same house style as the countdown card: a dark 1200 × 420
 * ground drawn at 1.5×, Quantbot's logo, the bundled Inter / JetBrains Mono /
 * Instrument Serif fonts.
 *
 * The idea: a giveaway is a ticket. On the left the prize leads, large; on the
 * right a dark ticket with notched, perforated edges carries the drop number,
 * the winner count and a barcode made from the drop id, so every drop's ticket
 * is its own. Three states, one layout:
 *   live   — cobalt; "Enter below" line
 *   won    — green; the ticket is stamped DRAWN
 *   empty  — rose; the ticket is stamped VOID
 *
 * It is synchronous (the memoised dynamic-image cache calls it that way), so the
 * logo is decoded once with a synchronous Image.
 */

const path = require('path');
const fs = require('fs');

const W = 1200, H = 420, S = 1.5;
const C = {
  ink: '#0b0c0f', card: '#14161b', card2: '#191c22', rim: 'rgba(255,255,255,0.07)', text: '#f4f5f7', muted: '#8b8f99', faint: 'rgba(255,255,255,0.14)',
  live: '#4f6dff', liveSoft: '#8d9bff', won: '#3ccf7a', empty: '#e8607a',
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

// the logo decodes asynchronously, so it is loaded once up front; ready() lets the boot warm-up wait for it
let logoImg = null;
const logoReady = (async () => {
  if (!Canvas) return;
  const file = [path.join(__dirname, '..', 'Quantbot.jpg'), path.join(__dirname, '..', 'web', 'public', 'Quantbot.jpg')].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (file) { try { logoImg = await Canvas.loadImage(fs.readFileSync(file)); } catch { logoImg = null; } }
})();
const ready = () => logoReady;
const logo = () => logoImg;

const rr = (x, cx, cy, w, h, r) => { x.beginPath(); x.roundRect(cx, cy, w, h, r); };
function wrap(x, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; if (lines.length === maxLines) break; }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  const used = lines.join(' ').split(/\s+/).length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && x.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.replace(/[\s,.;:]+$/, '')}…`;
  }
  return lines;
}
/** Title case for copy typed in capitals ("ONE WINNER TAKES IT" → "One winner takes it"), left alone otherwise */
function soften(s) { const t = String(s || '').trim(); return t && t === t.toUpperCase() && /[A-Z]{3}/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase() : t; }
function hash(s) { let h = 2166136261; for (const ch of String(s || 'drop')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/**
 * @param {object} copy { heading, subtitle, tagline, dropId, prize?, winners?, state? ('live'|'won'|'empty'), noEntries? }
 * @returns {Buffer|null} PNG
 */
function generateGiveawayCard(copy = {}) {
  if (!Canvas) return null;
  fonts();
  const state = copy.state || (copy.noEntries ? 'empty' : /SELECTED|DRAWN|WINNER/i.test(copy.heading || '') && !/TAKES/i.test(copy.subtitle || '') ? 'won' : 'live');
  const col = state === 'won' ? C.won : state === 'empty' ? C.empty : C.live;
  const soft = state === 'live' ? C.liveSoft : col;
  const winners = Math.max(1, Number(copy.winners) || 1);
  const prize = String(copy.prize || '').trim();

  const cv = Canvas.createCanvas(W * S, H * S), x = cv.getContext('2d');
  x.scale(S, S);
  x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
  x.textBaseline = 'alphabetic';

  // ── left: kicker, the prize, the line under it ────────────────────────────
  const kick = state === 'won' ? 'GIVEAWAY · DRAWN' : state === 'empty' ? 'GIVEAWAY · CLOSED' : 'GIVEAWAY · LIVE';
  x.fillStyle = col; x.beginPath(); x.arc(58, 52, 6, 0, Math.PI * 2); x.fill();
  x.font = `600 15px ${MONO}`; x.letterSpacing = '3px'; x.fillStyle = soft; x.textBaseline = 'middle';
  x.fillText(kick, 76, 53); x.letterSpacing = '0px'; x.textBaseline = 'alphabetic';

  // the headline: the prize when there is one, else the heading; its last word in the serif italic
  let head = prize || soften(copy.heading) || 'Giveaway drop';
  if (state === 'won') head = winners === 1 ? 'Winner selected.' : 'Winners selected.';
  if (state === 'empty') head = 'No entries.';
  x.font = `800 50px ${SANS}`; x.letterSpacing = '-1.6px'; x.fillStyle = C.text;
  const lines = wrap(x, head, 560, 2);
  const top0 = lines.length === 1 ? 156 : 132;   // the text block sits in the middle of the space above the logo
  lines.forEach((l, i) => {
    const y = top0 + i * 54;
    if (i === lines.length - 1 && state !== 'live') {   // the result word, set apart
      const parts = l.split(' '), last = parts.pop(), lead = parts.join(' ');
      x.fillText(lead, 50, y);
      const lw = lead ? x.measureText(`${lead} `).width : 0;
      x.letterSpacing = '0px'; x.font = `400 58px ${SERIF}`; x.fillStyle = col; x.fillText(last, 50 + lw, y);
      x.font = `800 50px ${SANS}`; x.letterSpacing = '-1.6px'; x.fillStyle = C.text;
    } else x.fillText(l, 50, y);
  });
  x.letterSpacing = '0px';
  let y = top0 + (lines.length - 1) * 54 + 42;
  const sub = state === 'live' ? (prize ? soften(copy.heading) || 'Giveaway drop' : soften(copy.subtitle)) : (prize || soften(copy.subtitle));
  if (sub) { x.font = `400 18px ${MONO}`; x.fillStyle = C.muted; x.fillText(String(sub).slice(0, 48), 52, y); y += 30; }
  const tag = state === 'live' ? 'Hit Enter below. The winner is drawn when the timer runs out.'
    : state === 'won' ? 'The draw is locked. Tap Reveal below to see if it found you.' : 'This drop closed empty. Catch the next one.';
  x.font = `600 16px ${SANS}`; x.fillStyle = 'rgba(244,245,247,0.62)';
  wrap(x, soften(copy.tagline) || tag, 520, 2).forEach((l, i) => x.fillText(l, 52, y + 4 + i * 24));

  // the Quantbot mark, bottom left
  const img = logo();
  if (img) {
    x.save(); x.beginPath(); x.arc(74, H - 56, 22, 0, Math.PI * 2); x.clip();
    const s = Math.max(44 / img.width, 44 / img.height);
    x.drawImage(img, 74 - (img.width * s) / 2, H - 56 - (img.height * s) / 2, img.width * s, img.height * s);
    x.restore();
    x.strokeStyle = C.rim; x.lineWidth = 1.5; x.beginPath(); x.arc(74, H - 56, 22, 0, Math.PI * 2); x.stroke();
    x.font = `600 14px ${MONO}`; x.fillStyle = C.muted; x.letterSpacing = '2px'; x.textBaseline = 'middle';
    x.fillText('QUANTBOT', 108, H - 55); x.letterSpacing = '0px'; x.textBaseline = 'alphabetic';
  }

  // ── right: the ticket ─────────────────────────────────────────────────────
  const TX = 720, TY = 40, TW = W - TX - 44, TH = H - 80, stub = TX + TW - 128, notch = 15;
  rr(x, TX, TY, TW, TH, 22); x.fillStyle = C.card; x.fill();
  x.strokeStyle = C.rim; x.lineWidth = 1.5; rr(x, TX + .75, TY + .75, TW - 1.5, TH - 1.5, 21.5); x.stroke();
  // the notches at the tear line: half-circle bites out of the top and bottom edges, filled with the ground
  // (so nothing shows past the ticket's edge), then their inner curve traced with the ticket's own rim
  for (const [ny, a0, a1] of [[TY, 0, Math.PI], [TY + TH, Math.PI, Math.PI * 2]]) {
    x.fillStyle = C.ink; x.beginPath(); x.arc(stub, ny, notch, 0, Math.PI * 2); x.fill();
    x.strokeStyle = C.rim; x.lineWidth = 1.5; x.beginPath(); x.arc(stub, ny, notch - .75, a0, a1); x.stroke();
  }
  // perforation down the tear line
  x.fillStyle = 'rgba(255,255,255,0.13)';
  for (let py = TY + notch + 12; py < TY + TH - notch - 6; py += 13) { x.beginPath(); x.arc(stub, py, 2.2, 0, Math.PI * 2); x.fill(); }
  // ticket body: drop number, winners, barcode
  x.font = `600 13px ${MONO}`; x.letterSpacing = '2.5px'; x.fillStyle = C.muted;
  x.fillText('DROP', TX + 28, TY + 40);
  x.font = `400 26px ${MONO}`; x.letterSpacing = '1px'; x.fillStyle = C.text;
  x.fillText(`#${String(copy.dropId || '----').slice(-8).toUpperCase()}`, TX + 28, TY + 74);
  x.font = `600 13px ${MONO}`; x.letterSpacing = '2.5px'; x.fillStyle = C.muted;
  x.fillText(winners === 1 ? 'WINNER' : 'WINNERS', TX + 28, TY + 124);
  x.font = `400 92px ${MONO}`; x.letterSpacing = '-4px'; x.fillStyle = state === 'live' ? C.liveSoft : col;
  x.fillText(String(Math.min(winners, 99)).padStart(2, '0'), TX + 22, TY + 210);
  x.letterSpacing = '0px';
  // the barcode: the drop id, read as bar widths
  let h = hash(copy.dropId), bx = TX + 28;
  const bEnd = stub - 26, bY = TY + TH - 74;
  while (bx < bEnd) { const w = 1.5 + (h & 3); h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0; if (bx + w > bEnd) break; x.fillStyle = (h & 1) ? 'rgba(244,245,247,0.72)' : 'rgba(244,245,247,0.28)'; x.fillRect(bx, bY, w, 44); bx += w + 2 + ((h >>> 3) & 3); }
  // the stub: the state, read sideways
  x.save(); x.translate(stub + 64, TY + TH / 2); x.rotate(-Math.PI / 2);
  x.font = `600 15px ${MONO}`; x.letterSpacing = '6px'; x.textAlign = 'center'; x.fillStyle = soft;
  x.fillText(state === 'won' ? 'DRAWN' : state === 'empty' ? 'CLOSED' : 'ADMIT ONE', 0, 6);
  x.restore();
  // the stamp across the ticket once it's over
  if (state !== 'live') {   // stamped in the open space beside the winner count: clear of the number and the barcode
    const label = state === 'won' ? 'DRAWN' : 'VOID';
    x.save();
    x.font = `800 26px ${SANS}`; x.letterSpacing = '4px';
    const sw = x.measureText(label).width + 34, sx = stub - 26 - sw / 2 - 4, sy = TY + 168;
    x.translate(sx, sy); x.rotate(-0.1);
    x.strokeStyle = col; x.lineWidth = 3; rr(x, -sw / 2, -24, sw, 46, 9); x.stroke();
    x.fillStyle = col; x.textAlign = 'center'; x.fillText(label, 2, 9);
    x.restore();
  }
  return cv.toBuffer('image/png');
}

module.exports = { generateGiveawayCard, ready };
