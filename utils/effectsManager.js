'use strict';

const { readJson, writeJson } = require('./jsonStorage');
const FILE = 'active_effects.json';

// Effect type definitions. `duration` here is the default when an effect is
// applied with no override — shop items can carry their own `multiplier`
// and/or `activeUntil` in extraData (see setEffect) so one type (e.g.
// coin_boost) can back several priced tiers instead of a single fixed rate.
const EFFECT_TYPES = {
  coin_boost:      { label: '💰 Coin Boost',      desc: 'Boosted earnings from /work, /jobs, /fish, /mine, /trivia & /daily', duration: 4 * 60 * 60 * 1000 },
  rob_shield:      { label: '🛡️ Rob Shield',     desc: 'Protection from /rob',                    duration: 8 * 60 * 60 * 1000 },
  xp_boost:        { label: '⚡ XP Boost',        desc: '2× XP from messages',                     duration: 60 * 60 * 1000 },
  daily_boost:     { label: '☀️ Daily Boost',     desc: '+50% bonus on next /daily',               duration: 48 * 60 * 60 * 1000 },
  card_magnet:     { label: '🧲 Card Magnet',     desc: '+15% bump toward rarer cards',            duration: 2 * 60 * 60 * 1000 },
  vip_casino_pass: { label: '👑 VIP Casino Pass', desc: 'Raises your personal casino max bet',     duration: 6 * 60 * 60 * 1000 },
};

function getEffects(userId, guildId) {
  const data = readJson(FILE, {});
  return data[userId]?.[guildId] || {};
}

function getEffect(userId, guildId, type) {
  const effects = getEffects(userId, guildId);
  const e = effects[type];
  if (!e) return null;
  if (e.activeUntil <= Date.now()) return null; // expired
  return e;
}

function hasEffect(userId, guildId, type) {
  return !!getEffect(userId, guildId, type);
}

function setEffect(userId, guildId, type, extraData = {}) {
  const def = EFFECT_TYPES[type];
  if (!def) return;
  const data = readJson(FILE, {});
  if (!data[userId]) data[userId] = {};
  if (!data[userId][guildId]) data[userId][guildId] = {};
  data[userId][guildId][type] = { activeUntil: Date.now() + def.duration, ...extraData };
  writeJson(FILE, data);
}

function clearEffect(userId, guildId, type) {
  const data = readJson(FILE, {});
  if (data[userId]?.[guildId]?.[type]) {
    delete data[userId][guildId][type];
    writeJson(FILE, data);
  }
}

function getActiveEffectsList(userId, guildId) {
  const effects = getEffects(userId, guildId);
  const now = Date.now();
  return Object.entries(effects)
    .filter(([, e]) => e.activeUntil > now)
    // spread e last so a purchase's own multiplier/activeUntil override the type defaults
    .map(([type, e]) => ({ type, ...EFFECT_TYPES[type], ...e }));
}

// Effective personal casino max-bet: the guild's configured cap, raised by
// an active VIP Casino Pass (falls back to a 2× default if the purchase
// didn't carry its own betMultiplier).
function getEffectiveMaxBet(userId, guildId, baseMax) {
  const pass = getEffect(userId, guildId, 'vip_casino_pass');
  if (!pass) return baseMax;
  return Math.floor(baseMax * (pass.betMultiplier || 2));
}

module.exports = { EFFECT_TYPES, getEffect, hasEffect, setEffect, clearEffect, getActiveEffectsList, getEffectiveMaxBet };
