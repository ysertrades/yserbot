'use strict';

/**
 * countdownVisual.js — the live countdown card (utils/countdown.js posts it and
 * redraws it once a minute).
 *
 * A dark 1200 × 420 card (drawn at 1.5×): on the left a kicker, the event's
 * title and when it lands; on the right DAYS : HOURS : MIN tiles, each with a
 * bar for how much of that unit is left; along the bottom a ruler of 72 ticks
 * from the moment it was posted to the moment it ends, the ticks behind "now"
 * lit. Minutes round up, so the card never reads 00:00:00 before it's over.
 * When it ends the tiles give way to one green "live" block and the ruler is
 * full. There are no seconds: the card only changes when the bot edits it.
 *
 * Fonts ship with the bot (assets/fonts/countdown) so the card looks the same
 * on any host; the logo is Quantbot's own (web/public/Quantbot.jpg).
 */

const path = require('path');
const fs = require('fs');

const W = 1200, H = 420, S = 1.5;
const C = {
  ink: '#0b0c0f', card: '#14161b', rim: 'rgba(255,255,255,0.06)', text: '#f4f5f7', muted: '#8b8f99', faint: 'rgba(255,255,255,0.16)',
  accent: '#4f6dff', soft: '#8d9bff', live: '#3ccf7a', colon: '#2f323c',
};

let Canvas = null;
try { Canvas = require('@napi-rs/canvas'); } catch { /* optional: the countdown posts text only without it */ }

let fontsReady = false;
function fonts() {
  if (fontsReady || !Canvas) return;
  const dir = path.join(__dirname, '..', 'assets', 'fonts', 'countdown');
  const reg = (file, alias) => { try { const p = path.join(dir, file); if (fs.existsSync(p)) Canvas.GlobalFonts.registerFromPath(p, alias); } catch { /* falls back to a system face */ } };
  reg('Inter-ExtraBold.ttf', 'CD Sans');
  reg('Inter-SemiBold.ttf', 'CD Sans');
  reg('JetBrainsMono-Regular.ttf', 'CD Mono');
  reg('InstrumentSerif-Italic.ttf', 'CD Serif');
  fontsReady = true;
}
const SANS = '"CD Sans", "Segoe UI", Arial, sans-serif', MONO = '"CD Mono", Consolas, monospace', SERIF = '"CD Serif", Georgia, serif';

let logoImg = null, logoTried = false;
async function logo() {
  if (logoTried) return logoImg;
  logoTried = true;
  const file = [path.join(__dirname, '..', 'Quantbot.jpg'), path.join(__dirname, '..', 'web', 'public', 'Quantbot.jpg')].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (file) { try { logoImg = await Canvas.loadImage(fs.readFileSync(file)); } catch { logoImg = null; } }
  return logoImg;
}

/** what's left, as the card shows it: minutes round up, so 30 s left reads 00 · 00 · 01 */
function remaining(endsAt, now) {
  const ms = Math.max(0, endsAt - now);
  const totalMin = Math.ceil(ms / 60000);
  return { ms, d: Math.floor(totalMin / 1440), h: Math.floor((totalMin % 1440) / 60), m: totalMin % 60, totalMin };
}

function whenLabel(endsAt, tz) {
  const zone = tz || 'America/New_York';
  try {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(endsAt);
    const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(endsAt);
    const short = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(endsAt);
    return { day, time, short };
  } catch {
    const d = new Date(endsAt);
    return { day: d.toUTCString().slice(0, 16), time: `${d.toISOString().slice(11, 16)} UTC`, short: d.toISOString().slice(11, 16) };
  }
}

