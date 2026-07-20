'use strict';

const { readJson, writeJson } = require('../utils/jsonStorage');
const FILE = 'casino-settings.json';

const DEFAULTS = {
  minBet:     50,
  maxBet:     50000,
  cooldownMs: 0,
};

function getSettings(guildId) {
  const data = readJson(FILE, {});
  return { ...DEFAULTS, ...(data[guildId] || {}) };
}

function setSettings(guildId, updates) {
  const data = readJson(FILE, {});
  // Strip any legacy coinflipWinChance key if present
  const { coinflipWinChance, ...clean } = updates;
  data[guildId] = { ...(data[guildId] || {}), ...clean };
  writeJson(FILE, data);
  return getSettings(guildId);
}

module.exports = { getSettings, setSettings, DEFAULTS };
