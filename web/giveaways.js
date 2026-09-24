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
const { parseDuration } = require('../utils/duration');
const { DYNAMIC_IMAGES } = require('../utils/dynamicEmbedImages');

// A month, matching what the panel already allowed in minutes.
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

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
  const winnersOf = (ids) => (ids || []).map(id => ({
    id: String(id),
    name: nameOf(id),
  }));

  const active = [];

  for (const [messageId, d] of Object.entries(prizeActive)) {
    if (d.guildId !== guildId) continue;
    active.push({
      kind: 'prize', messageId, channelId: d.channelId,
      title: d.prize, winners: d.winnersCount ?? d.winners ?? 1,
      endsAt: d.endTime ?? d.endsAt ?? null, hostId: d.hostId ?? null,
      startedAt: d.createdAt ?? null,
      entrants: entrantCount(global.giveawayEntrants, messageId, d.entrants),
      shortId: d.dropId || null,
      dropId: d.dropId || null,
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
      prizeDmSent: !!d.prizeDmSent,
      revealed: !!d.revealed,
      empty: !!d.empty || ((d.entrants || []).length === 0 && !(d.currentWinners || []).length),
      needsRestart: !!d.needsRestart || !!d.empty,
      messageId: d.messageId || null,
      channelId: d.channelId || null,
      imageUrl: d.imageUrl || null,
      hostId: d.hostId || null,
      requiredRoleId: d.requiredRoleId || null,
      bonusRoleId: d.bonusRoleId || null,
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

async function remove(guildId, body, ctx = {}) {
  const shortId = String(body.shortId || '').trim().toLowerCase();
  if (!shortId || !/^[\w-]{1,40}$/.test(shortId)) return { error: 'bad_id' };
  const kind = body.kind === 'coins' ? 'coins' : 'prize';

  const file = kind === 'coins' ? COINS_ENDED : PRIZE_ENDED;
  const all = readJson(file, {});
  const entry = all[guildId]?.[shortId];
  if (!entry) return { error: 'unknown_giveaway' };

  const channelId = entry.channelId;
  const messageId = entry.messageId;
  const guild = ctx.guild || ctx.client?.guilds?.cache?.get(guildId);
  if (guild && channelId && messageId) {
    try {
      const ch = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);
      if (ch?.isTextBased?.()) {
        const msg = await ch.messages.fetch(messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
    } catch (err) {
      console.warn('[GIVEAWAY] panel delete message:', err.message);
    }
  }

  delete all[guildId][shortId];
  if (Object.keys(all[guildId]).length === 0) delete all[guildId];
  writeJson(file, all);

  const title = kind === 'coins' ? `${Number(entry.amount || 0).toLocaleString()} coins` : (entry.prize || 'Giveaway');
  return { ok: true, shortId, kind, title };
}

function clearHistory(guildId) {
  let removed = 0;
  for (const file of [PRIZE_ENDED, COINS_ENDED]) {
    const all = readJson(file, {});
    const bucket = all[guildId];
    if (!bucket) continue;
    removed += Object.keys(bucket).length;
    delete all[guildId];
    writeJson(file, all);
  }
  return { ok: true, removed };
}

async function create(guildId, body, { guild, session, client }) {
  const kind = body.kind === 'prize' ? 'prize' : 'coins';

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

  const durationMs = body.duration !== undefined
    ? parseDuration(body.duration)
    : (Number.isInteger(Number(body.minutes)) ? Number(body.minutes) * 60000 : null);
  if (!durationMs || durationMs < 10_000 || durationMs > MAX_DURATION_MS) return { error: 'bad_duration' };

  if (!guild || !guild.channels || !guild.channels.cache) return { error: 'guild_unavailable', detail: 'Server not in bot cache — restart bot.' };
  const channel = guild.channels.cache.get(String(body.channelId || ''));
  if (!channel?.isTextBased?.()) return { error: 'bad_channel' };

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

  let imageUrl = null;
  if (kind === 'prize') {
    const raw = String(body.imageUrl || 'dynamic:prizeGiveawayBanner').trim()
      || 'dynamic:prizeGiveawayBanner';
    if (raw.startsWith('dynamic:')) {
      if (!Object.hasOwn(DYNAMIC_IMAGES, raw.slice(8))) return { error: 'bad_image' };
      imageUrl = raw;
    } else if (/^https:\/\/\S+$/i.test(raw) && raw.length <= 500) {
      imageUrl = raw;
    } else {
      return { error: 'bad_image' };
    }
  }

  const shared = {
    winners, durationMs, mention,
    channelId: channel.id, guildId,
    requiredRoleId: body.requiredRoleId || null,
    bonusRoleId: body.bonusRoleId || null,
    bonusRoles: Array.isArray(body.bonusRoles)
      ? body.bonusRoles
          .filter((r) => r && r.id && guild.roles.cache.has(String(r.id)))
          .map((r) => ({
            id: String(r.id),
            extra: Math.min(10, Math.max(1, Number(r.extra) || 1)),
          }))
      : null,
    minAccountAgeDays,
  };

  let hostId = session.uid;
  if (body.hostId) {
    const hostMember = guild.members.cache.get(String(body.hostId));
    const ok = hostMember
      && !hostMember.user?.bot
      && (hostMember.permissions?.has?.('Administrator')
        || hostMember.permissions?.has?.('ManageGuild'));
    if (!ok) return { error: 'bad_host' };
    hostId = hostMember.id;
  }

  try {
    const out = kind === 'coins'
      ? await coinsCmd().postGiveaway(guild, hostId, { ...shared, amount })
      : await giveawayCmd().postGiveaway(guild, hostId,
          guild.members.cache.get(hostId)?.user?.displayAvatarURL?.({ size: 128 })
            || client?.user?.displayAvatarURL?.() || null,
          { ...shared, prize, imageUrl });

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

async function sendPrize(guildId, body, { guild }) {
  const shortId = String(body?.shortId || body?.id || '').toLowerCase();
  const text = String(body?.text || body?.message || '').trim();
  if (!shortId) return { error: 'unknown_giveaway' };
  if (!text) return { error: 'empty_prize' };
  const winnerId = body?.winnerId ? String(body.winnerId) : null;
  const imageOpts = {};
  if (body?.imageData && typeof body.imageData === 'string') imageOpts.data = body.imageData;
  if (body?.imageUrl && typeof body.imageUrl === 'string') imageOpts.url = body.imageUrl;
  return giveawayCmd().sendPrizeDm(guild, shortId, text, winnerId, Object.keys(imageOpts).length ? imageOpts : null);
}

async function participants(guildId, body, { guild }) {
  const messageId = String(body?.messageId || '');
  if (!messageId) return { error: 'bad_message' };
  const gaw = giveawayCmd();
  const rec = gaw.getActiveGiveaway?.(messageId);
  if (!rec || rec.guildId !== guildId) return { error: 'not_found' };

  let ids = rec.entrants || [];
  if (global.giveawayEntrants?.has(messageId)) {
    ids = [...global.giveawayEntrants.get(messageId)];
  }

  const bonusList = typeof gaw.normalizeBonusRoles === 'function'
    ? gaw.normalizeBonusRoles(rec.bonusRoleId, rec.bonusRoles)
    : (rec.bonusRoleId ? [{ id: String(rec.bonusRoleId), extra: 1 }] : []);

  try {
    if (bonusList.length && guild.members?.fetch) {
      await guild.members.fetch({ user: ids.map(String) }).catch(() => null);
    }
  } catch (_) {}

  const rows = [];
  for (const id of ids) {
    const m = guild.members.cache.get(id);
    const u = m?.user || guild.client.users.cache.get(id);
    const ageDays = u?.createdTimestamp
      ? (Date.now() - u.createdTimestamp) / 86400000
      : null;
    const joinDays = m?.joinedTimestamp
      ? (Date.now() - m.joinedTimestamp) / 86400000
      : null;
    let entries = 1;
    if (typeof gaw.ticketsForMember === 'function') {
      entries = gaw.ticketsForMember(m, bonusList);
    } else if (bonusList.length && m?.roles?.cache) {
      entries = 1;
      for (const b of bonusList) {
        if (m.roles.cache.has(b.id)) entries += (b.extra || 1);
      }
      entries = Math.min(3, Math.max(1, entries));
    }
    rows.push({
      id,
      tag: u?.tag || u?.username || id,
      avatar: u?.displayAvatarURL?.({ size: 64 }) || null,
      accountAgeDays: ageDays != null ? Math.round(ageDays * 10) / 10 : null,
      serverJoinDays: joinDays != null ? Math.round(joinDays * 10) / 10 : null,
      young: ageDays != null && ageDays < 14,
      entries,
      extraEntries: Math.max(0, entries - 1),
    });
  }
  rows.sort((a, b) => (b.entries - a.entries) || Number(b.young) - Number(a.young) || (a.accountAgeDays || 999) - (b.accountAgeDays || 999));

  return {
    ok: true,
    messageId,
    prize: rec.prize,
    dropId: rec.dropId || null,
    count: rows.length,
    totalTickets: rows.reduce((s, r) => s + (r.entries || 1), 0),
    bonusRoles: bonusList,
    participants: rows,
  };
}

async function removeParticipant(guildId, body, { guild }) {
  const messageId = String(body?.messageId || '');
  const userId = String(body?.userId || '');
  if (!messageId || !userId) return { error: 'bad_request' };
  const gaw = giveawayCmd();
  const rec = gaw.getActiveGiveaway?.(messageId);
  if (!rec || rec.guildId !== guildId) return { error: 'not_found' };

  if (!global.giveawayEntrants) global.giveawayEntrants = new Map();
  let entrants = global.giveawayEntrants.get(messageId);
  if (!entrants) {
    entrants = new Set(rec.entrants || []);
    global.giveawayEntrants.set(messageId, entrants);
  }
  const uid = String(userId);
  const normalized = new Set([...entrants].map(String));
  if (!normalized.has(uid)) return { error: 'not_entrant' };
  normalized.delete(uid);
  global.giveawayEntrants.set(messageId, normalized);
  gaw.persistGiveawayEntry?.(messageId, normalized);

  try {
    if (typeof gaw.refreshLiveGiveawayMessage === 'function') {
      await gaw.refreshLiveGiveawayMessage(guild, messageId, normalized.size);
    }
  } catch (err) {
    console.warn('[GIVEAWAY] panel remove refresh:', err.message);
  }

  return { ok: true, count: normalized.size, removed: uid };
}

async function restartEmpty(guildId, body, { guild, client, session }) {
  const shortId = String(body.shortId || '').trim().toLowerCase();
  if (!shortId) return { error: 'bad_id' };

  const all = readJson(PRIZE_ENDED, {});
  const rec = all[guildId]?.[shortId];
  if (!rec) return { error: 'unknown_giveaway' };
  const isEmpty = !!rec.empty || (!(rec.entrants || []).length && !(rec.currentWinners || []).length);
  if (!isEmpty) return { error: 'not_empty', detail: 'Only empty (no-entry) drops can be restarted this way.' };

  const prize = String(body.prize || rec.prize || '').trim().slice(0, 200);
  if (!prize) return { error: 'bad_prize' };

  const winners = Math.min(100, Math.max(1, Number(body.winners) || rec.winnersCount || 1));
  let ms = null;
  if (typeof body.duration === 'string') {
    ms = parseDuration(body.duration);
    if (!ms) {
      const m = String(body.duration).trim().match(/^(\d+)\s*([smhd])$/i);
      if (m) {
        const n = Number(m[1]);
        const u = m[2].toLowerCase();
        ms = n * ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[u] || 0);
      }
    }
  }
  if (!ms && Number.isInteger(Number(body.minutes))) ms = Number(body.minutes) * 60000;
  if (!ms && Number(body.durationMs) > 0) ms = Number(body.durationMs);
  if (!ms || ms < 10_000 || ms > 30 * 24 * 3_600_000) return { error: 'bad_duration' };

  const channelId = String(body.channelId || rec.channelId || '');
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.()) return { error: 'bad_channel' };

  let mention = null;
  if (body.mention === '@everyone' || body.mention === '@here') mention = body.mention;
  else if (body.mention) {
    if (!guild.roles.cache.has(String(body.mention))) return { error: 'bad_mention' };
    mention = `<@&${body.mention}>`;
  }

  const hostId = body.hostId && guild.members.cache.get(String(body.hostId))
    ? String(body.hostId)
    : (rec.hostId || session?.uid);
  const imageUrl = body.imageUrl != null ? body.imageUrl : (rec.imageUrl || 'dynamic:prizeGiveawayBanner');

  const hostUser = guild.members.cache.get(hostId)?.user;
  const out = await giveawayCmd().postGiveaway(
    guild,
    hostId,
    hostUser?.displayAvatarURL?.({ size: 128 }) || client?.user?.displayAvatarURL?.() || null,
    {
      prize,
      durationMs: ms,
      winners,
      imageUrl,
      mention,
      channelId: channel.id,
      guildId,
      requiredRoleId: body.requiredRoleId || rec.requiredRoleId || null,
      bonusRoleId: body.bonusRoleId || rec.bonusRoleId || null,
      minAccountAgeDays: Number(body.minAccountAgeDays) || rec.minAccountAgeDays || 0,
    },
  );

  rec.prizeDmSent = true;
  rec.needsRestart = false;
  rec.restartedAt = Date.now();
  rec.restartedTo = out.message?.id || null;
  all[guildId][shortId] = rec;
  writeJson(PRIZE_ENDED, all);

  return {
    ok: true,
    shortId,
    messageId: out.message.id,
    channelName: channel.name,
    endsAt: out.endTime,
    label: prize,
  };
}

module.exports = {
  sendPrize, list, create, endNow, reroll, remove, clearHistory,
  participants, removeParticipant, restartEmpty };
