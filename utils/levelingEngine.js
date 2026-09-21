'use strict';

/**
 * Trading-first leveling engine.
 * Default mode "trading": normal chat earns 0 XP.
 * Mode "legacy": previous random-per-message behavior.
 */

const { readJson, writeJson } = require('./jsonStorage');
const { ChannelType } = require('discord.js');

const FILE = 'levels.json';
const LEDGER_MAX = 250;

const SIGNAL_DEFS = {
  share: {
    label: 'Trade share',
    description: 'QuantLab / journal trade share',
    baseMin: 45,
    baseMax: 60,
    cooldownMs: 20 * 60 * 1000,
    dailyCountCap: 3,
    enabled: true,
  },
  chart: {
    label: 'Chart',
    description: 'Image/video in an earn channel',
    baseMin: 28,
    baseMax: 40,
    cooldownMs: 10 * 60 * 1000,
    dailyCountCap: 5,
    enabled: true,
  },
  setup: {
    label: 'Setup writeup',
    description: 'Structured trade idea (pair + bias/levels)',
    baseMin: 22,
    baseMax: 35,
    cooldownMs: 10 * 60 * 1000,
    dailyCountCap: 5,
    enabled: true,
  },
  journal: {
    label: 'Journal post',
    description: 'Post in your own journals forum thread',
    baseMin: 18,
    baseMax: 28,
    cooldownMs: 5 * 60 * 1000,
    dailyCountCap: 8,
    enabled: true,
  },
  journal_create: {
    label: 'Journal thread',
    description: 'Creating a journal forum thread',
    baseMin: 35,
    baseMax: 50,
    cooldownMs: 12 * 60 * 60 * 1000,
    dailyCountCap: 2,
    enabled: true,
  },
};

const TRADE_WORDS = /\b(long|short|buy|sell|entry|sl|tp|stop\s*loss|take\s*profit|bias|bullish|bearish|fvg|order\s*block|\bob\b|liquidity|sweep|bos|choch|imt|ict|smc|support|resistance|breakout|retest|scalp|swing|nq|mnq|es|mes|gc|mgc|eur|gbp|usd|gold|nasdaq|spy|qqq)\b/i;
const PAIR_LIKE = /\b([A-Z]{2,6}[\s\/\-]?[A-Z]{2,6}|[A-Z]{1,5}\d{1,4}|MNQ|MES|MES|NQ|ES|GC|MGC|6E|6B)\b/;

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function defaultGuild() {
  return {
    users: {},
    roles: {},
    badges: {},
    settings: {
      mode: 'trading',
      xpPerMessage: [15, 25],
      baseXp: 100,
      multiplier: 1.5,
      cooldownMs: 20000,
      minLength: 0,
      earnChannels: [],
      denyChannels: [],
      forumChannels: [],
      tradeShareChannels: [],
      signals: {},
      dailyXpCap: 400,
    },
    ledger: [],
    journalOwners: {},
  };
}

function loadAll() {
  return readJson(FILE, {});
}

function saveAll(all) {
  writeJson(FILE, all);
}

function ensureGuild(all, guildId) {
  if (!all[guildId]) all[guildId] = defaultGuild();
  const g = all[guildId];
  if (!g.users) g.users = {};
  if (!g.roles) g.roles = {};
  if (!g.badges) g.badges = {};
  if (!g.settings) g.settings = defaultGuild().settings;
  if (!g.ledger) g.ledger = [];
  if (!g.journalOwners) g.journalOwners = {};
  if (!g.settings.signals) g.settings.signals = {};
  if (!Array.isArray(g.settings.earnChannels)) g.settings.earnChannels = [];
  if (!Array.isArray(g.settings.denyChannels)) g.settings.denyChannels = [];
  if (!Array.isArray(g.settings.forumChannels)) g.settings.forumChannels = [];
  if (!Array.isArray(g.settings.tradeShareChannels)) g.settings.tradeShareChannels = [];
  if (g.settings.mode !== 'legacy' && g.settings.mode !== 'trading') g.settings.mode = 'trading';
  return g;
}

