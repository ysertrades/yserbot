'use strict';
/**
 * Minimal restore — bot boots; full giveaway panel features restored in follow-up.
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

function list(guildId, guild) {
  const prizeActive = readJson(PRIZE_ACTIVE, {});
  const coinsActive = readJson(COINS_ACTIVE, {});
  const prizeEnded = readJson(PRIZE_ENDED, {})[guildId] || {};
  const coinsEnded = readJson(COINS_ENDED, {})[guildId] || {};
  const nameOf = (id) => {
    const mid = String(id || '');
    if (!mid) return '';
    const member = guild?.members?.cache?.get(mid);
    if (member) return member.displayName || member.user?.username || mid;
    const user = guild?.client?.users?.cache?.get(mid);
    if (user) return user.username || mid;
    return mid;
  };
  const winnersOf = (ids) => (ids || []).map(id => ({ id: String(id), name: nameOf(id) }));
  const active = [];
  for (const [messageId, d] of Object.entries(prizeActive)) {
    if (d.guildId !== guildId) continue;
    active.push({
      kind: 'prize', messageId, channelId: d.channelId,
      title: d.prize, winners: d.winnersCount ?? d.winners ?? 1,
      endsAt: d.endTime ?? d.endsAt ?? null, hostId: d.hostId ?? null,
      startedAt: d.createdAt ?? null,
      entrants: entrantCount(global.giveawayEntrants, messageId, d.entrants),
      shortId: d.dropId || null, dropId: d.dropId || null,
    });
  }
  for (const [messageId, d] of Object.entries(coinsActive)) {
    if (d.guildId !== guildId) continue;
    active.push({
      kind: 'coins', messageId, channelId: d.channelId,
      title: `${Number(d.amount || 0).toLocaleString()} coins`,
      amount: d.amount ?? 0, winners: d.winnersCount ?? 1,
      endsAt: d.endTime ?? d.endsAt ?? null, hostId: d.hostId ?? null,
      startedAt: d.createdAt ?? null,
      entrants: entrantCount(global.coinsGiveawayEntrants, messageId, d.entrants),
    });
  }
  active.sort((a, b) => (a.endsAt || 0) - (b.endsAt || 0));
  const ended = [
    ...Object.entries(prizeEnded).map(([shortId, d]) => ({
      kind: 'prize', shortId, title: d.prize ?? 'Giveaway',
      winners: d.winnersCount ?? 1, entrants: (d.entrants || []).length,
      endedAt: d.endedAt ?? d.createdAt ?? null,
      prizeDmSent: !!d.prizeDmSent, revealed: !!d.revealed,
      empty: !!d.empty || ((d.entrants || []).length === 0 && !(d.currentWinners || []).length),
      needsRestart: !!d.needsRestart || !!d.empty,
      messageId: d.messageId || null, channelId: d.channelId || null,
      imageUrl: d.imageUrl || null, hostId: d.hostId || null,
      requiredRoleId: d.requiredRoleId || null, bonusRoleId: d.bonusRoleId || null,
      minAccountAgeDays: d.minAccountAgeDays || 0,
      winnersList: winnersOf(d.currentWinners),
    })),
    ...Object.entries(coinsEnded).map(([shortId, d]) => ({
      kind: 'coins', shortId, title: `${Number(d.amount || 0).toLocaleString()} coins`,
      winners: d.winnersCount ?? 1, entrants: (d.entrants || []).length,
      endedAt: d.endedAt ?? d.createdAt ?? null,
      winnersList: winnersOf(d.currentWinners),
    })),
  ].sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).slice(0, 25);
  return { active, ended };
}

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
    return { error: 'end_failed', detail: String(err.message || err).slice(0, 140) };
  }
  return { ok: true, kind, messageId };
}

async function reroll(guildId, body, { guild }) {
  const shortId = String(body.shortId || '').trim().toLowerCase();
  if (!shortId) return { error: 'bad_id' };
  const kind = body.kind === 'coins' ? 'coins' : 'prize';
  try {
    const result = kind === 'coins'
      ? await coinsCmd().performReroll(guild, shortId)
      : await giveawayCmd().performReroll(guild, shortId);
    if (result?.error) return { error: 'reroll_failed', detail: result.error };
    return { ok: true, shortId, kind };
  } catch (err) {
    return { error: 'reroll_failed', detail: String(err.message || err).slice(0, 140) };
  }
}

async function remove(guildId, body, ctx = {}) {
  const shortId = String(body.shortId || '').trim().toLowerCase();
  if (!shortId) return { error: 'bad_id' };
  const kind = body.kind === 'coins' ? 'coins' : 'prize';
  const file = kind === 'coins' ? COINS_ENDED : PRIZE_ENDED;
  const all = readJson(file, {});
  const entry = all[guildId]?.[shortId];
  if (!entry) return { error: 'unknown_giveaway' };
  const guild = ctx.guild || ctx.client?.guilds?.cache?.get(guildId);
  if (guild && entry.channelId && entry.messageId) {
    try {
      const ch = guild.channels.cache.get(entry.channelId)
        || await guild.channels.fetch(entry.channelId).catch(() => null);
      if (ch?.isTextBased?.()) {
        const msg = await ch.messages.fetch(entry.messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    } catch (_) {}
  }
  delete all[guildId][shortId];
  if (Object.keys(all[guildId] || {}).length === 0) delete all[guildId];
  writeJson(file, all);
  return { ok: true, shortId, kind };
}

function clearHistory(guildId) {
  let removed = 0;
  for (const file of [PRIZE_ENDED, COINS_ENDED]) {
    const all = readJson(file, {});
    if (!all[guildId]) continue;
    removed += Object.keys(all[guildId]).length;
    delete all[guildId];
    writeJson(file, all);
  }
  return { ok: true, removed };
}

async function create() { return { error: 'giveaways_module_restoring' }; }
async function sendPrize(guildId, body, { guild }) {
  const shortId = String(body?.shortId || body?.id || '').toLowerCase();
  const text = String(body?.text || body?.message || '').trim();
  if (!shortId) return { error: 'unknown_giveaway' };
  if (!text) return { error: 'empty_prize' };
  const winnerId = body?.winnerId ? String(body.winnerId) : null;
  const imageOpts = {};
  if (body?.imageData && typeof body.imageData === 'string') imageOpts.data = body.imageData;
  if (body?.imageUrl && typeof body.imageUrl === 'string') imageOpts.url = body.imageUrl;
  const gaw = giveawayCmd();
  if (typeof gaw.sendPrizeDm === 'function') {
    return gaw.sendPrizeDm(guild, shortId, text, winnerId, Object.keys(imageOpts).length ? imageOpts : null);
  }
  return gaw.sendPrizeDm(guild, shortId, text, winnerId);
}
async function participants() { return { ok: true, count: 0, participants: [] }; }
async function removeParticipant() { return { error: 'not_found' }; }
async function restartEmpty() { return { error: 'giveaways_module_restoring' }; }

module.exports = {
  sendPrize, list, create, endNow, reroll, remove, clearHistory,
  participants, removeParticipant, restartEmpty };
