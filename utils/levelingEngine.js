'use strict';

/**
 * Quantlab HQ leveling — MEE6-style message XP.
 * Curve: xp_to_next(n) = 5n² + 50n + 100
 * XP: uniform 15–25 per qualifying message · 60s cooldown
 * Roles: cumulative unlocks (never strip lower ranks)
 * Premium (Whop) is never granted by XP.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'levels.json';
const EVENTS_MAX = 5000;

const ROLE_REWARDS = [
  { level: 0,  label: 'Paper Traders', roleId: '1508049883234435183' },
  { level: 5,  label: 'Funded',        roleId: '1552067236280279060' },
  { level: 15, label: 'Locked In',     roleId: '1552067239048650775' },
  { level: 30, label: 'Edge',          roleId: '1552067242177601597' },
  { level: 50, label: 'Quant',         roleId: '1552067245230792704' },
];

const CHANNEL_UNLOCKS = [
  { name: '📡・signals',        roles: ['Edge', 'Quant'] },
  { name: '🎯・accountability', roles: ['Locked In', 'Edge', 'Quant'] },
  { name: '🧠・quant-desk',     roles: ['Quant'] },
  { name: '🎁・giveaways',      roles: ['public'], note: 'Gate per-giveaway by required role' },
];

function defaultGuild() {
  return {
    enabled: true,
    xpMin: 15,
    xpMax: 25,
    cooldownSec: 60,
    minMessageLength: 2,
    ignoreEmojiOnly: true,
    noXpChannelIds: [],
    noXpRoleIds: [],
    roleBoosts: {},
    channelBoosts: {},
    weekendBoost: 1,
    roleRewards: ROLE_REWARDS.map(r => ({ ...r })),
    users: {},
    events: [],
  };
}

function loadAll() {
  return readJson(FILE, {});
}

function saveAll(all) {
  writeJson(FILE, all);
}

function guildState(guildId) {
  const all = loadAll();
  if (!all[guildId]) {
    all[guildId] = defaultGuild();
    saveAll(all);
  }
  const g = all[guildId];
  if (!g.users) g.users = {};
  if (!g.events) g.events = [];
  if (!Array.isArray(g.roleRewards) || !g.roleRewards.length) {
    g.roleRewards = ROLE_REWARDS.map(r => ({ ...r }));
  }
  if (!Array.isArray(g.noXpChannelIds)) g.noXpChannelIds = [];
  if (!Array.isArray(g.noXpRoleIds)) g.noXpRoleIds = [];
  if (!g.roleBoosts) g.roleBoosts = {};
  if (!g.channelBoosts) g.channelBoosts = {};
  return { all, g };
}

function xpToNext(n) {
  const x = Math.max(0, Math.floor(Number(n) || 0));
  return 5 * x * x + 50 * x + 100;
}

function totalXpForLevel(L) {
  const target = Math.max(0, Math.floor(Number(L) || 0));
  let sum = 0;
  for (let n = 0; n < target; n++) sum += xpToNext(n);
  return sum;
}

function levelFromXp(totalXp) {
  let xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 0;
  for (;;) {
    const need = xpToNext(level);
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
  const stripped = t
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\p{Emoji_Component}/gu, '')
    .replace(/[\u200d\ufe0f\u20e3]/g, '')
    .replace(/\s+/g, '');
  return stripped.length === 0;
}

function qualifies(message, g) {
  if (!message?.guild || message.author?.bot) return false;
  if (message.system) return false;
  if (message.webhookId) return false;

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
  const list = (rewards || ROLE_REWARDS).filter(r => r.roleId && Number(r.level) <= level);
  for (const r of list) {
    try {
      if (!member.roles.cache.has(r.roleId)) {
        await member.roles.add(r.roleId, `Level ${r.level} · ${r.label}`).catch(() => {});
      }
    } catch { /* missing role / hierarchy */ }
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
    const prevLevel = levelFromXp(u.xp);
    u.xp = (Number(u.xp) || 0) + gained;
    u.lastXpAt = now;
    const newLevel = levelFromXp(u.xp);
    u.level = newLevel;
    g.users[userId] = u;

    g.events.unshift({
      at: now,
      userId,
      xp: gained,
      level: newLevel,
      mult: mult !== 1 ? mult : undefined,
      channelId: message.channel?.id,
    });
    if (g.events.length > EVENTS_MAX) g.events.length = EVENTS_MAX;

    all[guildId] = g;
    saveAll(all);

    if (newLevel > prevLevel && message.member) {
      await syncRoles(message.member, newLevel, g.roleRewards);
    }

    return { userId, gained, xp: u.xp, level: newLevel, leveledUp: newLevel > prevLevel };
  } catch (err) {
    console.error('[leveling]', err.message);
    return null;
  }
}

async function handleThreadCreate() {
  return null;
}

function manualXp(guildId, { userId, amount, reason, staffId }) {
  if (!userId || !/^\d{5,25}$/.test(String(userId))) return { error: 'bad_user' };
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return { error: 'bad_amount' };

  const { all, g } = guildState(guildId);
  const u = g.users[userId] || { xp: 0, level: 0, lastXpAt: 0 };
  const prev = levelFromXp(u.xp);
  u.xp = Math.max(0, (Number(u.xp) || 0) + Math.floor(n));
  u.level = levelFromXp(u.xp);
  g.users[userId] = u;
  g.events.unshift({
    at: Date.now(),
    userId,
    xp: Math.floor(n),
    level: u.level,
    reason: String(reason || 'manual').slice(0, 80),
    staffId: staffId || null,
  });
  if (g.events.length > EVENTS_MAX) g.events.length = EVENTS_MAX;
  all[guildId] = g;
  saveAll(all);
  return {
    ok: true,
    userId,
    xp: u.xp,
    level: u.level,
    leveledUp: u.level > prev,
    amount: Math.floor(n),
  };
}

