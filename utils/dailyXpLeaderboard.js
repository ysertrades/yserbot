'use strict';
/**
 * Automatic daily XP leaderboard posts.
 * Uses xpEvents — XP earned that calendar day in guild TZ (not all-time).
 */
const { EmbedBuilder } = require('discord.js');

function dayKeyInTz(ts, timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

function localHM(timeZone = 'UTC', now = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'UTC',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(now));
    return {
      hour: parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10),
      minute: parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10),
    };
  } catch {
    const d = new Date(now);
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }
}

function defaultDailyLb() {
  return {
    enabled: false, hour: 20, minute: 0, timeZone: 'America/New_York',
    channelId: null, roleId: null, limit: 10,
    title: 'Daily XP Leaderboard', description: "Today's top contributors",
    footer: null, showAvatars: true, lastPostedDay: null,
  };
}

function normalizeDailyLb(raw) {
  const d = defaultDailyLb();
  if (!raw || typeof raw !== 'object') return d;
  return {
    enabled: !!raw.enabled,
    hour: Math.max(0, Math.min(23, Number(raw.hour) ?? d.hour)),
    minute: Math.max(0, Math.min(59, Number(raw.minute) ?? d.minute)),
    timeZone: String(raw.timeZone || d.timeZone).slice(0, 64),
    channelId: raw.channelId ? String(raw.channelId) : null,
    roleId: raw.roleId ? String(raw.roleId) : null,
    limit: Math.max(3, Math.min(25, Number(raw.limit) || 10)),
    title: String(raw.title || d.title).slice(0, 120),
    description: raw.description != null ? String(raw.description).slice(0, 400) : d.description,
    footer: raw.footer != null ? String(raw.footer).slice(0, 200) : null,
    showAvatars: raw.showAvatars !== false,
    lastPostedDay: raw.lastPostedDay || null,
  };
}

function dailyXpRows(g, { dayKey, timeZone, limit = 10 } = {}) {
  const key = dayKey || dayKeyInTz(Date.now(), timeZone);
  const xpMap = {};
  for (const e of g.xpEvents || []) {
    if (!e || !e.userId || !e.xp) continue;
    if (dayKeyInTz(e.createdAt || 0, timeZone) !== key) continue;
    xpMap[e.userId] = (xpMap[e.userId] || 0) + Number(e.xp);
  }
  return Object.entries(xpMap)
    .map(([id, xp]) => ({ id, xp }))
    .sort((a, b) => b.xp - a.xp || a.id.localeCompare(b.id))
    .slice(0, limit);
}

async function buildDailyLeaderboardMessage(guild, g, cfg) {
  const conf = normalizeDailyLb(cfg);
  const tz = conf.timeZone || 'UTC';
  const today = dayKeyInTz(Date.now(), tz);
  const rows = dailyXpRows(g, { dayKey: today, timeZone: tz, limit: conf.limit });
  const lines = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let name = r.id;
    try {
      const m = await guild.members.fetch(r.id).catch(() => null);
      if (m) name = m.displayName || m.user?.username || r.id;
      else {
        const u = await guild.client.users.fetch(r.id).catch(() => null);
        if (u) name = u.username;
      }
    } catch { /* keep id */ }
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${i + 1}.\``;
    lines.push(`${medal} **${name}** — **${r.xp}** XP`);
  }
  const { EmbedBuilder } = require('discord.js');
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(conf.title || 'Daily XP Leaderboard')
    .setTimestamp(new Date());
  if (conf.description) embed.setDescription(conf.description);
  if (lines.length) embed.addFields({ name: `Top ${rows.length} · ${today}`, value: lines.join('\n').slice(0, 1024) });
  else embed.addFields({ name: today, value: 'No XP earned yet today.' });
  embed.setFooter({ text: (conf.footer || `Timezone: ${tz}`).slice(0, 200) });
  return {
    content: conf.roleId ? `<@&${conf.roleId}>` : undefined,
    embeds: [embed],
    allowedMentions: conf.roleId ? { roles: [conf.roleId] } : { parse: [] },
  };
}

async function tickDailyLeaderboards(client, leveling) {
  if (!client?.guilds?.cache || !leveling) return;
  for (const [guildId, guild] of client.guilds.cache) {
    try {
      let g;
      if (typeof leveling.guildState === 'function') g = leveling.guildState(guildId).g;
      else if (typeof leveling.loadAll === 'function') g = leveling.loadAll()[guildId];
      else continue;
      if (!g) continue;
      const conf = normalizeDailyLb(g.dailyLeaderboard);
      if (!conf.enabled || !conf.channelId) continue;
      const { hour, minute } = localHM(conf.timeZone);
      if (hour !== conf.hour || minute !== conf.minute) continue;
      const today = dayKeyInTz(Date.now(), conf.timeZone);
      if (conf.lastPostedDay === today) continue;
      const ch = guild.channels.cache.get(conf.channelId);
      if (!ch || !ch.isTextBased?.()) continue;
      await ch.send(await buildDailyLeaderboardMessage(guild, g, conf));
      g.dailyLeaderboard = { ...conf, lastPostedDay: today };
      if (typeof leveling.saveAll === 'function') {
        const bag = leveling.loadAll();
        bag[guildId] = g;
        leveling.saveAll(bag);
      } else {
        const { readJson, writeJson } = require('./jsonStorage');
        const bag = readJson('levels.json', {});
        bag[guildId] = bag[guildId] || g;
        bag[guildId].dailyLeaderboard = g.dailyLeaderboard;
        writeJson('levels.json', bag);
      }
    } catch (err) {
      console.warn('[dailyXpLb]', guildId, err.message);
    }
  }
}

function startDailyLeaderboardRunner(client, leveling) {
  if (global.__dailyXpLbTimer) return;
  const kick = () => tickDailyLeaderboards(client, leveling).catch(e => console.warn('[dailyXpLb]', e.message));
  const ms = 60000 - (Date.now() % 60000) + 200;
  setTimeout(() => { kick(); global.__dailyXpLbTimer = setInterval(kick, 60000); }, ms);
  console.log('[dailyXpLb] runner armed');
}

module.exports = {
  defaultDailyLb, normalizeDailyLb, dayKeyInTz, localHM, dailyXpRows,
  buildDailyLeaderboardMessage, tickDailyLeaderboards, startDailyLeaderboardRunner,
};
