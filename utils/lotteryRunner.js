'use strict';

/**
 * lotteryRunner.js
 *
 * Draws the daily lottery at 00:00 UTC-4 (04:00 UTC) for every guild that
 * has an announcement channel configured. Mirrors econCalRunner.js's
 * slot/lastFiredAt pattern (compute the target timestamp for "today", fire
 * once when now passes it, remember that we did) but for a single daily
 * slot instead of a weekly one.
 */

const { readJson, writeJson } = require('./jsonStorage');
const { addCoins } = require('./economyManager');
const { getEffect } = require('./effectsManager');
const { createEmbed } = require('./embedBuilder');

const TICK_INTERVAL_MS = 30_000;
const DRAW_HOUR_UTC    = 4; // 00:00 UTC-4
const STALE_MS         = 20 * 60 * 60 * 1000; // if the bot was down through the whole window, skip it rather than fire a very-late draw
const REWARD            = 5000;
const LOTTERY_FILE      = 'lottery.json';

function todaysSlotUTC(now) {
  const d = new Date(now);
  d.setUTCHours(DRAW_HOUR_UTC, 0, 0, 0);
  return d.getTime();
}

// Weighted by ticket count — buying more tickets raises your odds without
// guaranteeing a win.
function pickWinner(pool) {
  const entries = Object.entries(pool);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  if (total <= 0) return null;
  let r = Math.floor(Math.random() * total);
  for (const [userId, count] of entries) {
    r -= count;
    if (r < 0) return userId;
  }
  return entries[entries.length - 1][0];
}

async function runTick(client) {
  const now      = Date.now();
  const config   = readJson('config.json', {});
  const lottery  = readJson(LOTTERY_FILE, {});
  let changed    = false;

  for (const guildId of Object.keys(config)) {
    const settings = config[guildId]?.lotterySettings;
    if (!settings?.channelId) continue;
    // Paused from the control panel. Entries already in the pool stay exactly
    // where they are — pausing skips the draw, it does not cancel it, so
    // resuming picks up with everyone who had already entered.
    if (settings.paused) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(settings.channelId);
    if (!channel || !channel.isTextBased()) continue;

    const state = lottery[guildId] || { pool: {}, lastDrawAt: 0, history: [] };
    const slot  = todaysSlotUTC(now);
    if (now < slot || state.lastDrawAt >= slot) continue;
    if (now - slot > STALE_MS) continue; // too late for today's window — wait for tomorrow's slot instead

    const winnerId       = pickWinner(state.pool);
    const ticketsInPool   = Object.values(state.pool).reduce((s, c) => s + c, 0);
    const participants    = Object.keys(state.pool).length;

    if (winnerId) {
      const boost = getEffect(winnerId, guildId, 'coin_boost');
      const payout = boost ? Math.floor(REWARD * (boost.multiplier || 1.5)) : REWARD;
      addCoins(winnerId, payout);
      const embed = createEmbed('success', {
        title: '🎟️ Daily Lottery Draw',
        description: `🎉 <@${winnerId}> won **${payout.toLocaleString()}** coins!${boost ? ` (💰 ${boost.multiplier || 1.5}× coin boost applied!)` : ''}\n\n🎫 ${ticketsInPool} ticket${ticketsInPool !== 1 ? 's' : ''} from ${participants} participant${participants !== 1 ? 's' : ''}.`,
        footer: `${guild.name} • Next draw in 24 hours`,
      });
      await channel.send({ embeds: [embed] }).catch(() => {});
      state.history = [{ date: slot, winnerId, ticketsInPool, participants }, ...(state.history || [])].slice(0, 10);
    } else {
      const embed = createEmbed('info', {
        title: '🎟️ Daily Lottery Draw',
        description: 'No tickets were bought today — no winner. Buy one with `/lottery buy`!',
        footer: `${guild.name} • Next draw in 24 hours`,
      });
      await channel.send({ embeds: [embed] }).catch(() => {});
    }

    state.pool       = {};
    state.lastDrawAt = slot;
    lottery[guildId] = state;
    changed = true;
  }

  if (changed) writeJson(LOTTERY_FILE, lottery);
}

function startLotteryRunner(client) {
  const tick = () => runTick(client).catch(err => console.error('[LOTTERY RUNNER ERROR]', err));
  tick();
  setInterval(tick, TICK_INTERVAL_MS);
}

module.exports = { startLotteryRunner, todaysSlotUTC, REWARD };