function saveConfig(guildId, patch = {}, staffId) {
  const { all, g } = guildState(guildId);

  if (typeof patch.enabled === 'boolean') g.enabled = patch.enabled;
  if (patch.xpMin != null) g.xpMin = Math.max(1, Math.min(100, Number(patch.xpMin) || 15));
  if (patch.xpMax != null) g.xpMax = Math.max(g.xpMin, Math.min(200, Number(patch.xpMax) || 25));
  if (patch.cooldownSec != null) g.cooldownSec = Math.max(0, Math.min(3600, Number(patch.cooldownSec) || 60));
  if (patch.minMessageLength != null) g.minMessageLength = Math.max(0, Math.min(50, Number(patch.minMessageLength) || 0));
  if (typeof patch.ignoreEmojiOnly === 'boolean') g.ignoreEmojiOnly = patch.ignoreEmojiOnly;
  if (Array.isArray(patch.noXpChannelIds)) {
    g.noXpChannelIds = patch.noXpChannelIds.filter(id => /^\d{5,25}$/.test(String(id))).slice(0, 80);
  }
  if (Array.isArray(patch.noXpRoleIds)) {
    g.noXpRoleIds = patch.noXpRoleIds.filter(id => /^\d{5,25}$/.test(String(id))).slice(0, 40);
  }
  if (patch.weekendBoost != null) {
    const w = Number(patch.weekendBoost);
    g.weekendBoost = Number.isFinite(w) && w >= 1 ? Math.min(5, w) : 1;
  }
  if (patch.roleBoosts && typeof patch.roleBoosts === 'object') {
    const next = {};
    for (const [k, v] of Object.entries(patch.roleBoosts)) {
      if (!/^\d{5,25}$/.test(k)) continue;
      const m = Number(v);
      if (Number.isFinite(m) && m > 0 && m <= 10) next[k] = m;
    }
    g.roleBoosts = next;
  }
  if (patch.channelBoosts && typeof patch.channelBoosts === 'object') {
    const next = {};
    for (const [k, v] of Object.entries(patch.channelBoosts)) {
      if (!/^\d{5,25}$/.test(k)) continue;
      const m = Number(v);
      if (Number.isFinite(m) && m > 0 && m <= 10) next[k] = m;
    }
    g.channelBoosts = next;
  }
  if (Array.isArray(patch.roleRewards)) {
    g.roleRewards = patch.roleRewards
      .filter(r => r && /^\d{5,25}$/.test(String(r.roleId || '')))
      .map(r => ({
        level: Math.max(0, Math.min(500, Number(r.level) || 0)),
        label: String(r.label || 'Rank').slice(0, 40),
        roleId: String(r.roleId),
      }))
      .sort((a, b) => a.level - b.level)
      .slice(0, 20);
  }

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
  } catch { /* ignore */ }
  return null;
}

function leaderboardRows(g, guild, limit = 10) {
  return Object.entries(g.users || {})
    .map(([id, u]) => ({
      id,
      name: displayName(guild, id) || id,
      xp: Number(u.xp) || 0,
      level: levelFromXp(u.xp),
    }))
    .filter(r => r.xp > 0)
    .sort((a, b) => b.xp - a.xp || b.level - a.level)
    .slice(0, limit);
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
        if (ch.isTextBased?.() && !ch.isThread?.()) {
          channelOpts.push({
            id: ch.id,
            name: ch.name,
            kind: ch.type === 15 ? 'forum' : 'text',
          });
        }
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
  } catch { /* ignore */ }

  const lb = tracked ? leaderboardRows(g, guild, 15) : [];
  const recent = tracked
    ? (g.events || []).slice(0, 20).map(e => ({
        ...e,
        name: displayName(guild, e.userId) || e.userId,
      }))
    : [];

  const curveTable = [0, 5, 15, 30, 50].map(L => ({
    level: L,
    totalXp: totalXpForLevel(L),
    toNext: L < 50 ? xpToNext(L) : null,
  }));

  return {
    mode: 'mee6',
    enabled: g.enabled !== false,
    tracked,
    userCount,
    totalEvents: (g.events || []).length,
    xpMin: g.xpMin ?? 15,
    xpMax: g.xpMax ?? 25,
    cooldownSec: g.cooldownSec ?? 60,
    minMessageLength: g.minMessageLength ?? 2,
    ignoreEmojiOnly: g.ignoreEmojiOnly !== false,
    weekendBoost: g.weekendBoost ?? 1,
    noXpChannelIds: g.noXpChannelIds || [],
    noXpRoleIds: g.noXpRoleIds || [],
    roleBoosts: g.roleBoosts || {},
    channelBoosts: g.channelBoosts || {},
    roleRewards: (g.roleRewards || ROLE_REWARDS).map(r => ({
      ...r,
      totalXp: totalXpForLevel(r.level),
      roleName: roleOpts.find(o => o.id === r.roleId)?.name || r.label,
    })),
    channelUnlocks: CHANNEL_UNLOCKS,
    curveTable,
    formula: 'xp_to_next(n) = 5n² + 50n + 100',
    leaderboard: lb,
    recentEvents: recent,
    channelOpts,
    roleOpts,
    configVersion: g.configVersion || 0,
  };
}

module.exports = {
  handleMessage,
  processMessage: handleMessage,
  handleThreadCreate,
  panelSnapshot,
  saveConfig,
  manualXp,
  xpToNext,
  totalXpForLevel,
  levelFromXp,
  ROLE_REWARDS,
  CHANNEL_UNLOCKS,
};
