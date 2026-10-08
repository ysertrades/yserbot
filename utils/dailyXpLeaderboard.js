'use strict';
const { EmbedBuilder } = require('discord.js');
const ET = 'America/New_York';

function dayKeyInTz(ts, timeZone = ET) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || ET, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ts));
  } catch { return new Date(ts).toISOString().slice(0, 10); }
}

function localHM(timeZone = ET, now = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || ET, hour: '2-digit', minute: '2-digit', hour12: false,
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

function zonedLocalToUtc(y, month, day, hour, minute, timeZone = ET) {
  const target =
    `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ` +
    `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  let lo = Date.UTC(y, month - 1, day) - 36 * 3600e3;
  let hi = Date.UTC(y, month - 1, day) + 36 * 3600e3;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  while (hi - lo > 500) {
    const mid = Math.floor((lo + hi) / 2);
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(mid)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]),
    );
    const key = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
    if (key < target) lo = mid; else hi = mid;
  }
  return hi;
}

function etParts(now = Date.now()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(now)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day };
}

function nextFireUtcMs(hour, minute, now = Date.now()) {
  const { y, m, d } = etParts(now);
  let t = zonedLocalToUtc(y, m, d, hour, minute, ET);
  if (t <= now + 2000) {
    const noon = zonedLocalToUtc(y, m, d, 12, 0, ET) + 36 * 3600e3;
    const p2 = etParts(noon);
    t = zonedLocalToUtc(p2.y, p2.m, p2.d, hour, minute, ET);
  }
  return t;
}

function formatNextPostLabel(hour, minute, now = Date.now()) {
  const t = nextFireUtcMs(hour, minute, now);
  const todayKey = dayKeyInTz(now, ET);
  const fireKey = dayKeyInTz(t, ET);
  const hm = localHM(ET, t);
  const h12 = ((hm.hour + 11) % 12) + 1;
  const ampm = hm.hour >= 12 ? 'PM' : 'AM';
  const timeStr = `${h12}:${String(hm.minute).padStart(2, '0')} ${ampm} ET`;
  return (fireKey === todayKey ? 'Today' : 'Tomorrow') + ' · ' + timeStr;
}

function defaultDailyLb() {
  return {
    enabled: false, hour: 20, minute: 0, timeZone: ET,
    channelId: null, roleId: null, limit: 10,
    title: 'Daily XP Leaderboard', description: "Today's top contributors",
    footer: null, showAvatars: true, lastPostedDay: null,
  };
}

function normalizeDailyLb(raw) {
  const d = defaultDailyLb();
  if (!raw || typeof raw !== 'object') return { ...d };
  return {
    enabled: !!raw.enabled,
    hour: Math.max(0, Math.min(23, Number(raw.hour) ?? d.hour)),
    minute: Math.max(0, Math.min(59, Number(raw.minute) ?? d.minute)),
    timeZone: ET,
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

/** Real all-time XP from stored g.users (same source as panel / commands). */
function dailyXpRows(g, { dayKey, timeZone = ET, limit = 10 } = {}) {
  const n = Math.max(1, Math.min(25, Number(limit) || 10));
  const users = g && g.users && typeof g.users === 'object' ? g.users : {};
  return Object.entries(users)
    .map(([id, u]) => {
      const xp = Math.max(0, Math.floor(Number(u && u.xp) || 0));
      const level = Math.max(0, Math.floor(Number(u && u.level) || 0));
      return { id, xp, level };
    })
    .filter((r) => r.xp > 0)
    .sort((a, b) => b.xp - a.xp || b.level - a.level || a.id.localeCompare(b.id))
    .slice(0, n);
}

async function buildDailyLeaderboardMessage(guild, g, cfg) {
  const conf = normalizeDailyLb(cfg);
  const today = dayKeyInTz(Date.now(), ET);
  const rows = dailyXpRows(g, { limit: conf.limit || 10 });
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
    } catch { /* */ }
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${i + 1}.\``;
    lines.push(`${medal} **${name}** — **${r.xp}** XP`);
  }
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(conf.title || 'Daily XP Leaderboard')
    .setTimestamp(new Date());
  if (conf.description) embed.setDescription(conf.description);
  if (lines.length) embed.addFields({ name: `Top ${rows.length} · ${today} ET`, value: lines.join('\n').slice(0, 1024) });
  else embed.addFields({ name: `${today} ET`, value: 'No XP on the leaderboard yet.' });
  embed.setFooter({ text: (conf.footer || 'America/New_York').slice(0, 200) });
  return {
    content: conf.roleId ? `<@&${conf.roleId}>` : undefined,
    embeds: [embed],
    allowedMentions: conf.roleId ? { roles: [conf.roleId] } : { parse: [] },
  };
}

