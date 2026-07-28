'use strict';

// ── Built-in filter word list ────────────────────────────────────────────
// Common profanity, harassment/self-harm-encouraging phrases, and slurs
// commonly moderated on Discord. Servers can extend this per-guild via
// `/automod addword`. Matching is done on a normalized (lowercased,
// leetspeak-collapsed) copy of the message so simple evasion like "k1ll
// yourself" or "n1gg3r" still gets caught.
const BUILTIN_WORDS = [
  // Profanity
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch',
  'asshole', 'bastard', 'cunt', 'dick', 'piss', 'douchebag', 'twat', 'wanker',
  'slut', 'whore', 'skank',
  // Harassment / self-harm-encouraging phrases
  'kill yourself', 'kys', 'go die', 'you should die', 'i hope you die',
  'nobody likes you', 'kill urself', 'end yourself', 'neck yourself',
  // Slurs (racial, homophobic, ableist — commonly moderated)
  'nigger', 'nigga', 'chink', 'spic', 'gook', 'kike', 'wetback', 'beaner',
  'faggot', 'fag', 'dyke', 'tranny', 'retard', 'retarded',
];

// Leetspeak / common substitution normalization so "n1gg3r", "f*ck",
// "sh1t" etc. still match the plain-word list above.
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

// Non-letters become spaces (not deleted) so punctuation-spaced evasion like
// "f.u.c.k" turns into single-letter tokens the spacing collapse below can
// catch, then repeated letters collapse to one ("fuuuck" -> "fuck") — applied
// identically to both the message and every dictionary entry, so as long as
// both sides go through the same pipeline the exact repeat count never matters.
function normalize(text) {
  let out = text.toLowerCase();
  out = out.replace(/[013457@$]/g, ch => LEET_MAP[ch] || ch);
  out = out.replace(/[^a-z\s]/g, ' ');
  out = out.replace(/(.)\1+/g, '$1');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

// Collapses runs of individually-spaced single letters ("k y s", "f u c k")
// into one token, without touching normal multi-letter words — so "class"
// or "Dickinson" are never mistaken for spaced-out evasion.
function collapseSpacedLetters(text) {
  return text.replace(/\b\w\b(?:\s+\w\b)+/g, m => m.replace(/\s+/g, ''));
}

/**
 * Returns the first matched bad word/phrase found in `text`, or null.
 * `customWords` is an optional per-guild extra list (already lowercase).
 */
function findBadWord(text, customWords = []) {
  if (!text) return null;
  const normalized = collapseSpacedLetters(normalize(text));
  const all = [...BUILTIN_WORDS, ...customWords];

  for (const word of all) {
    const w = normalize(word);
    if (!w) continue;
    if (w.includes(' ')) {
      // Multi-word phrase — plain substring match on the normalized text.
      if (normalized.includes(w)) return word;
    } else {
      // Single word — whole-word boundary match only, so it can never
      // fire on a normal word that merely contains it as a substring.
      const re = new RegExp(`\\b${w}\\b`);
      if (re.test(normalized)) return word;
    }
  }
  return null;
}

module.exports = { BUILTIN_WORDS, findBadWord, normalize };
