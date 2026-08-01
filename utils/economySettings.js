'use strict';

/**
 * economySettings.js
 *
 * Every number the economy runs on, per server.
 *
 * Until now these were constants at the top of eight different files:
 * /work paid 50–200 on an hour's cooldown, /rob succeeded 55% of the time,
 * the bank paid 2% every twelve hours, and none of it could be changed without
 * editing the source and redeploying. A server that wanted a slower economy —
 * or one that simply did not want /rob in it — had no way to say so.
 *
 * The shape mirrors casino/settings.js: one file, keyed by guild, defaults
 * merged in on read. Absent means default, so a value added here later is live
 * everywhere without a migration.
 *
 * Two things deliberately do NOT live here:
 *
 *   • Odds that decide who wins against whom. /rob's success rate is the one
 *     exception and it is bounded to 5–95%, because a 0% or 100% rob is not a
 *     game, it is a bug report waiting to happen.
 *   • The reward tables themselves (which fish exist, what trivia asks). Those
 *     are content, they belong in their own modules, and a web form is a poor
 *     place to edit a weighted table.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'economy_settings.json';

const HOUR = 3600000;

/**
 * The activities, their defaults, and what each field means.
 *
 * `fields` is read by the control panel to build its form, and by save() to
 * validate — one description, so the panel cannot offer a value the store
 * would refuse.
 */
