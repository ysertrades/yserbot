'use strict';

/**
 * web/casino.js
 *
 * The casino, from the panel.
 *
 * /casino-settings covers three numbers and nothing else, so the things most
 * worth changing — which games are open, what the quick-bet buttons offer —
 * had no way to be changed at all. They do now, and everything here writes
 * through casino/settings.js so the panel cannot produce a configuration the
 * command would refuse.
 *
 * Odds are deliberately not editable. Every game draws from an unweighted
 * random source and says so on the menu; a house-edge dial would make that
 * claim untrue, and it is the kind of setting that is easy to add and very
 * hard to notice the effect of.
 */

const { getSettings, setSettings, DEFAULTS, PRESET_COUNT, normalisePresets } = require('../casino/settings');
const { GAMES } = require('../casino/games');

const FIELDS = [
  { key: 'minBet', label: 'Minimum bet', type: 'int', min: 1, max: 1e7 },
  { key: 'maxBet', label: 'Maximum bet', type: 'int', min: 1, max: 1e9 },
  { key: 'cooldownSeconds', label: 'Cooldown between games (seconds)', type: 'int', min: 0, max: 3600 },
];

/** Everything the Casino screen shows. */
function read(guildId) {
  const s = getSettings(guildId);
  return {
    fields: FIELDS,
    values: {
      minBet: s.minBet,
      maxBet: s.maxBet,
      // Stored in milliseconds; nobody wants to type 30000 for half a minute.
      cooldownSeconds: Math.round((s.cooldownMs || 0) / 1000),
    },
    presets: s.presets,
    presetCount: PRESET_COUNT,
    games: GAMES.map(g => ({
      key: g.key,
      label: `${g.emoji} ${g.label}`,
      enabled: s.games[g.key] !== false,
    })),
    defaults: {
      minBet: DEFAULTS.minBet,
      maxBet: DEFAULTS.maxBet,
      cooldownSeconds: Math.round(DEFAULTS.cooldownMs / 1000),
      presets: DEFAULTS.presets,
    },
  };
}

/* ─── writing ────────────────────────────────────────────────────────────── */

function save(guildId, body) {
  const current = getSettings(guildId);
  const patch = {};
  const changed = [];

  for (const f of FIELDS) {
    if (!(f.key in body)) continue;
    const n = Number(body[f.key]);
    if (!Number.isInteger(n) || n < f.min || n > f.max) return { error: 'bad_value', field: f.key };

    if (f.key === 'cooldownSeconds') {
      const ms = n * 1000;
      if (ms === current.cooldownMs) continue;
      patch.cooldownMs = ms;
      changed.push(n > 0 ? `cooldown ${n}s` : 'cooldown off');
      continue;
    }
    if (n === current[f.key]) continue;
    patch[f.key] = n;
    changed.push(`${f.label.toLowerCase()} ${n.toLocaleString()}`);
  }

  // Checked against the values that will actually be stored, not the ones that
  // arrived — changing only one of the pair still has to leave a playable
  // range behind. A min above max is a casino nobody can bet in.
  const nextMin = patch.minBet ?? current.minBet;
  const nextMax = patch.maxBet ?? current.maxBet;
  if (nextMin >= nextMax) return { error: 'min_above_max' };

  if ('presets' in body) {
    if (!Array.isArray(body.presets)) return { error: 'bad_presets' };
    const wanted = body.presets.map(n => Math.floor(Number(n)));
    if (wanted.some(n => !Number.isFinite(n) || n < 1 || n > 1e9)) return { error: 'bad_presets' };
    const next = normalisePresets(wanted);
    if (next.join() !== current.presets.join()) {
      patch.presets = next;
      changed.push(`quick bets ${next.join(' / ')}`);
    }
  }

  if (body.games && typeof body.games === 'object') {
    const games = { ...current.games };
    const turned = [];
    for (const g of GAMES) {
      const want = body.games[g.key];
      if (typeof want !== 'boolean') continue;
      const now = games[g.key] !== false;
      if (want === now) continue;
      // Written as an explicit false rather than deleted, so "on" and "never
      // set" stay distinguishable in storage.
      if (want) delete games[g.key];
      else games[g.key] = false;
      turned.push(`${g.label} ${want ? 'on' : 'off'}`);
    }
    if (turned.length) {
      patch.games = games;
      changed.push(turned.join(', '));
    }
  }

  if (!changed.length) return { unchanged: true };
  setSettings(guildId, patch);
  return { ok: true, changed };
}

module.exports = { read, save, FIELDS };
