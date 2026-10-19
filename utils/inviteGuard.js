'use strict';

/**
 * inviteGuard.js — finds Discord, Telegram and WhatsApp invites, however
 * they are dressed up.
 *
 * People dodge a plain regex in predictable ways, so the text is first
 * brought back to plain form and then searched:
 *   - fullwidth / styled letters (ｄｉｓｃｏｒｄ．ｇｇ)      → NFKC normalisation
 *   - zero-width and soft-hyphen characters hidden inside   → removed
 *   - "discord . gg / abc", "t .me", "wa. me"                → spaces around . and / closed up
 *   - "discord(dot)gg", "discord[.]gg", "discord dot gg"     → a real dot
 *   - "hxxps://", escaped dots ("discord\.gg"), <angle> or [markdown](links)
 * and it covers the hosts invites actually travel through, not just the
 * main domain: discord.gg/.com/invite/app, dsc.gg, discord.me/.io/.li,
 * invite.gg, disboard joins; t.me, telegram.me/.dog, tg:// links;
 * wa.me, wa.link, chat.whatsapp.com, whatsapp.com/channel, api/web send.
 */

const ZERO_WIDTH = /[​-‏‪-‮⁠-⁤﻿­͏᠎]/g;

function normalise(text) {
  let s = String(text || '');
  try { s = s.normalize('NFKC'); } catch { /* very old runtimes */ }
  s = s.replace(ZERO_WIDTH, '')
    .replace(/hxxp(s?):\/\//gi, 'http$1://')
    .replace(/\\([./])/g, '$1')
    .replace(/[\[(<{]\s*(?:dot|\.)\s*[\])>}]/gi, '.')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/[。．․·•・]/g, '.')
    .replace(/[⁄∕／]/g, '/');
  // close up spaces around the dots and slashes of a host or path
  s = s.replace(/([a-z0-9])\s*\.\s*(gg|com|me|io|li|link|dog|org)\b/gi, '$1.$2')
    .replace(/\b(t|wa)\s*\.\s*me\b/gi, '$1.me')
    .replace(/(\.(?:gg|com|me|io|li|link|dog|org))\s*\/\s*/gi, '$1/')
    .replace(/(invite|join|joinchat|channel|server)\s*\/\s*/gi, '$1/');
  return s;
}

const CODE = String.raw`[A-Za-z0-9][A-Za-z0-9_-]{1,40}`;
const RULES = [
  { platform: 'Discord', re: new RegExp(String.raw`(?:discord(?:app)?\.com\/invite|discord\.(?:gg|io|me|li|link)|dsc\.gg|invite\.gg|discord\.com\/channels\/@me\/invite)\/(${CODE})`, 'gi') },
  { platform: 'Discord', re: new RegExp(String.raw`disboard\.org\/server\/join\/(${CODE})`, 'gi') },
  { platform: 'Telegram', re: new RegExp(String.raw`(?:t|telegram)\.(?:me|dog)\/(?:joinchat\/|\+|s\/|c\/)?([A-Za-z0-9_+-]{3,64})`, 'gi') },
  { platform: 'Telegram', re: /tg:\/\/(?:join|resolve|msg|privatepost)\?[^\s]+/gi },
  { platform: 'Telegram', re: /telegram\.org\/(?:joinchat|s)\/[^\s]+/gi },
  { platform: 'WhatsApp', re: /(?:wa\.me|wa\.link)\/[^\s]+/gi },
  { platform: 'WhatsApp', re: /chat\.whatsapp\.com\/[^\s]+/gi },
  { platform: 'WhatsApp', re: /(?:www\.)?whatsapp\.com\/(?:channel|invite)\/[^\s]+/gi },
  { platform: 'WhatsApp', re: /(?:api|web)\.whatsapp\.com\/send[^\s]*/gi },
];

/**
 * @returns {{ platform: string, url: string, code: string|null }[]} every
 *   invite in the text, de-duplicated, in the order found
 */
function findInvites(text) {
  const raw = String(text || '');
  const s = normalise(raw);
  const seen = new Set(), out = [];
  for (const { platform, re } of RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const url = m[0].replace(/[)\]>.,!?*_~`|'"]+$/, '');
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ platform, url, code: platform === 'Discord' ? (m[1] || null) : null });
    }
  }
  return out;
}

/** True when the text only matched after it was cleaned up: it was dressed up on purpose. */
function wasDisguised(text) {
  const raw = String(text || '');
  const plain = findInvites(raw.replace(ZERO_WIDTH, '')).length;
  const strict = RULES.some(({ re }) => { re.lastIndex = 0; return re.test(raw); });
  return plain > 0 && !strict;
}

/** example.gg/abc → example[.]gg/abc, so the report can quote it without a live link. */
const defang = url => String(url).replace(/^https?:\/\//i, '').replace(/\./g, '[.]');

module.exports = { findInvites, normalise, wasDisguised, defang, RULES };