function ensureUser(g, userId) {
  if (!g.users[userId]) {
    g.users[userId] = {
      xp: 0,
      level: 1,
      messages: 0,
      lastMessage: 0,
      totalXp: 0,
      lastBySignal: {},
      dayKey: dayKey(),
      dayStats: { totalXp: 0, bySignal: {} },
    };
  }
  const u = g.users[userId];
  if (!u.lastBySignal) u.lastBySignal = {};
  if (!u.dayStats) u.dayStats = { totalXp: 0, bySignal: {} };
  const dk = dayKey();
  if (u.dayKey !== dk) {
    u.dayKey = dk;
    u.dayStats = { totalXp: 0, bySignal: {} };
  }
  return u;
}

function signalConfig(settings, type) {
  const base = SIGNAL_DEFS[type] || SIGNAL_DEFS.chart;
  const over = (settings.signals && settings.signals[type]) || {};
  return {
    label: base.label,
    description: base.description,
    baseMin: Number.isFinite(over.baseMin) ? over.baseMin : base.baseMin,
    baseMax: Number.isFinite(over.baseMax) ? over.baseMax : base.baseMax,
    cooldownMs: Number.isFinite(over.cooldownMs) ? over.cooldownMs : base.cooldownMs,
    dailyCountCap: Number.isFinite(over.dailyCountCap) ? over.dailyCountCap : base.dailyCountCap,
    enabled: over.enabled !== undefined ? !!over.enabled : base.enabled,
  };
}

function hasMedia(message) {
  const atts = [...(message.attachments?.values?.() || [])];
  if (atts.some(a => {
    const t = String(a.contentType || '');
    return t.startsWith('image/') || t.startsWith('video/') || /\.(png|jpe?g|gif|webp|mp4|mov|webm)$/i.test(a.name || a.url || '');
  })) return true;
  // stickers don't count as charts
  return false;
}

function looksLikeSetup(text) {
  const t = String(text || '').trim();
  if (t.length < 24) return false;
  const trade = TRADE_WORDS.test(t);
  const pair = PAIR_LIKE.test(t) || /\$[A-Z]{1,6}\b/.test(t);
  return trade && (pair || t.length >= 80);
}

function isForumThread(channel) {
  if (!channel) return false;
  if (channel.isThread?.()) {
    const parent = channel.parent;
    if (!parent) return true; // treat as thread; ownership still checked
    return parent.type === ChannelType.GuildForum || parent.type === 15;
  }
  return false;
}

function parentForumId(channel) {
  if (!channel?.isThread?.()) return null;
  return channel.parentId || channel.parent?.id || null;
}

function threadOwnerId(channel, journalOwners) {
  if (!channel?.isThread?.()) return null;
  const stored = journalOwners?.[channel.id];
  if (stored) return stored;
  // Discord: ownerId on thread, or starterMessage author when available
  return channel.ownerId || null;
}

/**
 * Classify a message into a trading signal, or null (no XP).
 */
function classifyMessage(message, settings) {
  const channelId = message.channelId;
  const deny = new Set(settings.denyChannels || []);
  if (deny.has(channelId)) return null;

  const earn = settings.earnChannels || [];
  const forums = settings.forumChannels || [];
  const shares = settings.tradeShareChannels || [];
  const strict = earn.length > 0 || forums.length > 0 || shares.length > 0;

  // Forum journal path
  if (isForumThread(message.channel)) {
    const forumId = parentForumId(message.channel);
    if (forums.length && forumId && !forums.includes(forumId)) return null;
    if (strict && forums.length === 0) return null;
    const owner = threadOwnerId(message.channel, null); // caller passes owners at award time
    return { type: 'journal', needsOwner: true, channelId };
  }

  if (shares.includes(channelId) && hasMedia(message)) {
    return { type: 'share', channelId };
  }

  const inEarn = earn.length === 0 ? !strict : earn.includes(channelId);
  if (!inEarn) return null;

  if (hasMedia(message)) return { type: 'chart', channelId };
  if (looksLikeSetup(message.content)) return { type: 'setup', channelId };
  return null; // normal chat → no XP in trading mode
}

