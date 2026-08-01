'use strict';

/**
 * bannerCopy.js
 *
 * The wording on the TradingView and Whop banners, saved per guild.
 *
 * These two images are the only dynamic embed images that take arguments —
 * the rest are fixed art. The Studio screen edits that wording, and this is
 * where the result lives so that the banner an embed actually sends matches
 * the one Studio previewed. Before this existed Studio was preview-only:
 * dynamicEmbedImages called the generators with no arguments at all, so every
 * embed rendered the defaults no matter what had been typed.
 *
 * Normalisation lives here rather than in either caller because both the
 * preview endpoint and the save path have to apply exactly the same rules. If
 * they drifted, Studio would show one thing and Discord would send another —
 * which is the bug this module exists to close.
 */

const { readJson, writeJson } = require('./jsonStorage');
const { TV_DEFAULTS } = require('./tradingViewVisual');
const { WHOP_DEFAULTS } = require('./whopVisual');

const FILE = 'banner_copy.json';

// Caps chosen from what the card can actually show: past these the renderer
// starts shrinking type toward unreadable rather than laying out badly.
const LIMITS = { pill: 16, heading: 28, subtitle: 44, tagline: 130 };

/**
 * The editable banners.
 *
 * `dynamicKey` ties each one back to its entry in dynamicEmbedImages, which is
 * what an embed template references as `dynamic:<key>`. Keeping the two names
 * in one table is what stops the Studio key and the embed key drifting apart.
 */
const BANNERS = {
  tradingview: { label: 'TradingView indicator', dynamicKey: 'tradingViewBanner', defaults: TV_DEFAULTS },
  whop:        { label: 'Whop membership',       dynamicKey: 'whopBanner',        defaults: WHOP_DEFAULTS },
};

const byDynamicKey = new Map(Object.entries(BANNERS).map(([key, b]) => [b.dynamicKey, key]));

/**
 * Cleans copy coming off the Studio form.
 *
 * The pixel font has no lower case — drawChar upper-cases anyway — and
 * silently skips any character it has no glyph for. Upper-casing here means
 * what the field shows is what the image will say.
 *
 * An emptied field is dropped rather than stored blank, so it falls back to
 * the default instead of rendering a gap.
 */
function normalise(templateKey, input = {}) {
  const banner = BANNERS[templateKey];
  if (!banner) return {};
  const out = {};
  for (const field of Object.keys(banner.defaults)) {
    const raw = input[field];
    if (raw === undefined || raw === null) continue;
    const clean = String(raw).replace(/\s+/g, ' ').trim().toUpperCase().slice(0, LIMITS[field]);
    if (clean) out[field] = clean;
  }
  return out;
}

/** Saved copy for one banner, or {} when it has never been customised. */
function getBannerCopy(guildId, templateKey) {
  if (!guildId || !BANNERS[templateKey]) return {};
  const stored = readJson(FILE, {})[guildId]?.[templateKey];
  return stored && typeof stored === 'object' ? { ...stored } : {};
}

/**
 * Copy for a dynamicEmbedImages key, which is what the send path holds.
 * Returns {} for guilds with nothing saved, so the generator falls back to its
 * own defaults and the memoised default render stays a cache hit.
 */
function copyForDynamicKey(guildId, dynamicKey) {
  const templateKey = byDynamicKey.get(dynamicKey);
  return templateKey ? getBannerCopy(guildId, templateKey) : {};
}

/** Everything the Studio screen needs to show what is currently saved. */
function allBannerCopy(guildId) {
  const out = {};
  for (const key of Object.keys(BANNERS)) out[key] = getBannerCopy(guildId, key);
  return out;
}

/**
 * Saves one banner's copy. Passing empty copy clears it back to the defaults
 * rather than storing a row of blanks.
 */
function setBannerCopy(guildId, templateKey, input) {
  if (!BANNERS[templateKey]) return null;
  const clean = normalise(templateKey, input);
  const all = readJson(FILE, {});
  if (!all[guildId]) all[guildId] = {};

  if (Object.keys(clean).length === 0) delete all[guildId][templateKey];
  else all[guildId][templateKey] = clean;

  if (Object.keys(all[guildId]).length === 0) delete all[guildId];
  writeJson(FILE, all);
  return clean;
}

/** Which fields differ from the defaults — used for the mod-log line. */
function changedFields(templateKey, copy) {
  const banner = BANNERS[templateKey];
  if (!banner) return [];
  return Object.keys(banner.defaults).filter(f => (copy[f] || banner.defaults[f]) !== banner.defaults[f]);
}

module.exports = {
  BANNERS, LIMITS, normalise,
  getBannerCopy, setBannerCopy, allBannerCopy, copyForDynamicKey, changedFields,
};
