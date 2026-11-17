'use strict';

/**
 * imageStore.js — pictures uploaded from the panel, kept by the bot itself.
 *
 * Uploads used to be posted as a message in one of the server's channels so
 * Discord would host them. That dropped a stray image into whatever channel it
 * found first, and Discord's attachment links expire, so a saved logo stopped
 * loading a day later. Here an image is stored once (keyed by its own hash, so
 * the same picture twice is one copy) and served from /i/<id>.<ext>, a plain
 * https link that never expires and never touches a channel.
 *
 * Stored in MongoDB (collection panel_images) when the bot has a database,
 * otherwise in data/images on disk.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DIR = path.join(__dirname, '..', 'data', 'images');
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const ID_RE = /^[a-f0-9]{32}$/;

function collection() {
  try {
    const db = require('./mongoStorage').db();
    return db ? db.collection('panel_images') : null;
  } catch { return null; }
}

/** What a buffer really is, from its first bytes (never from what it claims). */
function sniff(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** data:image/...;base64,... → { buf, ext } or null. */
function fromDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  const ext = sniff(buf);
  return ext ? { buf, ext } : null;
}

function baseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
}

/**
 * Keeps an image and returns its public https link.
 * @returns {Promise<{ ok: true, id: string, url: string } | { error: string }>}
 */
async function save(buf, { guildId = null } = {}) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { error: 'bad_image' };
  if (buf.length > MAX_BYTES) return { error: 'body_too_large' };
  const ext = sniff(buf);
  if (!ext) return { error: 'bad_image' };
  const base = baseUrl();
  if (!/^https:\/\//i.test(base)) return { error: 'upload_failed', detail: 'PUBLIC_BASE_URL must be an https address.' };
  const id = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const col = collection();
  if (col) {
    await col.updateOne(
      { _id: id },
      { $setOnInsert: { _id: id, ext, size: buf.length, data: buf, guildId, createdAt: new Date() } },
      { upsert: true },
    );
  } else {
    fs.mkdirSync(DIR, { recursive: true });
    const file = path.join(DIR, `${id}.${ext}`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  }
  return { ok: true, id, url: `${base}/i/${id}.${ext}` };
}

/** @returns {Promise<{ buf: Buffer, type: string } | null>} */
async function load(id, ext) {
  if (!ID_RE.test(String(id)) || !TYPES[ext]) return null;
  const col = collection();
  if (col) {
    const doc = await col.findOne({ _id: id });
    if (!doc || doc.ext !== ext) return null;
    const buf = Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data.buffer || doc.data);
    return { buf, type: TYPES[ext] };
  }
  const file = path.join(DIR, `${id}.${ext}`);
  if (!fs.existsSync(file)) return null;
  return { buf: fs.readFileSync(file), type: TYPES[ext] };
}

/** Whether a link is one of ours (served from /i/ on this bot). */
function isOwnUrl(url) {
  const base = baseUrl();
  return !!base && String(url || '').startsWith(`${base}/i/`);
}

module.exports = { save, load, fromDataUrl, sniff, isOwnUrl, MAX_BYTES };