const ACTIVITIES = {
  work: {
    label: 'Work', emoji: '💼', command: '/work',
    blurb: 'A single shift on a cooldown. The bread-and-butter earner.',
    defaults: { enabled: true, cooldownMs: HOUR, min: 50, max: 200 },
    fields: [
      { key: 'enabled', type: 'bool', label: 'Command available' },
      { key: 'cooldownMs', type: 'duration', label: 'Cooldown', min: 0, max: 7 * 24 * HOUR },
      { key: 'min', type: 'int', label: 'Lowest payout', min: 0, max: 10_000_000 },
      { key: 'max', type: 'int', label: 'Highest payout', min: 1, max: 10_000_000 },
    ],
    pair: ['min', 'max'],
  },

  daily: {
    label: 'Daily', emoji: '📅', command: '/daily',
    blurb: 'The once-a-day claim. Payout is a weighted roll — the scale lifts every tier at once.',
    defaults: { enabled: true, cooldownMs: 24 * HOUR, payScale: 1 },
    fields: [
      { key: 'enabled', type: 'bool', label: 'Command available' },
      { key: 'cooldownMs', type: 'duration', label: 'Cooldown', min: 0, max: 30 * 24 * HOUR },
      { key: 'payScale', type: 'float', label: 'Payout scale (×)', min: 0.1, max: 10 },
    ],
  },

  jobs: {
    label: 'Jobs', emoji: '🏢', command: '/jobs',
    blurb: 'Eight careers, each with its own pay band and shift length. The scales move all of them together; the switches below decide which are hiring.',
    defaults: { enabled: true, payScale: 1, cooldownScale: 1, closed: {} },
    fields: [
      { key: 'enabled', type: 'bool', label: 'Command available' },
      { key: 'payScale', type: 'float', label: 'Pay scale (×)', min: 0.1, max: 10 },
      { key: 'cooldownScale', type: 'float', label: 'Shift length scale (×)', min: 0.1, max: 10 },
    ],
  },

  fish: {
    label: 'Fishing', emoji: '🎣', command: '/fish',
    blurb: 'A session of casts, then a cooldown that only starts once the session is spent.',
    defaults: { enabled: true, cooldownMs: 2 * HOUR, sessionUses: 10, payScale: 1 },
    fields: [
      { key: 'enabled', type: 'bool', label: 'Command available' },
      { key: 'cooldownMs', type: 'duration', label: 'Cooldown after a session', min: 0, max: 7 * 24 * HOUR },
      { key: 'sessionUses', type: 'int', label: 'Casts per session', min: 1, max: 100 },
      { key: 'payScale', type: 'float', label: 'Payout scale (×)', min: 0.1, max: 10 },
    ],
  },

  mine: {
    label: 'Mining', emoji: '⛏️', command: '/mine',
    blurb: 'Same session mechanic as fishing, its own table and its own dial.',
    defaults: { enabled: true, cooldownMs: 2 * HOUR, sessionUses: 10, payScale: 1 },
    fields: [
      { key: 'enabled', type: 'bool', label: 'Command available' },
      { key: 'cooldownMs', type: 'duration', label: 'Cooldown after a session', min: 0, max: 7 * 24 * HOUR },
      { key: 'sessionUses', type: 'int', label: 'Swings per session', min: 1, max: 100 },
      { key: 'payScale', type: 'float', label: 'Payout scale (×)', min: 0.1, max: 10 },
    ],
  },

  trivia: {
    label: 'Trivia', emoji: '🧠', command: '/trivia',
    blurb: 'A timed run of questions. Each correct answer raises the band the next one pays from.',
    defaults: {
      enabled: true, cooldownMs: 2 * HOUR, questions: 6,
      secondsPerQuestion: 15, rewardMin: 50, rewardMax: 120,
    },
    fields: [
      { key: 'enabled', type: 'bool', label: 'Command available' },
      { key: 'cooldownMs', type: 'duration', label: 'Cooldown after a run', min: 0, max: 7 * 24 * HOUR },
      { key: 'questions', type: 'int', label: 'Questions per run', min: 1, max: 25 },
      { key: 'secondsPerQuestion', type: 'int', label: 'Seconds to answer', min: 5, max: 120 },
      { key: 'rewardMin', type: 'int', label: 'Lowest per answer', min: 0, max: 1_000_000 },
      { key: 'rewardMax', type: 'int', label: 'Highest per answer', min: 1, max: 1_000_000 },
    ],
    pair: ['rewardMin', 'rewardMax'],
  },

  rob: {
    label: 'Robbery', emoji: '🕵️', command: '/rob',
    blurb: 'The only command that takes coins off another member. Switch it off and it disappears entirely.',
    defaults: {
      enabled: true, cooldownMs: 90 * 60 * 1000, successPercent: 55,
      minTarget: 200, maxSteal: 2500, finePercent: 5, fineCap: 1000,
    },
    fields: [
      { key: 'enabled', type: 'bool', label: 'Command available' },
      { key: 'cooldownMs', type: 'duration', label: 'Cooldown', min: 0, max: 7 * 24 * HOUR },
      // Bounded away from both ends: a guaranteed rob is theft with extra
      // steps, and one that never works is a command that only ever fines you.
      { key: 'successPercent', type: 'int', label: 'Success chance (%)', min: 5, max: 95 },
      { key: 'minTarget', type: 'int', label: 'Target must hold at least', min: 0, max: 10_000_000 },
      { key: 'maxSteal', type: 'int', label: 'Most that can be taken', min: 1, max: 10_000_000 },
      { key: 'finePercent', type: 'int', label: 'Fine when caught (% of target)', min: 0, max: 100 },
      // Without a ceiling, failing against the richest member in the server
      // is a catastrophe rather than a setback.
      { key: 'fineCap', type: 'int', label: 'Most a fine can be', min: 0, max: 10_000_000 },
    ],
  },

  bank: {
    label: 'Bank', emoji: '🏦', command: '/bank',
    blurb: 'Deposited coins earn interest on a fixed period. Interest is credited when the balance is next looked at, so a longer period is cheaper, not slower.',
    defaults: { enabled: true, interestPercent: 2, periodHours: 12 },
    fields: [
      { key: 'enabled', type: 'bool', label: 'Command available' },
      { key: 'interestPercent', type: 'float', label: 'Interest per period (%)', min: 0, max: 50 },
      { key: 'periodHours', type: 'int', label: 'Hours per period', min: 1, max: 720 },
    ],
  },
};

const ACTIVITY_KEYS = Object.keys(ACTIVITIES);

/**
 * The server-wide dials that sit above the per-activity ones.
 *
 * `multiplier` is the blunt instrument — one number that lifts or flattens
 * every payout at once, which is what you actually reach for after a giveaway
 * has flooded the economy.
 *
 * The boost window is the thing the big bots make you buy: a couple of hours a
 * day where everything pays more, on the clock, without anyone having to
 * remember to switch it on and off.
 */
const GLOBAL_DEFAULTS = {
  multiplier: 1,
  boost: { enabled: false, multiplier: 2, startHour: 18, endHour: 20, offsetMinutes: 0 },
};

