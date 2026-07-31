'use strict';

/**
 * web/giveaways.js
 *
 * Both giveaway systems in one place — prize giveaways (/giveaway) and coins
 * giveaways (/coinsgiveaway). They're separate commands with separate storage
 * because they pay out differently, but from a control panel they're one list
 * of things that are running and one list of things that finished.
 *
 * Ending and rerolling call the commands' own functions rather than
 * reimplementing them. Drawing winners involves weighted pools, bonus roles,
 * DMs and coin payouts; a second copy of that logic would drift, and the
 * failure mode is paying the wrong people.
 */

const { readJson } = require('../utils/jsonStorage');

const giveawayCmd = () => require('../commands/utility/giveaway.js');
const coinsCmd = () => require('../commands/economy/coinsgiveaway.js');

const PRIZE_ACTIVE = 'giveaways_active.json';
const PRIZE_ENDED = 'giveaways_ended.json';
const COINS_ACTIVE = 'coinsgiveaways_active.json';
const COINS_ENDED = 'coinsgiveaways_ended.json';

const entrantCount = (map, messageId, stored) => {
  const live = map?.get?.(messageId);
  if (live) return live.size ?? live.length ?? 0;
  return Array.isArray(stored) ? stored.length : 0;
};

/* ─── reading ────────────────────────────────────────────────────────────── */

function list(guildId) {
  const prizeActive = readJson(PRIZE_ACTIVE, {});
  const coinsActive = readJson(COINS_ACTIVE, {});
  const prizeEnded = readJson(PRIZE_ENDED, {})[guildId] || {};
  const coinsEnded = readJson(COINS_ENDED, {})[guildId] || {};

  const active = [];

  // Both active files are keyed by message id across all guilds, so each entry
  // has to be filtered back down to this one.
  for (const [messageId, d] of Object.entries(prizeActive)) {
    if (d.guildId !== guildId) continue;
    active.push({
      kind: 'prize', messageId, channelId: d.channelId,
      title: d.prize, winners: d.winnersCount ?? d.winners ?? 1,
      endsAt: d.endsAt ?? null, hostId: d.hostId ?? null,
      entrants: entrantCount(global.giveawayEntrants, messageId, d.entrants),
    });
  }
  for (const [messageId, d] of Object.entries(coinsActive)) {
    if (d.guildId !== guildId) continue;
    active.push({
      kind: 'coins', messageId, channelId: d.channelId,
      title: `${Number(d.amount || 0).toLocaleString()} coins`,
      amount: d.amount ?? 0, winners: d.winnersCount ?? 1,
      endsAt: d.endsAt ?? null, hostId: d.hostId ?? null,
      entrants: entrantCount(global.coinsGiveawayEntrants, messageId, d.entrants),
    });
  }
  active.sort((a, b) => (a.endsAt || 0) - (b.endsAt || 0));

  const ended = [
    ...Object.entries(prizeEnded).map(([shortId, d]) => ({
      kind: 'prize', shortId, title: d.prize ?? 'Giveaway',
      winners: d.winnersCount ?? 1, entrants: (d.entrants || []).length,
      endedAt: d.endedAt ?? d.createdAt ?? null,
    })),
    ...Object.entries(coinsEnded).map(([shortId, d]) => ({
      kind: 'coins', shortId, title: `${Number(d.amount || 0).toLocaleString()} coins`,
      winners: d.winnersCount ?? 1, entrants: (d.entrants || []).length,
      endedAt: d.endedAt ?? d.createdAt ?? null,
    })),
  ].sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).slice(0, 25);

  return { active, ended };
}

/* ─── actions ────────────────────────────────────────────────────────────── */

async function endNow(guildId, body, { guild }) {
  const messageId = String(body.messageId || '');
  const kind = body.kind === 'coins' ? 'coins' : 'prize';
  if (!/^\d{5,25}$/.test(messageId)) return { error: 'bad_message' };

  const store = readJson(kind === 'coins' ? COINS_ACTIVE : PRIZE_ACTIVE, {});
  const meta = store[messageId];
  if (!meta || meta.guildId !== guildId) return { error: 'unknown_giveaway' };

  const channel = guild.channels.cache.get(meta.channelId);
  if (!channel) return { error: 'channel_gone' };

  let message;
  try { message = await channel.messages.fetch(messageId); }
  catch { return { error: 'message_deleted' }; }

  try {
    if (kind === 'coins') await coinsCmd().endCoinsGiveaway(message, meta);
    else await giveawayCmd().endGiveaway(message, meta);
  } catch (err) {
    console.error('[Panel] ending a giveaway failed:', err.message);
    return { error: 'end_failed', detail: err.message.slice(0, 140) };
  }
  return { ok: true, kind, messageId };
}

async function reroll(guildId, body, { guild }) {
  const shortId = String(body.shortId || '').trim().toLowerCase();
  if (!shortId || !/^[\w-]{1,40}$/.test(shortId)) return { error: 'bad_id' };
  if (body.kind !== 'coins') return { error: 'reroll_coins_only' };

  try {
    const result = await coinsCmd().performReroll(guild, shortId);
    if (result?.error) return { error: 'reroll_failed', detail: result.error };
    return { ok: true, shortId };
  } catch (err) {
    console.error('[Panel] reroll failed:', err.message);
    return { error: 'reroll_failed', detail: err.message.slice(0, 140) };
  }
}

module.exports = { list, endNow, reroll };