function rollXp(cfg) {
  const min = Math.min(cfg.baseMin, cfg.baseMax);
  const max = Math.max(cfg.baseMin, cfg.baseMax);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pushLedger(g, entry) {
  g.ledger.unshift(entry);
  if (g.ledger.length > LEDGER_MAX) g.ledger.length = LEDGER_MAX;
}

function applyLevelUps(user, settings) {
  const baseXp = settings.baseXp || 100;
  const multiplier = settings.multiplier || 1.5;
  const ups = [];
  let guard = 0;
  while (guard++ < 20) {
    const needed = Math.floor(baseXp * Math.pow(user.level, multiplier));
    if (user.xp < needed) break;
    user.xp -= needed;
    user.level += 1;
    ups.push(user.level);
  }
  return ups;
}

/**
 * Award XP for a classified signal. Returns result object.
 */
function award(guildId, userId, signalType, meta = {}) {
  const all = loadAll();
  const g = ensureGuild(all, guildId);
  const settings = g.settings;
  const user = ensureUser(g, userId);
  const cfg = signalConfig(settings, signalType);
  const now = Date.now();

  if (!cfg.enabled) {
    return { ok: false, reason: 'disabled', type: signalType };
  }

  if (user.xpMuteUntil && user.xpMuteUntil > now) {
    return { ok: false, reason: 'muted', type: signalType };
  }

  const last = user.lastBySignal[signalType] || 0;
  if (cfg.cooldownMs > 0 && now - last < cfg.cooldownMs) {
    return { ok: false, reason: 'cooldown', type: signalType, retryInMs: cfg.cooldownMs - (now - last) };
  }

  const day = user.dayStats.bySignal[signalType] || { n: 0, xp: 0 };
  if (cfg.dailyCountCap > 0 && day.n >= cfg.dailyCountCap) {
    return { ok: false, reason: 'daily_cap', type: signalType };
  }

  const dailyXpCap = Number.isFinite(settings.dailyXpCap) ? settings.dailyXpCap : 400;
  if (dailyXpCap > 0 && user.dayStats.totalXp >= dailyXpCap) {
    return { ok: false, reason: 'daily_xp_cap', type: signalType };
  }

  // Simple content fingerprint anti-dupe (text)
  const fp = meta.fingerprint;
  if (fp) {
    if (!g.recentFingerprints) g.recentFingerprints = {};
    const prev = g.recentFingerprints[`${userId}:${fp}`];
    if (prev && now - prev < 6 * 60 * 60 * 1000) {
      return { ok: false, reason: 'duplicate', type: signalType };
    }
    g.recentFingerprints[`${userId}:${fp}`] = now;
    // prune occasionally
    const keys = Object.keys(g.recentFingerprints);
    if (keys.length > 2000) {
      for (const k of keys.slice(0, 500)) delete g.recentFingerprints[k];
    }
  }

  let xp = rollXp(cfg);
  if (dailyXpCap > 0) xp = Math.min(xp, Math.max(0, dailyXpCap - user.dayStats.totalXp));
  if (xp <= 0) return { ok: false, reason: 'daily_xp_cap', type: signalType };

  user.lastBySignal[signalType] = now;
  user.lastMessage = now;
  user.messages = (user.messages || 0) + 1;
  user.xp += xp;
  user.totalXp = (user.totalXp || 0) + xp;
  day.n += 1;
  day.xp += xp;
  user.dayStats.bySignal[signalType] = day;
  user.dayStats.totalXp += xp;

  const levelsGained = applyLevelUps(user, settings);

  pushLedger(g, {
    at: now,
    userId,
    type: signalType,
    xp,
    channelId: meta.channelId || null,
    ok: true,
  });

  saveAll(all);
  return {
    ok: true,
    type: signalType,
    xp,
    level: user.level,
    levelsGained,
    totalXp: user.totalXp,
    user,
  };
}

/** Legacy random message XP (old behavior). */
function awardLegacy(guildId, userId, meta = {}) {
  const all = loadAll();
  const g = ensureGuild(all, guildId);
  const settings = g.settings;
  const user = ensureUser(g, userId);
  const now = Date.now();

  const minLength = Number.isFinite(settings.minLength) ? settings.minLength : 0;
  if (minLength > 0 && (meta.contentLength || 0) < minLength) {
    return { ok: false, reason: 'short' };
  }
  const cooldownMs = Number.isFinite(settings.cooldownMs) ? settings.cooldownMs : 20000;
  if (now - (user.lastMessage || 0) < cooldownMs) {
    return { ok: false, reason: 'cooldown' };
  }

  const band = Array.isArray(settings.xpPerMessage) ? settings.xpPerMessage : [15, 25];
  const minXp = band[0] || 15;
  const maxXp = band[1] || 25;
  const xp = Math.floor(Math.random() * (maxXp - minXp + 1)) + minXp;

  user.lastMessage = now;
  user.messages = (user.messages || 0) + 1;
  user.xp += xp;
  user.totalXp = (user.totalXp || 0) + xp;
  const levelsGained = applyLevelUps(user, settings);

  pushLedger(g, { at: now, userId, type: 'legacy', xp, channelId: meta.channelId || null, ok: true });
  saveAll(all);
  return { ok: true, type: 'legacy', xp, level: user.level, levelsGained, totalXp: user.totalXp, user };
}

function fingerprintContent(message) {
  const text = String(message.content || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  const att = [...(message.attachments?.values?.() || [])].map(a => a.id || a.url).join(',');
  const raw = text + '|' + att;
  if (!raw || raw === '|') return null;
  // cheap hash
  let h = 0;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
  return String(h);
}

async function processMessage(message) {
  if (!message.guild || message.author.bot) return null;
  const guildId = message.guild.id;
  const all = loadAll();
  const g = ensureGuild(all, guildId);
  const settings = g.settings;

  if (settings.mode === 'legacy') {
    return awardLegacy(guildId, message.author.id, {
      contentLength: message.content.trim().length,
      channelId: message.channelId,
    });
  }

  // trading mode
  let signal = classifyMessage(message, settings);
  if (!signal) return null;

  if (signal.needsOwner) {
    const owner = threadOwnerId(message.channel, g.journalOwners);
    if (!owner || owner !== message.author.id) {
      pushLedger(g, {
        at: Date.now(),
        userId: message.author.id,
        type: 'journal',
        xp: 0,
        channelId: message.channelId,
        ok: false,
        reason: 'not_owner',
      });
      saveAll(all);
      return { ok: false, reason: 'not_owner', type: 'journal' };
    }
    // register owner if missing
    if (message.channel.isThread?.() && !g.journalOwners[message.channel.id]) {
      g.journalOwners[message.channel.id] = owner;
      saveAll(all);
    }
  }

  return award(guildId, message.author.id, signal.type, {
    channelId: message.channelId,
    fingerprint: fingerprintContent(message),
  });
}

async function processThreadCreate(thread) {
  if (!thread?.guild || thread.type === undefined) return null;
  const guildId = thread.guild.id;
  const all = loadAll();
  const g = ensureGuild(all, guildId);
  const settings = g.settings;
  if (settings.mode === 'legacy') return null;

  const parentId = thread.parentId;
  const forums = settings.forumChannels || [];
  if (forums.length && parentId && !forums.includes(parentId)) return null;
  if (!forums.length) return null; // must configure forums for journal_create

  const ownerId = thread.ownerId;
  if (!ownerId) return null;
  g.journalOwners[thread.id] = ownerId;
  saveAll(all);

  return award(guildId, ownerId, 'journal_create', { channelId: thread.id });
}

function panelSnapshot(guildId, guild) {
  const all = loadAll();
  const g = ensureGuild(all, guildId);
  const settings = g.settings;
  const users = Object.entries(g.users || {}).map(([id, u]) => {
    const member = guild?.members?.cache?.get(id);
    const name = member?.displayName || member?.user?.username || id;
    return {
      id,
      name,
      level: u.level || 1,
      xp: u.xp || 0,
      totalXp: u.totalXp || 0,
      dayXp: u.dayStats?.totalXp || 0,
      dayBySignal: u.dayStats?.bySignal || {},
      messages: u.messages || 0,
    };
  }).sort((a, b) => (b.totalXp - a.totalXp) || (b.level - a.level));

  const today = dayKey();
  let todayXp = 0;
  let todayGrants = 0;
  const mix = {};
  for (const e of g.ledger || []) {
    if (dayKey(e.at) !== today) continue;
    if (!e.ok) continue;
    todayXp += e.xp || 0;
    todayGrants += 1;
    mix[e.type] = (mix[e.type] || 0) + (e.xp || 0);
  }

  const signals = Object.keys(SIGNAL_DEFS).map(type => {
    const cfg = signalConfig(settings, type);
    return { type, ...cfg };
  });

  const channelOpts = [];
  if (guild?.channels?.cache) {
    for (const ch of guild.channels.cache.values()) {
      if (ch.isThread?.()) continue;
      const isText = ch.isTextBased?.() && ch.type !== ChannelType.GuildVoice;
      const isForum = ch.type === ChannelType.GuildForum || ch.type === 15;
      if (!isText && !isForum) continue;
      channelOpts.push({
        id: ch.id,
        name: ch.name,
        kind: isForum ? 'forum' : 'text',
      });
    }
    channelOpts.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    mode: settings.mode || 'trading',
    signals,
    sources: {
      earnChannels: settings.earnChannels || [],
      denyChannels: settings.denyChannels || [],
      forumChannels: settings.forumChannels || [],
      tradeShareChannels: settings.tradeShareChannels || [],
    },
    dailyXpCap: settings.dailyXpCap ?? 400,
    stats: {
      tracked: users.length,
      todayXp,
      todayGrants,
      mix,
      levelUpsToday: (g.ledger || []).filter(e => e.ok && dayKey(e.at) === today && e.levelsGained).length,
    },
    leaderboard: users.slice(0, 40),
    ledger: (g.ledger || []).slice(0, 40),
    channelOpts,
  };
}

function saveTradingSettings(guildId, body) {
  const all = loadAll();
  const g = ensureGuild(all, guildId);
  const s = g.settings;

  if (body.mode === 'legacy' || body.mode === 'trading') s.mode = body.mode;
  if (Number.isFinite(Number(body.dailyXpCap))) s.dailyXpCap = Math.max(0, Math.min(5000, Number(body.dailyXpCap)));

  const listFields = ['earnChannels', 'denyChannels', 'forumChannels', 'tradeShareChannels'];
  for (const key of listFields) {
    if (Array.isArray(body[key])) {
      s[key] = body[key].map(String).filter(Boolean).slice(0, 50);
    }
  }

  if (body.signals && typeof body.signals === 'object') {
    if (!s.signals) s.signals = {};
    for (const [type, cfg] of Object.entries(body.signals)) {
      if (!SIGNAL_DEFS[type]) continue;
      const cur = s.signals[type] || {};
      s.signals[type] = {
        ...cur,
        enabled: cfg.enabled !== undefined ? !!cfg.enabled : cur.enabled,
        baseMin: Number.isFinite(Number(cfg.baseMin)) ? Number(cfg.baseMin) : cur.baseMin,
        baseMax: Number.isFinite(Number(cfg.baseMax)) ? Number(cfg.baseMax) : cur.baseMax,
        cooldownMs: Number.isFinite(Number(cfg.cooldownMs)) ? Number(cfg.cooldownMs) : cur.cooldownMs,
        dailyCountCap: Number.isFinite(Number(cfg.dailyCountCap)) ? Number(cfg.dailyCountCap) : cur.dailyCountCap,
      };
    }
  }

  // still allow legacy curve fields via existing saveLevels
  saveAll(all);
  return { ok: true, changed: ['Trading rank'] };
}

module.exports = {
  SIGNAL_DEFS,
  processMessage,
  processThreadCreate,
  panelSnapshot,
  saveTradingSettings,
  award,
  loadAll,
  ensureGuild,
  signalConfig,
};
