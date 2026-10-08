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

/**
 * XP earned on a calendar day in guild TZ (from events log).
 * Ranking source for the automated daily post only — not lifetime totals.
 */
function dailyXpRows(g, { dayKey, timeZone = ET, limit = 10 } = {}) {
  const key = dayKey || dayKeyInTz(Date.now(), timeZone);
  const n = Math.max(1, Math.min(25, Number(limit) || 10));
  const xpMap = {};
  const log = Array.isArray(g.events) ? g.events : (g.xpEvents || []);
  for (const e of log) {
    if (!e || !e.userId || !e.xp) continue;
    const ts = e.createdAt || e.at || e.ts || 0;
    if (dayKeyInTz(ts, timeZone) !== key) continue;
    const id = String(e.userId);
    xpMap[id] = (xpMap[id] || 0) + Number(e.xp);
  }
  return Object.entries(xpMap)
    .map(([id, xp]) => ({ id, xp: Math.max(0, Math.floor(xp)) }))
    .filter((r) => r.xp > 0)
    .sort((a, b) => b.xp - a.xp || a.id.localeCompare(b.id))
    .slice(0, n);
}

const DIV = '✧ · · · · · · ✧';

function levelBar(into, need, cells = 8) {
  const n = Math.max(1, Number(need) || 1);
  const i = Math.max(0, Number(into) || 0);
  const pct = Math.max(0, Math.min(1, i / n));
  const filled = Math.round(pct * cells);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, cells - filled));
}

function levelPct(into, need) {
  const n = Math.max(1, Number(need) || 1);
  const i = Math.max(0, Number(into) || 0);
  return Math.round(Math.max(0, Math.min(1, i / n)) * 100);
}

function fmtXp(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function serverIcon(guild) {
  try {
    return guild?.iconURL({ extension: 'png', size: 128 }) || null;
  } catch {
    return null;
  }
}

async function resolveMentions(guild, ids) {
  const out = new Map();
  if (!guild || !ids?.length) return out;
  try {
    const fetched = await guild.members.fetch({ user: ids.slice(0, 25) });
    for (const [id, m] of fetched) {
      out.set(id, {
        label: '<@' + id + '>',
        name: m.displayName || m.user?.globalName || m.user?.username || null,
        inGuild: true,
      });
    }
  } catch { /* */ }
  for (const id of ids) {
    if (out.has(id)) continue;
    try {
      const m = await guild.members.fetch(id);
      out.set(id, {
        label: '<@' + id + '>',
        name: m.displayName || m.user?.globalName || m.user?.username || null,
        inGuild: true,
      });
      continue;
    } catch { /* */ }
    try {
      const u = await guild.client.users.fetch(id);
      const name = u.globalName || u.username || null;
      out.set(id, {
        label: name ? '**' + name + '**' : '`' + id + '`',
        name,
        inGuild: false,
      });
    } catch {
      out.set(id, { label: '`' + id + '`', name: null, inGuild: false });
    }
  }
  return out;
}

function who(resolved, id) {
  const r = resolved.get(id);
  if (r?.label) return r.label;
  return '<@' + id + '>';
}

/**
 * Same QuantLab · Ranks embed layout as /leaderboard,
 * ranked by XP earned that calendar day (America/New_York).
 */
async function buildDailyLeaderboardMessage(guild, g, cfg) {
  const conf = normalizeDailyLb(cfg);
  const today = dayKeyInTz(Date.now(), ET);
  const dayRows = dailyXpRows(g, { dayKey: today, timeZone: ET, limit: conf.limit || 10 });

  let BRAND_PURPLE = 0x5865F2;
  try {
    BRAND_PURPLE = require('./dropFormat').BRAND_PURPLE || BRAND_PURPLE;
  } catch { /* */ }

  const icon = serverIcon(guild);

  if (!dayRows.length) {
    const empty = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setAuthor({ name: 'QuantLab  ·  Ranks', iconURL: icon || undefined })
      .setTitle("Today's XP ladder")
      .setDescription('No XP earned yet today — chat in allowed channels to climb the daily ranks.')
      .setFooter({ text: 'QuantLab ranks · ' + today + ' ET' });
    if (icon) empty.setThumbnail(icon);
    empty.setTimestamp(new Date());
    return {
      content: conf.roleId ? `<@&${conf.roleId}>` : undefined,
      embeds: [empty],
      allowedMentions: conf.roleId ? { roles: [conf.roleId] } : { parse: [] },
    };
  }

  let progressFromXp = null;
  try {
    progressFromXp = require('./levelingEngine').progressFromXp;
  } catch { /* */ }

  const ranked = dayRows.map((r) => {
    const u = (g.users && g.users[r.id]) || {};
    let level = Math.max(0, Math.floor(Number(u.level) || 0));
    let into = 0;
    let need = 1;
    if (typeof progressFromXp === 'function') {
      try {
        const prog = progressFromXp(Number(u.xp) || 0, g);
        level = prog.level;
        into = prog.into;
        need = prog.need;
      } catch { /* */ }
    }
    return { id: r.id, dayXp: r.xp, level, into, need };
  });

  const resolved = await resolveMentions(guild, ranked.map((r) => r.id));
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3, 10);

  const embed = new EmbedBuilder()
    .setColor(BRAND_PURPLE)
    .setAuthor({ name: 'QuantLab  ·  Ranks', iconURL: icon || undefined })
    .setTitle("Today's XP ladder")
    .setDescription(DIV);

  const podiumMeta = [
    { idx: 1, label: '➁  Silver' },
    { idx: 0, label: '➀  Gold' },
    { idx: 2, label: '➂  Bronze' },
  ];

  for (const p of podiumMeta) {
    const u = top[p.idx];
    if (!u) {
      embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
      continue;
    }
    const into = u.into ?? 0;
    const need = u.need ?? 1;
    const pct = levelPct(into, need);
    embed.addFields({
      name: p.label,
      value: [
        who(resolved, u.id),
        '**+' + fmtXp(u.dayXp) + '** XP today',
        'Level **' + u.level + '**',
        '`' + levelBar(into, need, 8) + '`',
        pct + '%',
      ].join('\n'),
      inline: true,
    });
  }

  if (rest.length) {
    const body = rest
      .map((u, i) => {
        const rank = String(i + 4).padStart(2, '0');
        const into = u.into ?? 0;
        const need = u.need ?? 1;
        const pct = levelPct(into, need);
        return (
          '`' + rank + '` ' + who(resolved, u.id) +
          '\nLv **' + u.level + '** · **+' + fmtXp(u.dayXp) +
          '** XP today · `' + levelBar(into, need, 8) + '` ' + pct + '%'
        );
      })
      .join('\n\n');
    embed.addFields({ name: 'Ranks 4 – 10', value: body.slice(0, 1020), inline: false });
  }

  if (icon) embed.setThumbnail(icon);
  embed.setFooter({
    text: 'Top ' + ranked.length + ' today · progress = XP into next level · QuantLab · ' + today + ' ET',
  });
  embed.setTimestamp(new Date());

  const mentionIds = ranked.filter((r) => resolved.get(r.id)?.inGuild).map((r) => r.id);

  return {
    content: conf.roleId ? `<@&${conf.roleId}>` : undefined,
    embeds: [embed],
    allowedMentions: {
      parse: [],
      users: mentionIds,
      roles: conf.roleId ? [conf.roleId] : [],
    },
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