/* ─── reading ────────────────────────────────────────────────────────────── */

function getSettings(guildId) {
  const stored = readJson(FILE, {})[guildId] || {};
  const out = {
    multiplier: numberOr(stored.multiplier, GLOBAL_DEFAULTS.multiplier),
    boost: { ...GLOBAL_DEFAULTS.boost, ...(stored.boost || {}) },
  };
  for (const key of ACTIVITY_KEYS) {
    out[key] = { ...ACTIVITIES[key].defaults, ...(stored[key] || {}) };
  }
  // Jobs keeps a map rather than a flat value, so a spread is not enough.
  out.jobs.closed = { ...(stored.jobs?.closed || {}) };
  return out;
}

const numberOr = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** One activity's settings. The hot path — every earning command calls it. */
function activity(guildId, key) {
  const stored = readJson(FILE, {})[guildId] || {};
  const merged = { ...ACTIVITIES[key].defaults, ...(stored[key] || {}) };
  if (key === 'jobs') merged.closed = { ...(stored.jobs?.closed || {}) };
  return merged;
}

/** Whether a command should run at all. Unknown keys are allowed — a command
 *  this module has never heard of is not one it should be switching off. */
function isEnabled(guildId, key) {
  if (!Object.hasOwn(ACTIVITIES, key)) return true;
  return activity(guildId, key).enabled !== false;
}

/** Whether one job is hiring. */
function isJobOpen(guildId, jobId) {
  return activity(guildId, 'jobs').closed[jobId] !== true;
}

/**
 * Whether the boost window is open right now.
 *
 * The window is expressed in the server's own hours via an offset, so "6pm to
 * 8pm" means the evening the people running the server are actually in rather
 * than an arbitrary point in UTC. A window that wraps midnight (22 → 2) is
 * read as crossing over rather than as an empty range.
 */
function boostActive(guildId, now = Date.now()) {
  const { boost } = getSettings(guildId);
  if (!boost.enabled) return false;
  const start = clampHour(boost.startHour);
  const end = clampHour(boost.endHour);
  if (start === end) return false;
  const local = new Date(now + (Number(boost.offsetMinutes) || 0) * 60000);
  const hour = local.getUTCHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

const clampHour = h => Math.min(23, Math.max(0, Math.trunc(Number(h) || 0)));

/**
 * The number every payout is multiplied by before it is paid.
 *
 * Stacks with the shop's coin boost rather than replacing it: one is a thing a
 * member bought, the other is a thing the server set, and both should count.
 */
function payoutMultiplier(guildId, now = Date.now()) {
  const s = getSettings(guildId);
  const base = s.multiplier > 0 ? s.multiplier : 1;
  return boostActive(guildId, now) ? base * Math.max(0.1, Number(s.boost.multiplier) || 1) : base;
}

/**
 * Applies the server multiplier to an amount.
 *
 * Rounds down but never below 1 for a positive input — a 0.1× scale on a small
 * reward should make it small, not make the command silently pay nothing.
 */
function scalePayout(guildId, amount, extraScale = 1, now = Date.now()) {
  const raw = Number(amount) || 0;
  if (raw <= 0) return 0;
  const scaled = Math.floor(raw * payoutMultiplier(guildId, now) * (Number(extraScale) || 1));
  return Math.max(1, scaled);
}

/** How the boost reads on a card, or null when it is not on. */
function boostNote(guildId, now = Date.now()) {
  if (!boostActive(guildId, now)) return null;
  const { boost } = getSettings(guildId);
  return `⚡ Boost hour — ${boost.multiplier}× on every payout`;
}

/* ─── writing ────────────────────────────────────────────────────────────── */

function setSettings(guildId, patch) {
  const all = readJson(FILE, {});
  const current = all[guildId] || {};
  const next = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = { ...(current[key] || {}), ...value };
    } else {
      next[key] = value;
    }
  }

  all[guildId] = next;
  writeJson(FILE, all);
  return getSettings(guildId);
}

module.exports = {
  ACTIVITIES, ACTIVITY_KEYS, GLOBAL_DEFAULTS, FILE,
  getSettings, setSettings, activity, isEnabled, isJobOpen,
  boostActive, boostNote, payoutMultiplier, scalePayout,
};