async function postOneGuild(client, leveling, guildId, guild, opts = {}) {
  const force = !!opts.force;
  let g;
  if (typeof leveling.guildState === 'function') g = leveling.guildState(guildId).g;
  else if (typeof leveling.loadAll === 'function') g = leveling.loadAll()[guildId];
  if (!g) return { ok: false, error: 'no_guild_state', detail: 'Leveling data missing for this server.' };
  const conf = normalizeDailyLb(g.dailyLeaderboard);
  if (!force && !conf.enabled) return { ok: false, error: 'disabled', detail: 'Automation is OFF.' };
  if (!conf.channelId) return { ok: false, error: 'no_channel', detail: 'No leaderboard channel selected.' };
  const today = dayKeyInTz(Date.now(), ET);
  if (!force && conf.lastPostedDay === today) return { ok: false, error: 'already_posted_today' };
  const ch = guild.channels.cache.get(conf.channelId)
    || await guild.channels.fetch(conf.channelId).catch(() => null);
  if (!ch || !ch.isTextBased?.()) return { ok: false, error: 'bad_channel', detail: 'Selected channel no longer exists or is not text-based.' };
  try {
    await ch.send(await buildDailyLeaderboardMessage(guild, g, conf));
    console.log('[dailyXpLb] posted', guildId, '→', conf.channelId, force ? '(test)' : '');
  } catch (e) {
    console.warn('[dailyXpLb] send failed', e.message);
    return { ok: false, error: 'send_failed', detail: e.message || String(e) };
  }
  if (!force) {
    g.dailyLeaderboard = { ...conf, lastPostedDay: today };
    if (typeof leveling.saveAll === 'function') {
      const bag = leveling.loadAll(); bag[guildId] = g; leveling.saveAll(bag);
    } else {
      const { readJson, writeJson } = require('./jsonStorage');
      const bag = readJson('levels.json', {});
      bag[guildId] = bag[guildId] || g;
      bag[guildId].dailyLeaderboard = g.dailyLeaderboard;
      writeJson('levels.json', bag);
    }
  }
  return { ok: true, channelId: conf.channelId };
}

function clearRunner() {
  if (global.__dailyXpLbTimeout) { clearTimeout(global.__dailyXpLbTimeout); global.__dailyXpLbTimeout = null; }
  if (global.__dailyXpLbTimer) { clearInterval(global.__dailyXpLbTimer); global.__dailyXpLbTimer = null; }
}

function armNext(client, leveling) {
  clearRunner();
  let soonest = Infinity;
  for (const [guildId] of client.guilds.cache) {
    try {
      let g;
      if (typeof leveling.guildState === 'function') g = leveling.guildState(guildId).g;
      else if (typeof leveling.loadAll === 'function') g = leveling.loadAll()[guildId];
      if (!g) continue;
      const conf = normalizeDailyLb(g.dailyLeaderboard);
      if (!conf.enabled || !conf.channelId) continue;
      const t = nextFireUtcMs(conf.hour, conf.minute);
      if (t < soonest) soonest = t;
    } catch { /* */ }
  }
  if (!Number.isFinite(soonest)) {
    global.__dailyXpLbTimeout = setTimeout(() => armNext(client, leveling), 15 * 60e3);
    return;
  }
  const delay = Math.max(1000, soonest - Date.now());
  console.log('[dailyXpLb] next fire in ' + Math.round(delay / 1000) + 's (America/New_York)');
  global.__dailyXpLbTimeout = setTimeout(async () => {
    try {
      for (const [guildId, guild] of client.guilds.cache) {
        await postOneGuild(client, leveling, guildId, guild);
      }
    } catch (e) { console.warn('[dailyXpLb] post', e.message); }
    armNext(client, leveling);
  }, delay);
}

function startDailyLeaderboardRunner(client, leveling) {
  global.__dailyXpLbStarted = true;
  armNext(client, leveling);
  console.log('[dailyXpLb] runner armed (America/New_York, next-fire timer)');
}

module.exports = {
  ET, defaultDailyLb, normalizeDailyLb, dayKeyInTz, localHM, nextFireUtcMs,
  formatNextPostLabel, dailyXpRows, buildDailyLeaderboardMessage,
  startDailyLeaderboardRunner, armNext, postOneGuild, clearRunner,
};
