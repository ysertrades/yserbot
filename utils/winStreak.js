'use strict';

const { randomInt } = require('node:crypto');
const { readJson, writeJson } = require('./jsonStorage');
const { addCoins } = require('./economyManager');
const { getEffect } = require('./effectsManager');

// Tracks a single win streak per user across every casino game (coinflip,
// slots, crash, blackjack, dice, roulette, wheel, trading, race — anything
// that reports a delta through applyResult). A win extends it, a loss resets
// it, a push (delta === 0) leaves it untouched. Every 5th consecutive win
// pays a random bonus, with the payout range widening a little for longer
// streaks (capped so it doesn't scale forever).
const MILESTONE  = 5;
const MAX_TIER   = 5; // caps the payout scaling at a 25-win streak
const FILE       = 'win_streaks.json';

/**
 * Records a game outcome and returns `{ streak, amount }` if this outcome
 * just hit a 5-win milestone (and the coins have already been credited), or
 * null otherwise.
 */
function recordOutcome(userId, delta, guildId) {
  const data  = readJson(FILE, {});
  const entry = data[userId] || { streak: 0, best: 0 };

  let bonus = null;
  if (delta > 0) {
    entry.streak += 1;
    if (entry.streak > entry.best) entry.best = entry.streak;
    if (entry.streak % MILESTONE === 0) {
      const tier   = Math.min(MAX_TIER, entry.streak / MILESTONE);
      let amount   = randomInt(Math.round(250 * tier), Math.round(750 * tier) + 1);
      const boost  = getEffect(userId, guildId, 'coin_boost');
      if (boost) amount = Math.floor(amount * (boost.multiplier || 1.5));
      addCoins(userId, amount);
      bonus = { streak: entry.streak, amount };
    }
  } else if (delta < 0) {
    entry.streak = 0;
  }
  // delta === 0 (push) — streak unchanged either way

  data[userId] = entry;
  writeJson(FILE, data);
  return bonus;
}

function getStreak(userId) {
  const data = readJson(FILE, {});
  return data[userId] || { streak: 0, best: 0 };
}

module.exports = { recordOutcome, getStreak, MILESTONE };
