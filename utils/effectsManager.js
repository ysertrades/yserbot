'use strict';

const { readJson, writeJson } = require('./jsonStorage');
const FILE = 'active_effects.json';

// Effect type definitions
const EFFECT_TYPES = {
  coin_boost:   { label: '💰 Coin Boost',    desc: '1.5× earnings from /work and /jobs',  duration: 4 * 60 * 60 * 1000  },
  rob_shield:   { label: '🛡️ Rob Shield',   desc: 'Protection from /rob',                duration: 8 * 60 * 60 * 1000  },
  xp_boost:     { label: '⚡ XP Boost',      desc: '2× XP from messages',                 duration: 60 * 60 * 1000       },
  daily_boost:  { label: '☀️ Daily Boost',   desc: '+50% bonus on next /daily',           duration: 48 * 60 * 60 * 1000  },
  card_magnet:  { label: '🧲 Card Magnet',   desc: '+15% bump toward rarer cards',         duration: 2 * 60 * 60 * 1000   },
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
    .map(([type, e]) => ({ type, ...EFFECT_TYPES[type], activeUntil: e.activeUntil }));
}

module.exports = { EFFECT_TYPES, getEffect, hasEffect, setEffect, clearEffect, getActiveEffectsList };
