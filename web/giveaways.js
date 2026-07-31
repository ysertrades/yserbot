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

const { readJson, writeJson } = require('../utils/jsonStorage');

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
  const kind = body.kind === 'coins' ? 'coins' : 'prize';

  try {
    // Each system draws its own winners — coins pays out, prizes announce.
    const result = kind === 'coins'
      ? await coinsCmd().performReroll(guild, shortId)
      : await giveawayCmd().performReroll(guild, shortId);
    if (result?.error) return { error: 'reroll_failed', detail: result.error };
    return { ok: true, shortId, kind };
  } catch (err) {
    console.error('[Panel] reroll failed:', err.message);
    return { error: 'reroll_failed', detail: err.message.slice(0, 140) };
  }
}

/**
 * Starts a coins giveaway.
 *
 * Goes through coinsgiveaway.js's own postGiveaway, so the message, the entry
 * button, the banner and the end timer are all the ones the slash command
 * produces. The panel decides what to run; it does not decide what a giveaway
 * looks like.
 */
async function create(guildId, body, { guild, session, client }) {
  const kind = body.kind === 'prize' ? 'prize' : 'coins';

  // Coins giveaways pay a number; prize giveaways name a thing.
  let amount = 0, prize = '';
  if (kind === 'coins') {
    amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100_000_000) return { error: 'bad_amount' };
  } else {
    prize = String(body.prize || '').trim().slice(0, 200);
    if (!prize) return { error: 'bad_prize' };
  }

  const winners = Number(body.winners);
  if (!Number.isInteger(winners) || winners < 1 || winners > 50) return { error: 'bad_winners' };

  const minutes = Number(body.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60 * 24 * 30) return { error: 'bad_duration' };

  const channel = guild.channels.cache.get(String(body.channelId || ''));
  if (!channel?.isTextBased?.()) return { error: 'bad_channel' };

  // Optional gates. An id for a role that no longer exists would silently
  // exclude everyone, so each is checked against the guild.
  for (const key of ['requiredRoleId', 'bonusRoleId']) {
    if (body[key] && !guild.roles.cache.has(body[key])) return { error: 'bad_role' };
  }
  const minAccountAgeDays = Number(body.minAccountAgeDays) || 0;
  if (minAccountAgeDays < 0 || minAccountAgeDays > 3650) return { error: 'bad_age' };

  let mention = null;
  if (body.mention === '@everyone' || body.mention === '@here') mention = body.mention;
  else if (body.mention) {
    if (!guild.roles.cache.has(body.mention)) return { error: 'bad_mention' };
    mention = `<@&${body.mention}>`;
  }

  const shared = {
    winners, durationMs: minutes * 60000, mention,
    channelId: channel.id, guildId,
    requiredRoleId: body.requiredRoleId || null,
    bonusRoleId: body.bonusRoleId || null,
    minAccountAgeDays,
  };

  try {
    const out = kind === 'coins'
      ? await coinsCmd().postGiveaway(guild, session.uid, { ...shared, amount })
      : await giveawayCmd().postGiveaway(guild, session.uid,
          // The host avatar is only a fallback thumbnail when the server has no
          // icon, and the panel has no member object to ask — the bot's own
          // avatar keeps the embed from looking broken in that case.
          client?.user?.displayAvatarURL?.() || null,
          { ...shared, prize, imageUrl: body.imageUrl || null });

    return {
      ok: true, kind, messageId: out.message.id, channelName: channel.name,
      label: kind === 'coins' ? `${amount.toLocaleString()} coins` : prize,
      winners, endsAt: out.endTime,
    };
  } catch (err) {
    console.error('[Panel] starting a giveaway failed:', err.message);
    return { error: 'launch_failed', detail: err.message.slice(0, 140) };
  }
}

module.exports = { list, create, endNow, reroll };
