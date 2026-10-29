'use strict';

/**
 * gifEncoder.js — a small animated-GIF encoder for canvas frames, so cards can
 * animate without another dependency.
 *
 * One global palette (median cut over a few key frames, plus colours the card
 * must keep exact) is shared by every frame. After the first frame only the
 * rectangle that changed is written, and inside it the pixels that did not
 * change are transparent, so a card that moves in a few places stays small.
 * Frames that come out identical are merged into the previous frame's delay.
 */

const TRANSPARENT = 255;

/** 15-bit key (5 bits per channel) for an RGB triple */
const key15 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * @param {Uint8ClampedArray[]} samples RGBA pixel arrays to build the palette from
 * @param {string[]} keep  hex colours that must be in the palette exactly
 * @returns {number[][]} up to 255 [r,g,b]
 */
function buildPalette(samples, keep = []) {
  const counts = new Uint32Array(32768);
  for (const px of samples) for (let i = 0; i < px.length; i += 4) counts[key15(px[i], px[i + 1], px[i + 2])]++;
  const fixed = keep.map((h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  const colors = [];
  for (let k = 0; k < 32768; k++) if (counts[k]) colors.push(k);
  const want = Math.max(1, 255 - fixed.length);
  const ch = (k, c) => (k >> (10 - c * 5)) & 31;
  const boxes = [colors];
  while (boxes.length < want) {
    // split the box with the most pixels × widest channel range
    let best = -1, bestScore = 0, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      let n = 0; const lo = [31, 31, 31], hi = [0, 0, 0];
      for (const k of box) { n += counts[k]; for (let c = 0; c < 3; c++) { const v = ch(k, c); if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; } }
      const ranges = hi.map((h, c) => h - lo[c]), c = ranges.indexOf(Math.max(...ranges));
      const score = ranges[c] * Math.sqrt(n);
      if (score > bestScore) { bestScore = score; best = i; bestCh = c; }
    });
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => ch(a, bestCh) - ch(b, bestCh));
    let total = 0; for (const k of box) total += counts[k];
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += counts[box[i]]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  const pal = fixed.slice();
  for (const box of boxes) {
    let n = 0, r = 0, g = 0, b = 0;
    for (const k of box) { const w = counts[k]; n += w; r += (ch(k, 0) * 8 + 4) * w; g += (ch(k, 1) * 8 + 4) * w; b += (ch(k, 2) * 8 + 4) * w; }
    if (n) pal.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  }
  return pal.slice(0, 255);
}

class GifWriter {
  /**
   * @param {number} width
   * @param {number} height
   * @param {number[][]} palette from buildPalette
   */
  constructor(width, height, palette) {
    this.w = width; this.h = height; this.pal = palette;
    this.lut = new Int16Array(32768).fill(-1);
    this.prev = null; this.pending = null; this.out = [];
    this.header();
  }

  nearest(r, g, b) {
    const k = key15(r, g, b);
    const hit = this.lut[k];
    if (hit >= 0) return hit;
    let best = 0, bd = Infinity;
    const cr = (r & 0xf8) | 4, cg = (g & 0xf8) | 4, cb = (b & 0xf8) | 4;
    for (let p = 0; p < this.pal.length; p++) {
      const [pr, pg, pb] = this.pal[p], d = (pr - cr) ** 2 * 2 + (pg - cg) ** 2 * 3 + (pb - cb) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    this.lut[k] = best;
    return best;
  }

  bytes(...b) { for (const v of b) this.out.push(v & 255); }
  word(v) { this.bytes(v, v >> 8); }

  header() {
    for (const c of 'GIF89a') this.bytes(c.charCodeAt(0));
    this.word(this.w); this.word(this.h);
    this.bytes(0xf7, 0, 0);   // global table, 8 bits, 256 entries
    for (let i = 0; i < 256; i++) { const c = this.pal[i] || [0, 0, 0]; this.bytes(c[0], c[1], c[2]); }
    this.bytes(0x21, 0xff, 11); for (const c of 'NETSCAPE2.0') this.bytes(c.charCodeAt(0));
    this.bytes(3, 1, 0, 0, 0);   // loop forever
  }

  /** @param {Uint8ClampedArray} rgba  @param {number} delayMs */
  addFrame(rgba, delayMs) {
    const n = this.w * this.h, idx = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) idx[p] = this.nearest(rgba[i], rgba[i + 1], rgba[i + 2]);
    const cs = Math.max(2, Math.round(delayMs / 10));
    if (this.prev) {
      let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
      for (let y = 0; y < this.h; y++) for (let x = 0, p = y * this.w; x < this.w; x++, p++) {
        if (idx[p] !== this.prev[p]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0) { this.pending.cs += cs; return; }   // nothing moved: hold the last frame longer
      this.flush();
      const fw = x1 - x0 + 1, fh = y1 - y0 + 1, sub = new Uint8Array(fw * fh);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const p = (y + y0) * this.w + x + x0;
        sub[y * fw + x] = idx[p] === this.prev[p] ? TRANSPARENT : idx[p];
      }
      this.pending = { x: x0, y: y0, w: fw, h: fh, px: sub, cs, transparent: true };
    } else {
      this.pending = { x: 0, y: 0, w: this.w, h: this.h, px: idx, cs, transparent: false };
    }
    this.prev = idx;
  }

  flush() {
    const f = this.pending;
    if (!f) return;
    this.pending = null;
    this.bytes(0x21, 0xf9, 4, (1 << 2) | (f.transparent ? 1 : 0)); this.word(f.cs); this.bytes(TRANSPARENT, 0);
    this.bytes(0x2c); this.word(f.x); this.word(f.y); this.word(f.w); this.word(f.h); this.bytes(0);
    this.lzw(f.px);
  }

  lzw(px) {
    const MIN = 8, CLEAR = 256, EOI = 257;
    this.bytes(MIN);
    const block = []; let cur = 0, bits = 0;
    const emit = (code, size) => {
      cur |= code << bits; bits += size;
      while (bits >= 8) { block.push(cur & 255); cur >>>= 8; bits -= 8; if (block.length === 255) { this.bytes(255, ...block); block.length = 0; } }
    };
    let dict = new Map(), next = EOI + 1, size = MIN + 1;
    emit(CLEAR, size);
    let prefix = px[0];
    for (let i = 1; i < px.length; i++) {
      const c = px[i], k = (prefix << 8) | c, hit = dict.get(k);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix, size);
      if (next < 4096) { dict.set(k, next++); if (next > (1 << size) && size < 12) size++; }
      else { emit(CLEAR, size); dict = new Map(); next = EOI + 1; size = MIN + 1; }
      prefix = c;
    }
    emit(prefix, size); emit(EOI, size);
    if (bits > 0) block.push(cur & 255);
    if (block.length) this.bytes(block.length, ...block);
    this.bytes(0);
  }

  /** @returns {Buffer} */
  finish() { this.flush(); this.bytes(0x3b); return Buffer.from(this.out); }
}

module.exports = { buildPalette, GifWriter };