function rr(x, cx, cy, w, h, r) { x.beginPath(); x.roundRect(cx, cy, w, h, r); }
function wrap(x, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {   // ellipsis on the last line if it ran over
    let last = lines[maxLines - 1];
    while (last.length > 1 && x.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.replace(/\s+$/, '')}…`;
  }
  return lines;
}

/**
 * @param {object} cd   { title, kicker?, note?, endsAt, createdAt, tz?, endTitle? }
 * @param {number} now  ms; pass endsAt or later for the ended card
 * @returns {Promise<Buffer|null>} PNG
 */
async function renderCountdown(cd, now = Date.now()) {
  if (!Canvas) return null;
  fonts();
  const cv = Canvas.createCanvas(W * S, H * S), x = cv.getContext('2d');
  x.scale(S, S);
  const ended = now >= cd.endsAt;
  const left = remaining(cd.endsAt, now), when = whenLabel(cd.endsAt, cd.tz);

  x.fillStyle = C.ink; x.fillRect(0, 0, W, H);

  // ── left: kicker, title, when ──────────────────────────────────────────────
  const kick = String(cd.kicker || (ended ? 'Live now' : 'Countdown')).toUpperCase().slice(0, 28);
  x.fillStyle = ended ? C.live : C.accent;
  x.beginPath(); x.arc(58, 52, 6, 0, Math.PI * 2); x.fill();
  x.font = `600 15px ${MONO}`; x.letterSpacing = '3px'; x.fillStyle = ended ? C.live : C.soft; x.textBaseline = 'middle';
  x.fillText(kick, 76, 53);
  x.letterSpacing = '0px';

  x.font = `800 46px ${SANS}`; x.fillStyle = C.text; x.textBaseline = 'alphabetic';
  x.letterSpacing = '-1.4px';
  const lines = wrap(x, cd.title || 'Countdown', 380, 2);
  lines.forEach((l, i) => x.fillText(l, 50, 126 + i * 50));
  x.letterSpacing = '0px';
  const y0 = 126 + (lines.length - 1) * 50 + 46;
  x.font = `400 17px ${MONO}`; x.fillStyle = C.muted;
  x.fillText(when.day, 52, y0);
  x.fillText(cd.note ? `${when.time} · ${String(cd.note).slice(0, 26)}` : when.time, 52, y0 + 26);

  // the Quantbot mark, bottom left
  const img = await logo();
  if (img) {
    x.save(); x.beginPath(); x.arc(74, H - 62, 24, 0, Math.PI * 2); x.clip();
    const s = Math.max(48 / img.width, 48 / img.height);
    x.drawImage(img, 74 - (img.width * s) / 2, H - 62 - (img.height * s) / 2, img.width * s, img.height * s);
    x.restore();
    x.strokeStyle = C.rim; x.lineWidth = 1.5; x.beginPath(); x.arc(74, H - 62, 24, 0, Math.PI * 2); x.stroke();
    x.font = `600 14px ${MONO}`; x.fillStyle = C.muted; x.letterSpacing = '2px'; x.textBaseline = 'middle';
    x.fillText('QUANTBOT', 110, H - 61); x.letterSpacing = '0px'; x.textBaseline = 'alphabetic';
  }

  // ── right: tiles, or the live block ────────────────────────────────────────
  const RX = 520, RW = W - RX - 44, TY = 44, TH = 206;
  if (!ended) {
    const units = [
      ['DAYS', left.d, Math.min(1, left.d / 7)],
      ['HOURS', left.h, left.h / 24],
      ['MIN', left.m, left.m / 60],
    ];
    const gap = 30, tw = (RW - gap * 2) / 3;
    units.forEach(([label, v, f], i) => {
      const tx = RX + i * (tw + gap);
      rr(x, tx, TY, tw, TH, 22); x.fillStyle = C.card; x.fill();
      x.strokeStyle = C.rim; x.lineWidth = 1.5; rr(x, tx + .75, TY + .75, tw - 1.5, TH - 1.5, 21.5); x.stroke();
      x.font = `400 86px ${MONO}`; x.textAlign = 'center'; x.fillStyle = i === 2 ? C.soft : C.text; x.letterSpacing = '-4px';
      x.fillText(String(Math.min(v, 99)).padStart(2, '0'), tx + tw / 2 + 2, TY + 118);
      x.letterSpacing = '3px'; x.font = `600 14px ${MONO}`; x.fillStyle = C.muted;
      x.fillText(label, tx + tw / 2 + 1.5, TY + 162);
      x.letterSpacing = '0px'; x.textAlign = 'left';
      rr(x, tx + 20, TY + TH - 22, tw - 40, 4, 2); x.fillStyle = 'rgba(255,255,255,0.08)'; x.fill();
      if (f > 0) { rr(x, tx + 20, TY + TH - 22, Math.max(4, (tw - 40) * f), 4, 2); x.fillStyle = C.accent; x.fill(); }
      if (i < 2) {   // the colon between tiles
        x.fillStyle = C.colon; const cx = tx + tw + gap / 2;
        x.beginPath(); x.arc(cx, TY + 86, 4.5, 0, Math.PI * 2); x.arc(cx, TY + 112, 4.5, 0, Math.PI * 2); x.fill();
      }
    });
  } else {
    rr(x, RX, TY, RW, TH, 22); x.fillStyle = C.card; x.fill();
    x.strokeStyle = 'rgba(60,207,122,0.4)'; x.lineWidth = 1.5; rr(x, RX + .75, TY + .75, RW - 1.5, TH - 1.5, 21.5); x.stroke();
    const px = RX + 92, py = TY + TH / 2;
    x.strokeStyle = 'rgba(60,207,122,0.22)'; x.lineWidth = 2.5; x.beginPath(); x.arc(px, py, 50, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = 'rgba(60,207,122,0.6)'; x.lineWidth = 4; x.beginPath(); x.arc(px, py, 34, 0, Math.PI * 2); x.stroke();
    x.fillStyle = C.live; x.beginPath(); x.arc(px, py, 18, 0, Math.PI * 2); x.fill();
    // the headline: all but its last word in the sans, the last word in the serif italic, green
    const head = String(cd.endTitle || "We're live.").trim().slice(0, 40), parts = head.split(/\s+/);
    const tail = parts.length > 1 ? parts.pop() : '', lead = parts.join(' ');
    x.font = `800 58px ${SANS}`; x.letterSpacing = '-2px'; x.fillStyle = C.text;
    const hx = RX + 178, hy = py + 8;
    x.fillText(lead || tail, hx, hy);
    if (lead && tail) { const lw = x.measureText(`${lead} `).width; x.letterSpacing = '0px'; x.font = `400 66px ${SERIF}`; x.fillStyle = C.live; x.fillText(tail, hx + lw, hy); }
    x.letterSpacing = '0px';
    x.font = `400 17px ${MONO}`; x.fillStyle = C.muted; x.fillText(`Started ${when.short}`, hx + 2, hy + 42);
  }

  // ── the ruler: posted → ends, the ticks behind now lit ─────────────────────
  const total = Math.max(1, cd.endsAt - (cd.createdAt || cd.endsAt - 1));
  const frac = ended ? 1 : Math.min(1, Math.max(0, (now - (cd.createdAt || now)) / total));
  const ry = H - 82, rx0 = RX, rx1 = W - 44, N = 72;
  x.font = `600 13px ${MONO}`; x.letterSpacing = '2.5px'; x.fillStyle = C.muted;
  x.fillText('POSTED', rx0, ry - 16);
  x.textAlign = 'right'; x.fillStyle = ended ? C.live : C.soft;
  x.fillText(ended ? `LIVE SINCE ${when.short}`.toUpperCase() : when.short.toUpperCase(), rx1, ry - 16);
  x.textAlign = 'left'; x.letterSpacing = '0px';
  x.lineCap = 'round';
  for (let i = 0; i <= N; i++) {
    const tx = rx0 + 2 + (i * (rx1 - rx0 - 4)) / N, major = i % 6 === 0;
    x.strokeStyle = i / N <= frac + 1e-9 ? C.accent : C.faint; x.lineWidth = major ? 3 : 2;
    x.beginPath(); x.moveTo(tx, ry + (major ? 4 : 14)); x.lineTo(tx, ry + 34); x.stroke();
  }
  x.strokeStyle = ended ? C.live : C.soft; x.lineWidth = 3.5; x.beginPath(); x.moveTo(rx1 - 2, ry); x.lineTo(rx1 - 2, ry + 34); x.stroke();
  const mx = Math.min(rx1 - 10, rx0 + 2 + frac * (rx1 - rx0 - 4));
  x.fillStyle = ended ? C.live : C.text; x.beginPath(); x.moveTo(mx - 8, ry + 52); x.lineTo(mx, ry + 42); x.lineTo(mx + 8, ry + 52); x.closePath(); x.fill();

  return cv.toBuffer('image/png');
}

module.exports = { renderCountdown, remaining, whenLabel, W, H };
