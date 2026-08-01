'use strict';

/**
 * linkInsight.js
 *
 * The context a moderator needs to judge a link request.
 *
 * The approval card used to show the link, a reason and nothing else, which
 * makes every request look the same — a regular of two years asking to share
 * their own site reads identically to an account made this morning posting a
 * shortener. Everything here is drawn from what Discord and the request
 * history already know, so it costs no lookups and cannot be gamed by the
 * wording of the request.
 *
 * These are signals, deliberately not a score. A shortener from a long-
 * standing member is usually fine; the same link from a day-old account
 * usually is not, and that judgement belongs to the person reading the card,
 * not to a threshold in here.
 */

// Shorteners hide where a link actually goes, which is the single most useful
// thing to flag — it is why they turn up in scams far more than in ordinary
// conversation.
const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.cc', 'bl.ink',
  's.id', 'v.gd', 'linktr.ee', 'shorte.st', 'adf.ly',
]);

// Domains that look like Discord but are not. A lookalike is the classic
// token-stealer setup, so it is worth calling out explicitly.
const DISCORD_REAL = new Set([
  'discord.com', 'discord.gg', 'discordapp.com', 'discord.media',
  'cdn.discordapp.com', 'media.discordapp.net', 'discordstatus.com',
]);

/**
 * Folds the letter pairs that are used to fake a domain at a glance.
 *
 * "discorcl.com" and "discord.com" are indistinguishable in most UI fonts,
 * and so are rn/m and vv/w. Matching the raw string misses every one of them —
 * a plain /discord/ test does not fire on "discorcl", which is exactly the
 * spelling a scam uses. Folding first means the check is on what the domain
 * *looks* like rather than what it is.
 */
function foldHomoglyphs(text) {
  return String(text).toLowerCase()
    // Pairs first: "cl" has to become "d" before the single-letter folds turn
    // its l into something else, or "discorcl" never reaches "discord".
    .replace(/rn/g, 'm')
    .replace(/cl/g, 'd')
    .replace(/vv/g, 'w')
    // Then the characters that share a shape. i / l / 1 / | are one glyph to
    // the eye in most UI fonts, so they collapse to one letter here.
    .replace(/0/g, 'o')
    .replace(/[l1|]/g, 'i')
    .replace(/5/g, 's')
    .replace(/[^a-z.]/g, '');
}

// Folded the same way, so the comparison is like for like.
const DISCORD_FOLDED = foldHomoglyphs('discord');

function looksLikeDiscord(domain) {
  if (DISCORD_REAL.has(domain)) return false;
  // A subdomain of a real Discord host is still Discord.
  if (DISCORD_REAL.has(domain.split('.').slice(-2).join('.'))) return false;
  return foldHomoglyphs(domain).includes(DISCORD_FOLDED);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Splits a URL into the parts worth showing, without throwing on rubbish. */
function parseLink(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, domain: '', scheme: '', path: '' };

  // The filter accepts bare www.example.com, which URL() will not parse
  // without a scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    return {
      ok: true,
      scheme: /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? url.protocol.replace(':', '') : '',
      domain: url.hostname.replace(/^www\./i, '').toLowerCase(),
      path: `${url.pathname}${url.search}`.replace(/^\/$/, ''),
    };
  } catch {
    return { ok: false, domain: '', scheme: '', path: '' };
  }
}

/**
 * @param {string} raw the link
 * @param {object} [who]
 *   accountCreatedAt — ms, from the snowflake
 *   joinedAt         — ms
 *   history          — { approved, denied }
 * @returns {{domain: string, flags: Array<{level: string, text: string}>}}
 */
function analyse(raw, who = {}) {
  const { ok, domain, scheme, path } = parseLink(raw);
  const flags = [];

  if (!ok || !domain) {
    flags.push({ level: 'warn', text: 'Could not read this as a web address' });
    return { domain: '', scheme, path, flags };
  }

  if (SHORTENERS.has(domain)) {
    flags.push({ level: 'warn', text: 'Shortened link — the real destination is hidden' });
  }
  if (looksLikeDiscord(domain)) {
    flags.push({ level: 'danger', text: 'Looks like a Discord address but is not one' });
  }
  // Punycode means the domain was written with non-Latin characters that can
  // look identical to ordinary ones — "dıscord.com" with a dotless Turkish ı
  // arrives here as xn--dscord-p9a.com. Rather than chase each confusable
  // character, flag the whole class: URL() has already done the conversion,
  // and a genuinely non-English domain being called out is a small cost.
  if (domain.split('.').some(part => part.startsWith('xn--'))) {
    flags.push({ level: 'danger', text: 'Written with non-Latin characters that can mimic ordinary ones' });
  }
  // A bare IP is almost never how a legitimate link is shared.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
    flags.push({ level: 'danger', text: 'Points at a raw IP address rather than a domain' });
  }
  if (scheme === 'http') {
    flags.push({ level: 'note', text: 'Plain http, not https' });
  }

  const now = Date.now();
  if (Number.isFinite(who.accountCreatedAt)) {
    const days = Math.floor((now - who.accountCreatedAt) / DAY_MS);
    if (days < 7) flags.push({ level: 'danger', text: `Account is only ${days === 0 ? 'hours' : `${days} day${days === 1 ? '' : 's'}`} old` });
    else if (days < 30) flags.push({ level: 'warn', text: `Account is ${days} days old` });
  }
  if (Number.isFinite(who.joinedAt)) {
    const days = Math.floor((now - who.joinedAt) / DAY_MS);
    if (days < 1) flags.push({ level: 'warn', text: 'Joined this server today' });
  }

  const history = who.history || {};
  if (history.denied > 0) {
    flags.push({ level: 'warn', text: `${history.denied} previous request${history.denied === 1 ? '' : 's'} denied` });
  }
  if (history.approved >= 3 && !history.denied) {
    flags.push({ level: 'good', text: `${history.approved} previous requests, all approved` });
  }

  return { domain, scheme, path, flags };
}

/** "3 years", "8 months", "4 days" — the age of something, at one unit. */
function humanAge(ts) {
  if (!Number.isFinite(ts)) return 'unknown';
  const days = Math.max(0, Math.floor((Date.now() - ts) / DAY_MS));
  if (days >= 365) { const y = Math.floor(days / 365); return `${y} year${y === 1 ? '' : 's'}`; }
  if (days >= 30) { const m = Math.floor(days / 30); return `${m} month${m === 1 ? '' : 's'}`; }
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  return 'today';
}

const FLAG_ICON = { danger: '🛑', warn: '⚠️', note: 'ℹ️', good: '✅' };

/** The flags as lines for an embed, or a single reassuring line when there are none. */
function flagLines(flags) {
  if (!flags.length) return '✅ Nothing unusual about this one.';
  return flags.map(f => `${FLAG_ICON[f.level] || '•'} ${f.text}`).join('\n');
}

/** The worst level present, for colouring the card. */
function severity(flags) {
  if (flags.some(f => f.level === 'danger')) return 'danger';
  if (flags.some(f => f.level === 'warn')) return 'warn';
  return 'clear';
}

module.exports = { analyse, parseLink, humanAge, flagLines, severity, looksLikeDiscord, FLAG_ICON, SHORTENERS };
