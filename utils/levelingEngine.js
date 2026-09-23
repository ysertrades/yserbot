'use strict';

/**
 * Quantlab HQ leveling — MEE6-style message XP + editable rank ladder.
 * Curve: xp_to_next(n) = curveBase × curveMult^n
 * Schema mee6-v2 wipes legacy contribution-engine user rows on first load.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'levels.json';
const SCHEMA = 'mee6-v2';
const EVENTS_MAX = 5000;

const DEFAULT_ROLE_REWARDS = [
  { level: 0,  label: 'Paper Traders', roleId: '1508049883234435183' },
  { level: 5,  label: 'Funded',        roleId: '1552067236280279060' },
  { level: 15, label: 'Locked In',     roleId: '1552067239048650775' },
  { level: 30, label: 'Edge',          roleId: '1552067242177601597' },
  { level: 50, label: 'Quant',         roleId: '1552067245230792704' },
];

const DEFAULT_CHANNEL_UNLOCKS = [
  { channelName: '📡・signals', roleLabels: ['Edge', 'Quant'], channelId: null, roleIds: [] },
  { channelName: '🎯・accountability', roleLabels: ['Locked In', 'Edge', 'Quant'], channelId: null, roleIds: [] },
  { channelName: '🧠・quant-desk', roleLabels: ['Quant'], channelId: null, roleIds: [] },
  { channelName: '🎁・giveaways', roleLabels: ['public'], channelId: null, roleIds: [], note: 'Public; gate per-giveaway' },
];

function defaultGuild() {
  return {
    schema: SCHEMA,
    enabled: true,
    xpMin: 15,
    xpMax: 25,
    cooldownSec: 60,
    curveBase: 100,
    curveMult: 1.5,
    minMessageLength: 2,
    ignoreEmojiOnly: true,
    noXpChannelIds: [],
    noXpRoleIds: [],
    roleBoosts: {},
    channelBoosts: {},
    weekendBoost: 1,
    roleRewards: DEFAULT_ROLE_REWARDS.map(r => ({ ...r })),
    channelUnlocks: DEFAULT_CHANNEL_UNLOCKS.map(u => ({ ...u, roleIds: [...(u.roleIds || [])] })),
    users: {},
    events: [],
  };
}

function loadAll() { return readJson(FILE, {}); }
function saveAll(all) { writeJson(FILE, all); }

function migrateGuild(g) {
  if (!g || typeof g !== 'object') return defaultGuild();
  if (g.schema === SCHEMA) {
    if (!g.users) g.users = {};
    if (!g.events) g.events = [];
    if (!Array.isArray(g.roleRewards) || !g.roleRewards.length) g.roleRewards = DEFAULT_ROLE_REWARDS.map(r => ({ ...r }));
    if (!Array.isArray(g.channelUnlocks)) g.channelUnlocks = DEFAULT_CHANNEL_UNLOCKS.map(u => ({ ...u }));
    if (!Array.isArray(g.noXpChannelIds)) g.noXpChannelIds = [];
    if (!Array.isArray(g.noXpRoleIds)) g.noXpRoleIds = [];
    if (!g.roleBoosts) g.roleBoosts = {};
    if (!g.channelBoosts) g.channelBoosts = {};
    if (g.curveBase == null) g.curveBase = 100;
    if (g.curveMult == null) g.curveMult = 1.5;
    return g;
  }
  const fresh = defaultGuild();
  if (g.xpMin != null) fresh.xpMin = g.xpMin;
  if (g.xpMax != null) fresh.xpMax = g.xpMax;
  if (g.cooldownSec != null) fresh.cooldownSec = g.cooldownSec;
  if (g.curveBase != null) fresh.curveBase = g.curveBase;
  if (g.curveMult != null) fresh.curveMult = g.curveMult;
  if (typeof g.enabled === 'boolean') fresh.enabled = g.enabled;
  if (Array.isArray(g.noXpChannelIds)) fresh.noXpChannelIds = g.noXpChannelIds;
  if (Array.isArray(g.noXpRoleIds)) fresh.noXpRoleIds = g.noXpRoleIds;
  if (Array.isArray(g.roleRewards) && g.roleRewards.length) fresh.roleRewards = g.roleRewards;
  if (Array.isArray(g.channelUnlocks) && g.channelUnlocks.length) fresh.channelUnlocks = g.channelUnlocks;
  return fresh;
}

function guildState(guildId) {
  const all = loadAll();
  const prev = all[guildId];
  const g = migrateGuild(prev);
  if (!prev || prev.schema !== SCHEMA) {
    all[guildId] = g;
    saveAll(all);
  }
  return { all, g };
}

function curveParams(g) {
  const base = Math.max(10, Math.min(50_000, Number(g?.curveBase) || 100));
  let mult = Number(g?.curveMult);
  if (!Number.isFinite(mult) || mult < 1) mult = 1;
  mult = Math.min(3, Math.round(mult * 1000) / 1000);
  return { base, mult };
}

function xpToNext(n, g) {
  const x = Math.max(0, Math.floor(Number(n) || 0));
  const { base, mult } = curveParams(g);
  if (mult === 1) return Math.round(base);
  return Math.max(1, Math.round(base * Math.pow(mult, x)));
}

function totalXpForLevel(L, g) {
  const target = Math.max(0, Math.floor(Number(L) || 0));
  let sum = 0;
  for (let n = 0; n < target; n++) sum += xpToNext(n, g);
  return sum;
}

function levelFromXp(totalXp, g) {
  let xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 0;
  for (;;) {
    const need = xpToNext(level, g);
    if (xp < need) break;
    xp -= need;
    level += 1;
    if (level > 500) break;
  }
  return level;
}

function isEmojiOnly(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  const stripped = t.replace(/\p{Extended_Pictographic}/gu, '').replace(/\p{Emoji_Component}/gu, '').replace(/[\u200d\ufe0f\u20e3]/g, '').replace(/\s+/g, '');
  return stripped.length === 0;
}

function qualifies(message, g) {
  if (!message?.guild || message.author?.bot) return false;
  if (message.system || message.webhookId) return false;
  const chId = message.channel?.id;
  if (chId && (g.noXpChannelIds || []).includes(chId)) return false;
  const member = message.member;
  if (member && (g.noXpRoleIds || []).some(id => member.roles?.cache?.has(id))) return false;
  const content = String(message.content || '').trim();
  const minLen = Number(g.minMessageLength) || 0;
  if (minLen > 0 && content.length < minLen && !(message.attachments?.size > 0)) return false;
  if (g.ignoreEmojiOnly !== false && isEmojiOnly(content) && !(message.attachments?.size > 0)) return false;
  return true;
}

function multiplierFor(message, g) {
  let m = 1;
  const chId = message.channel?.id;
  if (chId && g.channelBoosts?.[chId]) m *= Number(g.channelBoosts[chId]) || 1;
  const member = message.member;
  if (member && g.roleBoosts) {
    for (const [roleId, mult] of Object.entries(g.roleBoosts)) {
      if (member.roles?.cache?.has(roleId)) m = Math.max(m, Number(mult) || 1);
    }
  }
  const weekend = Number(g.weekendBoost) || 1;
  if (weekend > 1) {
    const day = new Date().getUTCDay();
    if (day === 0 || day === 6) m *= weekend;
  }
  return m;
}

function rollXp(g, mult) {
  const lo = Math.min(Number(g.xpMin) || 15, Number(g.xpMax) || 25);
  const hi = Math.max(Number(g.xpMin) || 15, Number(g.xpMax) || 25);
  const base = lo + Math.floor(Math.random() * (hi - lo + 1));
  return Math.max(1, Math.round(base * (mult || 1)));
}

async function syncRoles(member, level, rewards) {
  if (!member?.roles) return;
  const list = (rewards || []).filter(r => r.roleId && Number(r.level) <= level);
  for (const r of list) {
    try {
      if (!member.roles.cache.has(r.roleId)) {
        await member.roles.add(r.roleId, `Level ${r.level} · ${r.label || 'rank'}`).catch(() => {});
      }
    } catch {}
  }
}

async function handleMessage(message) {
  try {
    const guildId = message.guild?.id;
    if (!guildId) return null;
    const { all, g } = guildState(guildId);
    if (g.enabled === false) return null;
    if (!qualifies(message, g)) return null;
    const userId = message.author.id;
    const u = g.users[userId] || { xp: 0, level: 0, lastXpAt: 0 };
    const now = Date.now();
    const cdMs = Math.max(0, (Number(g.cooldownSec) || 60) * 1000);
    if (cdMs > 0 && u.lastXpAt && now - u.lastXpAt < cdMs) return null;
    const mult = multiplierFor(message, g);
    const gained = rollXp(g, mult);
    const prevLevel = levelFromXp(u.xp, g);
    u.xp = (Number(u.xp) || 0) + gained;
    u.lastXpAt = now;
    const newLevel = levelFromXp(u.xp, g);
    u.level = newLevel;
    g.users[userId] = u;
    g.events.unshift({ at: now, userId, xp: gained, level: newLevel, mult: mult !== 1 ? mult : undefined, channelId: message.channel?.id });
    if (g.events.length > EVENTS_MAX) g.events.length = EVENTS_MAX;
    all[guildId] = g;
    saveAll(all);
    if (newLevel > prevLevel && message.member) await syncRoles(message.member, newLevel, g.roleRewards);
    return { userId, gained, xp: u.xp, level: newLevel, leveledUp: newLevel > prevLevel };
  } catch (err) {
    console.error('[leveling]', err.message);
    return null;
  }
}

async function handleThreadCreate() { return null; }

function manualXp(guildId, { userId, amount, reason, staffId }) {
  if (!userId || !/^\d{5,25}$/.test(String(userId))) return { error: 'bad_user' };
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return { error: 'bad_amount' };
  const { all, g } = guildState(guildId);
  const u = g.users[userId] || { xp: 0, level: 0, lastXpAt: 0 };
  const prev = levelFromXp(u.xp, g);
  u.xp = Math.max(0, (Number(u.xp) || 0) + Math.floor(n));
  u.level = levelFromXp(u.xp, g);
  g.users[userId] = u;
  g.events.unshift({ at: Date.now(), userId, xp: Math.floor(n), level: u.level, reason: String(reason || 'manual').slice(0, 80), staffId: staffId || null });
  if (g.events.length > EVENTS_MAX) g.events.length = EVENTS_MAX;
  all[guildId] = g;
  saveAll(all);
  return { ok: true, userId, xp: u.xp, level: u.level, leveledUp: u.level > prev, amount: Math.floor(n) };
}

function resetAllXp(guildId, staffId) {
  const { all, g } = guildState(guildId);
  g.users = {};
  g.events = [];
  g.resetAt = Date.now();
  g.resetBy = staffId || null;
  all[guildId] = g;
  saveAll(all);
  return panelSnapshot(guildId, null);
}

function saveConfig(guildId, patch = {}, staffId) {
  const { all, g } = guildState(guildId);
  if (typeof patch.enabled === 'boolean') g.enabled = patch.enabled;
  if (patch.xpMin != null) g.xpMin = Math.max(1, Math.min(100, Number(patch.xpMin) || 15));
  if (patch.xpMax != null) g.xpMax = Math.max(g.xpMin, Math.min(200, Number(patch.xpMax) || 25));
  if (patch.cooldownSec != null) g.cooldownSec = Math.max(0, Math.min(3600, Number(patch.cooldownSec) || 60));
  if (patch.curveBase != null) {
    const b = Number(patch.curveBase);
    g.curveBase = Number.isFinite(b) ? Math.max(10, Math.min(50_000, Math.round(b))) : 100;
  }
  if (patch.curveMult != null) {
    const m = Number(patch.curveMult);
    g.curveMult = Number.isFinite(m) && m >= 1 ? Math.min(3, Math.round(m * 1000) / 1000) : 1;
  }
  if (patch.minMessageLength != null) g.minMessageLength = Math.max(0, Math.min(50, Number(patch.minMessageLength) || 0));
  if (typeof patch.ignoreEmojiOnly === 'boolean') g.ignoreEmojiOnly = patch.ignoreEmojiOnly;
  if (Array.isArray(patch.noXpChannelIds)) g.noXpChannelIds = patch.noXpChannelIds.filter(id => /^\d{5,25}$/.test(String(id))).slice(0, 80);
  if (Array.isArray(patch.noXpRoleIds)) g.noXpRoleIds = patch.noXpRoleIds.filter(id => /^\d{5,25}$/.test(String(id))).slice(0, 40);
  if (patch.weekendBoost != null) {
    const w = Number(patch.weekendBoost);
    g.weekendBoost = Number.isFinite(w) && w >= 1 ? Math.min(5, w) : 1;
  }
  if (Array.isArray(patch.roleRewards)) {
    g.roleRewards = patch.roleRewards.filter(r => r && String(r.roleId || '').match(/^\d{5,25}$/)).map(r => ({
      level: Math.max(0, Math.min(500, Number(r.level) || 0)),
      label: String(r.label || 'Rank').slice(0, 40),
      roleId: String(r.roleId),
    })).sort((a, b) => a.level - b.level).slice(0, 25);
  }
  if (Array.isArray(patch.channelUnlocks)) {
    g.channelUnlocks = patch.channelUnlocks.slice(0, 30).map(u => ({
      channelId: u.channelId && /^\d{5,25}$/.test(String(u.channelId)) ? String(u.channelId) : null,
      channelName: String(u.channelName || '').slice(0, 80) || null,
      roleIds: Array.isArray(u.roleIds) ? u.roleIds.filter(id => /^\d{5,25}$/.test(String(id))).slice(0, 15).map(String) : [],
      roleLabels: Array.isArray(u.roleLabels) ? u.roleLabels.map(s => String(s).slice(0, 40)).slice(0, 15) : [],
      note: u.note ? String(u.note).slice(0, 120) : undefined,
    }));
  }
  g.schema = SCHEMA;
  g.configVersion = (Number(g.configVersion) || 0) + 1;
  g.configUpdatedAt = Date.now();
  g.configBy = staffId || null;
  all[guildId] = g;
  saveAll(all);
  return panelSnapshot(guildId, null);
}

function displayName(guild, userId) {
  if (!guild || !userId) return null;
  try {
    const m = guild.members?.cache?.get(userId);
    if (m) return m.displayName || m.user?.globalName || m.user?.username || null;
    const u = guild.client?.users?.cache?.get(userId);
    if (u) return u.globalName || u.username || null;
  } catch {}
  return null;
}

function leaderboardRows(g, guild, limit = 15) {
  return Object.entries(g.users || {}).map(([id, u]) => ({
    id, name: displayName(guild, id) || id, xp: Number(u.xp) || 0, level: levelFromXp(u.xp, g),
  })).filter(r => r.xp > 0).sort((a, b) => b.xp - a.xp || b.level - a.level).slice(0, limit);
}

function panelSnapshot(guildId, guild) {
  const { g } = guildState(guildId);
  const userCount = Object.keys(g.users || {}).length;
  const tracked = userCount > 0 || (g.events || []).length > 0;
  const channelOpts = [];
  const roleOpts = [];
  try {
    if (guild?.channels?.cache) {
      for (const ch of guild.channels.cache.values()) {
        if (ch.isTextBased?.() && !ch.isThread?.()) channelOpts.push({ id: ch.id, name: ch.name, kind: ch.type === 15 ? 'forum' : 'text' });
      }
      channelOpts.sort((a, b) => a.name.localeCompare(b.name));
    }
    if (guild?.roles?.cache) {
      for (const r of guild.roles.cache.values()) {
        if (r.managed || r.id === guild.id) continue;
        roleOpts.push({ id: r.id, name: r.name });
      }
      roleOpts.sort((a, b) => a.name.localeCompare(b.name));
    }
  } catch {}
  const roleName = (id) => roleOpts.find(o => o.id === id)?.name || null;
  const chName = (id) => channelOpts.find(o => o.id === id)?.name || null;
  return {
    mode: 'mee6', schema: g.schema, enabled: g.enabled !== false, tracked, userCount,
    totalEvents: (g.events || []).length,
    xpMin: g.xpMin ?? 15, xpMax: g.xpMax ?? 25, cooldownSec: g.cooldownSec ?? 60,
    minMessageLength: g.minMessageLength ?? 2, ignoreEmojiOnly: g.ignoreEmojiOnly !== false,
    weekendBoost: g.weekendBoost ?? 1, noXpChannelIds: g.noXpChannelIds || [], noXpRoleIds: g.noXpRoleIds || [],
    curveBase: g.curveBase ?? 100,
    curveMult: g.curveMult ?? 1.5,
    roleRewards: (Array.isArray(g.roleRewards) ? g.roleRewards : []).map(r => ({ ...r, totalXp: totalXpForLevel(r.level, g), roleName: roleName(r.roleId) || r.label })),
    channelUnlocks: (Array.isArray(g.channelUnlocks) ? g.channelUnlocks : []).map(u => ({
      ...u,
      resolvedChannelName: u.channelId ? (chName(u.channelId) || u.channelName) : u.channelName,
      resolvedRoleNames: (u.roleIds || []).map(id => roleName(id) || id),
    })),
    curveTable: [1, 5, 15, 30, 50].map(L => ({
      level: L,
      totalXp: totalXpForLevel(L, g),
      stepXp: xpToNext(L - 1, g),
    })),
    formula: `xp_to_next(n) = ${g.curveBase ?? 100} × ${g.curveMult ?? 1.5}ⁿ`,
    leaderboard: tracked ? leaderboardRows(g, guild, 15) : [],
    recentEvents: tracked ? (Array.isArray(g.events) ? g.events : []).slice(0, 15).map(e => ({ ...e, name: displayName(guild, e.userId) || e.userId })) : [],
    channelOpts, roleOpts, configVersion: g.configVersion || 0,
  };
}

function progressFromXp(totalXp, g) {
  const level = levelFromXp(totalXp, g);
  const floor = totalXpForLevel(level, g);
  const need = xpToNext(level, g);
  const into = Math.max(0, Math.floor(totalXp) - floor);
  return { level, into, need, totalXp: Math.max(0, Math.floor(totalXp)) };
}

function getUserRank(guildId, userId) {
  const { g } = guildState(guildId);
  const u = (g.users || {})[userId] || { xp: 0, level: 0 };
  const prog = progressFromXp(u.xp, g);
  const rows = Object.entries(g.users || {})
    .map(([id, row]) => ({ id, xp: Number(row.xp) || 0 }))
    .filter(r => r.xp > 0)
    .sort((a, b) => b.xp - a.xp);
  const idx = rows.findIndex(r => r.id === userId);
  return {
    mode: 'mee6',
    tracked: rows.length,
    rank: idx >= 0 ? idx + 1 : null,
    user: {
      level: prog.level,
      xp: prog.into,
      neededXp: prog.need,
      totalXp: prog.totalXp,
      messages: 0,
    },
  };
}

function getLeaderboard(guildId, limit = 15) {
  const { g } = guildState(guildId);
  return Object.entries(g.users || {})
    .map(([id, u]) => {
      const prog = progressFromXp(u.xp, g);
      return { id, level: prog.level, totalXp: prog.totalXp };
    })
    .filter(r => r.totalXp > 0)
    .sort((a, b) => b.totalXp - a.totalXp || b.level - a.level)
    .slice(0, limit);
}

function resetUser(guildId, userId) {
  const { all, g } = guildState(guildId);
  if (!g.users[userId]) return { ok: true, missing: true };
  delete g.users[userId];
  all[guildId] = g;
  saveAll(all);
  return { ok: true };
}

function setUserLevel(guildId, userId, level) {
  const { all, g } = guildState(guildId);
  const target = Math.max(0, Math.min(500, Math.floor(Number(level) || 0));
  const xp = totalXpForLevel(target, g);
  g.users[userId] = { xp, level: target, lastXpAt: 0 };
  all[guildId] = g;
  saveAll(all);
  return { ok: true, userId, level: target, xp };
}

module.exports = {
  handleMessage, processMessage: handleMessage, handleThreadCreate,
  panelSnapshot, saveConfig, manualXp, resetAllXp,
  getUserRank, getLeaderboard, resetUser, setUserLevel,
  xpToNext, totalXpForLevel, levelFromXp, SCHEMA,
};
