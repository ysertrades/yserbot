'use strict';

const { readJson, writeJson } = require('../utils/jsonStorage');
const { GAME_KEYS } = require('./games');
const FILE = 'casino-settings.json';

const DEFAULTS = {
  minBet:     50,
  maxBet:     50000,
  cooldownMs: 0,
  // The quick-bet buttons on the bet screen. Four, because that row also
  // carries All In and Discord allows five buttons per row.
  presets:    [25, 100, 250, 500],
  // Per-game switches. Absent means on, so a game added later is playable
  // without every guild having to opt into it first.
  games:      {},
};

const PRESET_COUNT = 4;

function getSettings(guildId) {
  const data = readJson(FILE, {});
  const stored = data[guildId] || {};
  return {
    ...DEFAULTS,
    ...stored,
    presets: normalisePresets(stored.presets),
    games: { ...stored.games },
  };
}

/**
 * Always four sane, ascending, distinct amounts.
 *
 * The bet row is built one button per entry, so a short or malformed list
 * would quietly produce a row with gaps in it rather than anything that reads
 * as an error — hence topping up from the defaults instead of trusting input.
 */
function normalisePresets(input) {
  const clean = (Array.isArray(input) ? input : [])
    .map(n => Math.floor(Number(n)))
    .filter(n => Number.isFinite(n) && n > 0 && n <= 1e9);
  const unique = [...new Set(clean)].sort((a, b) => a - b).slice(0, PRESET_COUNT);
  for (const fallback of DEFAULTS.presets) {
    if (unique.length >= PRESET_COUNT) break;
    if (!unique.includes(fallback)) unique.push(fallback);
  }
  return unique.sort((a, b) => a - b).slice(0, PRESET_COUNT);
}

/** Whether a game may be opened. Unknown keys are refused rather than allowed. */
function isGameEnabled(guildId, key) {
  if (!GAME_KEYS.includes(key)) return false;
  return getSettings(guildId).games[key] !== false;
}

function enabledGames(guildId) {
  const { games } = getSettings(guildId);
  return GAME_KEYS.filter(k => games[k] !== false);
}

function setSettings(guildId, updates) {
  const data = readJson(FILE, {});
  // Strip any legacy coinflipWinChance key if present
  const { coinflipWinChance, ...clean } = updates;
  if (clean.presets) clean.presets = normalisePresets(clean.presets);
  data[guildId] = { ...(data[guildId] || {}), ...clean };
  writeJson(FILE, data);
  return getSettings(guildId);
}

module.exports = {
  getSettings, setSettings, DEFAULTS,
  isGameEnabled, enabledGames, normalisePresets, PRESET_COUNT,
};
