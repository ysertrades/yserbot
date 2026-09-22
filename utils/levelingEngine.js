'use strict';

/**
 * QuantLab Trading Server XP & Rank System v2
 * Contribution-weighted leveling — detection before weighting, ownership before credit.
 * Spec: Technical Design Spec v2 (September 2026)
 */

const { readJson, writeJson } = require('./jsonStorage');
const { ChannelType } = require('discord.js');
const crypto = require('crypto');

const FILE = 'levels.json';
const EVENTS_MAX = 8000;
const LEDGER_MAX = 400;

/* ── Categories (§02) ───────────────────────────────────────────────────── */

const CATEGORIES = {
  chat: {
    key: 'chat', label: 'Chat',
    xpMin: 1, xpMax: 2, cooldownMs: 60_000,
    dailyFloorPct: [1, 0.7, 0.45, 0.2],
  },
  ontopic: {
    key: 'ontopic', label: 'On-topic chat',
    xpMin: 4, xpMax: 6, cooldownMs: 60_000,
    dailyFloorPct: [1, 0.7, 0.45, 0.2],
  },
  chart: {
    key: 'chart', label: 'Chart / screenshot',
    xpMin: 15, xpMax: 25, cooldownMs: 5 * 60_000,
    dailyFloorPct: [1, 0.7, 0.45, 0.2],
  },
  idea: {
    key: 'idea', label: 'Trade idea',
    xpMin: 25, xpMax: 40, cooldownMs: 10 * 60_000,
    dailyFloorPct: [1, 0.7, 0.45, 0.2],
  },
  quantlab_verified: {
    key: 'quantlab_verified', label: 'QuantLab share (verified)',
    xpMin: 50, xpMax: 70, cooldownMs: 15 * 60_000,
    dailyFloorPct: [1, 0.85, 0.6, 0.35],
  },
  quantlab_unverified: {
    key: 'quantlab_unverified', label: 'QuantLab share (unverified)',
    xpMin: 30, xpMax: 40, cooldownMs: 15 * 60_000,
    dailyFloorPct: [1, 0.8, 0.55, 0.3],
  },
  journal: {
    key: 'journal', label: 'Journal post (own thread)',
    xpMin: 20, xpMax: 35, cooldownMs: 0,
    dailyFloorPct: [1, 0.25, 0.15, 0.1],
  },
  comment: {
    key: 'comment', label: 'Comment / help',
    xpMin: 5, xpMax: 8, cooldownMs: 3 * 60_000,
    dailyFloorPct: [1, 0.7, 0.45, 0.2],
  },
};

/* ── Ranks (§06) ────────────────────────────────────────────────────────── */

const RANKS = [
  { level: 1,  key: 'observer',   label: 'Observer',         unlock: 'Full read access' },
  { level: 5,  key: 'novice',     label: 'Trader — Novice',  unlock: '#trade-ideas + journals' },
  { level: 12, key: 'analyst',    label: 'Trader — Analyst', unlock: 'Alert ping + analyst channel' },
  { level: 22, key: 'strategist', label: 'Trader — Strategist', unlock: 'Vanity + pin in own journal' },
  { level: 35, key: 'senior',     label: 'Senior Trader',    unlock: 'Mentorship + weekly feature' },
  { level: 50, key: 'elite',      label: 'Elite Trader',     unlock: 'Hall of Trades + bot beta' },
];

const BADGE_DEFS = {
  consistent_journaler: { label: 'Consistent Journaler', need: '14-day journal streak' },
  chart_analyst:        { label: 'Chart Analyst',        need: 'Full-tier chart posts' },
  verified_trader:      { label: 'Verified Trader',      need: 'QR-verified QuantLab shares' },
  mentor:               { label: 'Mentor',               need: 'Help XP in others’ threads' },
};

/* ── Vocabulary (seed; panel can extend) ────────────────────────────────── */

const TRADE_VOCAB = /\b(long|short|buy|sell|entry|exit|stop|target|sl|tp|r:?r|breakout|retest|bias|bullish|bearish|support|resistance|fvg|ob|order\s*block|liquidity|sweep|bos|choch|scalp|swing|setup|thesis|invalidation)\b/i;

/** Valid symbol: any well-formed ticker token — no fixed allowlist limit. */
function extractSymbols(text) {
  if (!text) return [];
  const found = new Set();
  // $TICKER (1–12 alnum)
  for (const m of text.matchAll(/\$([A-Za-z][A-Za-z0-9.\-]{0,11})\b/g)) {
    found.add(m[1].toUpperCase());
  }
  // EXCHANGE:SYMBOL or NASDAQ:AAPL style
  for (const m of text.matchAll(/\b([A-Z]{2,8}):([A-Za-z][A-Za-z0-9.\-]{0,11})\b/g)) {
    found.add(`${m[1]}:${m[2]}`.toUpperCase());
  }
  // Bare futures / index roots common in trading (still format-valid, not a closed list)
  for (const m of text.matchAll(/\b([A-Z]{1,6}\d{0,4})\b/g)) {
    const s = m[1];
    if (s.length >= 2 && /[A-Z]/.test(s) && !/^(I|A|THE|AND|OR|FOR|TO|ON|IN|AT|IS|IT|MY|BE|AS|IF|NO|YES|GM|GN|LOL|OMG|WTF|IMO|TBH)$/.test(s)) {
      // only accept if nearby trade vocab or $ already present — handled by caller
      if (s.length <= 6) found.add(s);
    }
  }
  return [...found];
}

function isValidSymbolToken(sym) {
  if (!sym || typeof sym !== 'string') return false;
  const s = sym.replace(/^\$/, '').trim();
  if (s.length < 1 || s.length > 20) return false;
  // Must look like a tradable symbol: letters, optional digits, optional . - :
  return /^[A-Za-z][A-Za-z0-9.\-]*(?::[A-Za-z][A-Za-z0-9.\-]*)?$/.test(s);
}

function hasOnTopicSignal(text) {
  if (!text) return false;
  if (TRADE_VOCAB.test(text)) return true;
  const syms = extractSymbols(text).filter(isValidSymbolToken);
  // $TICKER or EXCHANGE:SYMBOL is enough
  if (/\$[A-Za-z]/.test(text) || /[A-Z]{2,8}:[A-Za-z]/.test(text)) return true;
  return syms.length > 0 && TRADE_VOCAB.test(text);
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function monthKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 7);
}

function randXp(cat) {
  const a = cat.xpMin, b = cat.xpMax;
  return a + Math.floor(Math.random() * (b - a + 1));
}

function xpForLevel(level, baseXp = 150, mult = 1.45) {
  // cumulative XP required to reach `level`
  let total = 0;
  for (let L = 1; L < level; L++) total += Math.floor(baseXp * Math.pow(mult, L - 1));
  return total;
}

function levelFromXp(xp, baseXp = 150, mult = 1.45) {
  let level = 1;
  let need = baseXp;
  let rem = Math.max(0, xp);
  while (rem >= need && level < 200) {
    rem -= need;
    level += 1;
    need = Math.floor(baseXp * Math.pow(mult, level - 1));
  }
  return { level, into: rem, need };
}

function rankForLevel(level) {
  let cur = RANKS[0];
  for (const r of RANKS) if (level >= r.level) cur = r;
  return cur;
}

function defaultGuild() {
  return {
    enabled: true,
    baseXp: 150,
    multiplier: 1.45,
    dailyXpCeiling: 2500,
    tradeMaxAgeDays: 7,
    noXpRoleIds: [],
    ignoreStaffAuthors: true,
    channels: {
      general: [],       // chat / ontopic
      trading: [],       // chart / quantlab
      tradeIdeas: [],    // idea quality gate
      journalsForum: [], // forum channel ids
    },
    vocabularyExtra: [], // staff-added tokens
    weights: Object.fromEntries(
      Object.values(CATEGORIES).map(c => [c.key, { xpMin: c.xpMin, xpMax: c.xpMax, cooldownMs: c.cooldownMs }])
    ),
    ranks: Object.fromEntries(RANKS.map(r => [r.level, { roleId: null, label: r.label }])),
    badges: {
      chart_analyst: { threshold: 25 },
      verified_trader: { threshold: 10 },
      mentor: { threshold: 200 },
      consistent_journaler: { days: 14 },
    },
    users: {},           // userId -> { xp, level, badges, streak, lastJournalDay, categoryDay, cooldowns, seenTradeIds, seenHashes }
    journalThreads: {},  // threadId -> { ownerId, orphaned, createdAt }
    quantlabShares: [],  // recent verified/unverified extractions
    xpEvents: [],        // append-only log (trimmed)
    configVersions: [],
    manualAudit: [],
    farmingFlags: {},
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
  if (!all[guildId]) all[guildId] = defaultGuild();
  const g = all[guildId];
  // migrate missing keys
  if (!g.users) g.users = {};
  if (!g.journalThreads) g.journalThreads = {};
  if (!g.xpEvents) g.xpEvents = [];
  if (!g.weights) g.weights = defaultGuild().weights;
  if (!g.channels) g.channels = defaultGuild().channels;
  if (!g.ranks) g.ranks = defaultGuild().ranks;
  if (!g.badges) g.badges = defaultGuild().badges;
  if (!g.configVersions) g.configVersions = [];
  if (!g.manualAudit) g.manualAudit = [];
  if (!g.quantlabShares) g.quantlabShares = [];
  if (g.enabled === undefined) g.enabled = true;
  return { all, g };
}

function userState(g, userId) {
  if (!g.users[userId]) {
    g.users[userId] = {
      xp: 0, level: 1,
      badges: {},
      journalStreak: 0,
      lastJournalDay: null,
      categoryDay: {},   // dayKey -> { cat: count }
      cooldowns: {},     // cat -> ts
      seenTradeIds: {},  // tradeId -> ts
      seenHashes: {},    // phash -> ts
      commentXp: 0,
      chartCount: 0,
      verifiedCount: 0,
    };
  }
  return g.users[userId];
}

function catConfig(g, key) {
  const base = CATEGORIES[key];
  const w = (g.weights && g.weights[key]) || {};
  return {
    ...base,
    xpMin: w.xpMin ?? base.xpMin,
    xpMax: w.xpMax ?? base.xpMax,
    cooldownMs: w.cooldownMs ?? base.cooldownMs,
  };
}

function diminishing(g, u, catKey, now = Date.now()) {
  const dk = dayKey(now);
  if (!u.categoryDay[dk]) u.categoryDay[dk] = {};
  const n = u.categoryDay[dk][catKey] || 0;
  const floors = (CATEGORIES[catKey] && CATEGORIES[catKey].dailyFloorPct) || [1, 0.7, 0.45, 0.2];
  const idx = Math.min(n, floors.length - 1);
  return floors[idx];
}

function bumpCategoryDay(u, catKey, now = Date.now()) {
  const dk = dayKey(now);
  if (!u.categoryDay[dk]) u.categoryDay[dk] = {};
  u.categoryDay[dk][catKey] = (u.categoryDay[dk][catKey] || 0) + 1;
}

function dailyXpUsed(u, now = Date.now()) {
  const dk = dayKey(now);
  // sum from events would be ideal; approximate from categoryDay * avg not stored —
  // track dailyXp on user
  if (!u.dailyXp) u.dailyXp = {};
  return u.dailyXp[dk] || 0;
}

function addDailyXp(u, amount, now = Date.now()) {
  const dk = dayKey(now);
  if (!u.dailyXp) u.dailyXp = {};
  u.dailyXp[dk] = (u.dailyXp[dk] || 0) + amount;
}

/* ── Classification ─────────────────────────────────────────────────────── */

function channelKind(g, channel) {
  if (!channel) return 'other';
  const id = channel.id;
  const parentId = channel.parentId || null;
  const isThread = channel.isThread?.() || channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread;
  const ch = g.channels || {};
  if ((ch.journalsForum || []).includes(id) || (parentId && (ch.journalsForum || []).includes(parentId))) return 'journal';
  if ((ch.tradeIdeas || []).includes(id) || (parentId && (ch.tradeIdeas || []).includes(parentId))) return 'ideas';
  if ((ch.trading || []).includes(id) || (parentId && (ch.trading || []).includes(parentId))) return 'trading';
  if ((ch.general || []).includes(id) || (parentId && (ch.general || []).includes(parentId))) return 'general';
  // If no channels configured, treat text channels as general, forums as journal candidates
  if (!(ch.general || []).length && !(ch.trading || []).length) {
    if (channel.type === ChannelType.GuildForum || (isThread && channel.parent?.type === ChannelType.GuildForum)) return 'journal';
    return 'general';
  }
  return 'other';
}

function hasImage(message) {
  const atts = [...(message.attachments?.values?.() || [])];
  if (atts.some(a => (a.contentType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(a.name || a.url || ''))) return true;
  if (message.embeds?.some(e => e.image || e.thumbnail)) return true;
  return false;
}

function quantlabHints(message) {
  const text = [
    message.content || '',
    ...(message.embeds || []).map(e => [e.title, e.description, e.footer?.text, e.author?.name, ...(e.fields || []).map(f => `${f.name} ${f.value}`)].filter(Boolean).join(' ')),
  ].join(' ').toLowerCase();

  const verifiedMarkers = /quant\s*lab|shared via quant|quantlab/i.test(text);
  let tradeId = null;
  // URL with trade id
  const urlM = text.match(/quantlab[^\s]*[?&/](?:trade[_-]?id|id)=([a-zA-Z0-9_-]{6,64})/i)
    || text.match(/\/trades?\/([a-zA-Z0-9_-]{8,64})/i);
  if (urlM) tradeId = urlM[1];
  // bare id patterns near QuantLab wording
  if (!tradeId) {
    const bare = text.match(/\b(ql[_-]?[a-z0-9]{6,32}|trade[_-]?[a-z0-9]{8,32})\b/i);
    if (bare && verifiedMarkers) tradeId = bare[1];
  }
  return { verifiedMarkers, tradeId, text };
}

function ideaQuality(message) {
  const content = (message.content || '').trim();
  const len = content.length;
  const symbols = extractSymbols(content).filter(isValidSymbolToken);
  const hasSym = symbols.length > 0 || /\$[A-Za-z]/.test(content);
  const structured = TRADE_VOCAB.test(content) && hasSym;
  const img = hasImage(message);
  if (len >= 80 && structured && (img || len >= 140)) return 'full';
  if (len >= 40 && (structured || img)) return 'partial';
  return 'fallback';
}

/**
 * Classify a message into one category. Detection before weighting.
 */
function classify(g, message) {
  const kind = channelKind(g, message.channel);
  const content = message.content || '';
  const img = hasImage(message);
  const qh = quantlabHints(message);

  // Journal / comment path
  if (kind === 'journal' || message.channel?.isThread?.()) {
    const threadId = message.channel?.id;
    const meta = g.journalThreads[threadId];
    const ownerId = meta?.ownerId || message.channel?.ownerId || null;
    if (ownerId && message.author.id === ownerId) {
      return { category: 'journal', meta: { threadId, ownerId } };
    }
    if (ownerId && message.author.id !== ownerId) {
      return { category: 'comment', meta: { threadId, ownerId } };
    }
  }

  // QuantLab card
  if (img && (kind === 'trading' || kind === 'ideas' || kind === 'general' || kind === 'other')) {
    if (qh.tradeId) {
      return { category: 'quantlab_verified', meta: { tradeId: qh.tradeId, ...qh } };
    }
    if (qh.verifiedMarkers) {
      return { category: 'quantlab_unverified', meta: { ...qh } };
    }
    if (kind === 'trading' || kind === 'ideas') {
      return { category: 'chart', meta: {} };
    }
  }

  // Trade idea channel
  if (kind === 'ideas') {
    const tier = ideaQuality(message);
    if (tier === 'fallback' && !img && content.length < 40) {
      return { category: hasOnTopicSignal(content) ? 'ontopic' : 'chat', meta: { ideaTier: tier } };
    }
    return { category: 'idea', meta: { ideaTier: tier } };
  }

  // Chart in trading channel
  if (img && kind === 'trading') {
    return { category: 'chart', meta: {} };
  }

  // General chat
  if (kind === 'general' || kind === 'other' || kind === 'trading') {
    if (hasOnTopicSignal(content)) return { category: 'ontopic', meta: { symbols: extractSymbols(content).filter(isValidSymbolToken) } };
    return { category: 'chat', meta: {} };
  }

  return { category: 'chat', meta: {} };
}

/* ── Award pipeline ─────────────────────────────────────────────────────── */

function pushEvent(g, ev) {
  g.xpEvents.push(ev);
  if (g.xpEvents.length > EVENTS_MAX) g.xpEvents.splice(0, g.xpEvents.length - EVENTS_MAX);
}

async function tryApplyRoles(member, g, level) {
  if (!member?.roles) return;
  const rank = rankForLevel(level);
  for (const [lvlStr, conf] of Object.entries(g.ranks || {})) {
    const lvl = Number(lvlStr);
    const roleId = conf?.roleId;
    if (!roleId) continue;
    try {
      if (level >= lvl) {
        if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, 'QuantLab rank unlock').catch(() => {});
      }
    } catch {}
  }
  return rank;
}

function updateBadges(u, g) {
  const b = g.badges || {};
  const earned = { ...(u.badges || {}) };
  if ((u.journalStreak || 0) >= (b.consistent_journaler?.days || 14)) {
    earned.consistent_journaler = { at: Date.now() };
  } else {
    delete earned.consistent_journaler;
  }
  if ((u.chartCount || 0) >= (b.chart_analyst?.threshold || 25)) {
    earned.chart_analyst = earned.chart_analyst || { at: Date.now() };
  }
  if ((u.verifiedCount || 0) >= (b.verified_trader?.threshold || 10)) {
    earned.verified_trader = earned.verified_trader || { at: Date.now() };
  }
  if ((u.commentXp || 0) >= (b.mentor?.threshold || 200)) {
    earned.mentor = earned.mentor || { at: Date.now() };
  }
  u.badges = earned;
  return earned;
}

/**
 * Main entry: process a guild message for XP.
 */
async function handleMessage(message) {
  try {
    if (!message.guild || message.author?.bot) return null;
    const guildId = message.guild.id;
    const { all, g } = guildState(guildId);
    if (g.enabled === false) return null;

    // No-XP role
    const member = message.member;
    if (member && (g.noXpRoleIds || []).some(id => member.roles.cache.has(id))) return null;

    const { category, meta } = classify(g, message);
    const cat = catConfig(g, category);
    if (!cat) return null;

    const u = userState(g, message.author.id);
    const now = Date.now();

    // Cooldown
    if (cat.cooldownMs > 0) {
      const last = u.cooldowns[category] || 0;
      if (now - last < cat.cooldownMs) {
        return { skipped: 'cooldown', category };
      }
    }

    // Dedup QuantLab / charts
    if (category === 'quantlab_verified' || category === 'quantlab_unverified') {
      const tid = meta.tradeId;
      if (tid && u.seenTradeIds[tid]) {
        pushEvent(g, {
          id: crypto.randomBytes(8).toString('hex'),
          userId: message.author.id, category, xp: 0, reason: 'duplicate_trade',
          tradeId: tid, messageId: message.id, channelId: message.channel.id,
          createdAt: now,
        });
        saveAll(all);
        return { skipped: 'duplicate_trade', category, tradeId: tid };
      }
      if (tid) u.seenTradeIds[tid] = now;
    }

    // Idea quality scaling
    let qualityMul = 1;
    if (category === 'idea') {
      if (meta.ideaTier === 'partial') qualityMul = 0.7;
      if (meta.ideaTier === 'fallback') qualityMul = 0.4;
    }

    // Journal streak (owner only)
    let streakMul = 1;
    if (category === 'journal') {
      const dk = dayKey(now);
      if (u.lastJournalDay) {
        const prev = new Date(u.lastJournalDay + 'T12:00:00Z');
        const cur = new Date(dk + 'T12:00:00Z');
        const diff = Math.round((cur - prev) / 86400000);
        if (diff === 1) u.journalStreak = (u.journalStreak || 0) + 1;
        else if (diff > 1) u.journalStreak = 1;
        // diff === 0 → same day, keep streak
      } else {
        u.journalStreak = 1;
      }
      if (u.lastJournalDay !== dk) u.lastJournalDay = dk;
      const days = Math.min(u.journalStreak || 0, 10);
      streakMul = 1 + Math.min(0.5, days * 0.05);
    }

    // Diminishing returns
    const dim = diminishing(g, u, category, now);
    let xp = Math.round(randXp(cat) * qualityMul * streakMul * dim);

    // Daily ceiling
    const used = dailyXpUsed(u, now);
    const ceiling = g.dailyXpCeiling || 2500;
    if (used >= ceiling) return { skipped: 'daily_ceiling', category };
    if (used + xp > ceiling) xp = Math.max(0, ceiling - used);
    if (xp <= 0) return { skipped: 'zero', category };

    // Award
    u.cooldowns[category] = now;
    bumpCategoryDay(u, category, now);
    addDailyXp(u, xp, now);
    u.xp = (u.xp || 0) + xp;
    if (category === 'comment') u.commentXp = (u.commentXp || 0) + xp;
    if (category === 'chart') u.chartCount = (u.chartCount || 0) + 1;
    if (category === 'quantlab_verified') u.verifiedCount = (u.verifiedCount || 0) + 1;

    const prog = levelFromXp(u.xp, g.baseXp || 150, g.multiplier || 1.45);
    const leveled = prog.level > (u.level || 1);
    u.level = prog.level;

    updateBadges(u, g);

    pushEvent(g, {
      id: crypto.randomBytes(8).toString('hex'),
      userId: message.author.id,
      category,
      xp,
      qualityMul,
      streakMul,
      dim,
      level: u.level,
      messageId: message.id,
      channelId: message.channel.id,
      tradeId: meta.tradeId || null,
      ideaTier: meta.ideaTier || null,
      createdAt: now,
    });

    if (meta.tradeId || category.startsWith('quantlab')) {
      g.quantlabShares.push({
        userId: message.author.id,
        tradeId: meta.tradeId || null,
        verified: category === 'quantlab_verified',
        messageId: message.id,
        createdAt: now,
      });
      if (g.quantlabShares.length > 2000) g.quantlabShares.splice(0, g.quantlabShares.length - 2000);
    }

    if (leveled && member) {
      await tryApplyRoles(member, g, u.level);
    }

    saveAll(all);
    return {
      ok: true,
      category,
      xp,
      level: u.level,
      leveled,
      rank: rankForLevel(u.level),
      streak: u.journalStreak || 0,
      badges: u.badges,
    };
  } catch (err) {
    console.error('[XP]', err);
    return null;
  }
}

function handleThreadCreate(thread) {
  try {
    if (!thread?.guild) return;
    const guildId = thread.guild.id;
    const { all, g } = guildState(guildId);
    const ownerId = thread.ownerId || thread.guildMembers?.cache?.first?.()?.id;
    // Only track if parent is a configured journals forum, or no config yet (learn)
    const parentId = thread.parentId;
    const forums = g.channels?.journalsForum || [];
    const track = !forums.length || forums.includes(parentId);
    if (!track) return;
    if (!ownerId) return;
    // Skip bot/staff templates later via ignore list
    g.journalThreads[thread.id] = {
      ownerId,
      parentId,
      orphaned: false,
      createdAt: Date.now(),
    };
    saveAll(all);
  } catch (err) {
    console.error('[XP thread]', err);
  }
}

/* ── Panel / API surface ────────────────────────────────────────────────── */

function panelSnapshot(guildId, guild) {
  const { g } = guildState(guildId);
  const users = Object.entries(g.users || {}).map(([id, u]) => {
    const prog = levelFromXp(u.xp || 0, g.baseXp || 150, g.multiplier || 1.45);
    return {
      id,
      xp: u.xp || 0,
      level: prog.level,
      rank: rankForLevel(prog.level),
      badges: u.badges || {},
      journalStreak: u.journalStreak || 0,
      chartCount: u.chartCount || 0,
      verifiedCount: u.verifiedCount || 0,
      commentXp: u.commentXp || 0,
      radar: categoryRadar(g, id),
    };
  }).sort((a, b) => b.xp - a.xp);

  const now = Date.now();
  const weekAgo = now - 7 * 86400000;
  const events = g.xpEvents || [];
  const weekEvents = events.filter(e => e.createdAt >= weekAgo && e.xp > 0);
  const composition = {};
  for (const k of Object.keys(CATEGORIES)) composition[k] = 0;
  for (const e of weekEvents) composition[e.category] = (composition[e.category] || 0) + e.xp;

  const channelOpts = [];
  if (guild?.channels?.cache) {
    for (const ch of guild.channels.cache.values()) {
      if ([ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildAnnouncement].includes(ch.type)) {
        channelOpts.push({
          id: ch.id,
          name: ch.name,
          kind: ch.type === ChannelType.GuildForum ? 'forum' : 'text',
        });
      }
    }
  }

  return {
    enabled: g.enabled !== false,
    baseXp: g.baseXp || 150,
    multiplier: g.multiplier || 1.45,
    dailyXpCeiling: g.dailyXpCeiling || 2500,
    tradeMaxAgeDays: g.tradeMaxAgeDays || 7,
    weights: g.weights,
    channels: g.channels,
    channelOpts,
    ranks: g.ranks,
    rankLadder: RANKS,
    badgeDefs: BADGE_DEFS,
    badges: g.badges,
    noXpRoleIds: g.noXpRoleIds || [],
    vocabularyExtra: g.vocabularyExtra || [],
    categories: Object.values(CATEGORIES).map(c => ({
      key: c.key, label: c.label, xpMin: c.xpMin, xpMax: c.xpMax, cooldownMs: c.cooldownMs,
    })),
    composition7d: composition,
    events7d: weekEvents.length,
    totalEvents: events.length,
    leaderboard: users.slice(0, 25),
    leaderboardMonth: usersForWindow(g, monthStart()).slice(0, 25),
    topCharts: users.slice().sort((a, b) => b.chartCount - a.chartCount).slice(0, 10),
    topJournal: users.slice().sort((a, b) => b.journalStreak - a.journalStreak).slice(0, 10),
    topVerified: users.slice().sort((a, b) => b.verifiedCount - a.verifiedCount).slice(0, 10),
    topHelpers: users.slice().sort((a, b) => b.commentXp - a.commentXp).slice(0, 10),
    journalThreadCount: Object.keys(g.journalThreads || {}).length,
    configVersions: (g.configVersions || []).slice(-12),
    manualAudit: (g.manualAudit || []).slice(-30),
    recentEvents: events.slice(-40).reverse(),
  };
}

function monthStart() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function usersForWindow(g, sinceTs) {
  const xpMap = {};
  for (const e of g.xpEvents || []) {
    if (e.createdAt < sinceTs || !e.xp) continue;
    xpMap[e.userId] = (xpMap[e.userId] || 0) + e.xp;
  }
  return Object.entries(xpMap).map(([id, xp]) => {
    const u = g.users[id] || {};
    const prog = levelFromXp(xp, g.baseXp || 150, g.multiplier || 1.45);
    return {
      id, xp, level: prog.level, rank: rankForLevel(prog.level),
      journalStreak: u.journalStreak || 0,
      chartCount: u.chartCount || 0,
      verifiedCount: u.verifiedCount || 0,
      commentXp: u.commentXp || 0,
      badges: u.badges || {},
    };
  }).sort((a, b) => b.xp - a.xp);
}

function categoryRadar(g, userId) {
  const keys = Object.keys(CATEGORIES);
  const out = Object.fromEntries(keys.map(k => [k, 0]));
  for (const e of g.xpEvents || []) {
    if (e.userId === userId && e.xp) out[e.category] = (out[e.category] || 0) + e.xp;
  }
  return out;
}

function saveConfig(guildId, patch, staffId) {
  const { all, g } = guildState(guildId);
  if (patch.enabled !== undefined) g.enabled = !!patch.enabled;
  if (patch.baseXp != null) g.baseXp = Math.max(10, Math.min(100000, Number(patch.baseXp) || 150));
  if (patch.multiplier != null) g.multiplier = Math.max(1.01, Math.min(5, Number(patch.multiplier) || 1.45));
  if (patch.dailyXpCeiling != null) g.dailyXpCeiling = Math.max(100, Math.min(50000, Number(patch.dailyXpCeiling) || 2500));
  if (patch.tradeMaxAgeDays != null) g.tradeMaxAgeDays = Math.max(1, Math.min(365, Number(patch.tradeMaxAgeDays) || 7));
  if (patch.channels && typeof patch.channels === 'object') {
    g.channels = {
      general: arr(patch.channels.general),
      trading: arr(patch.channels.trading),
      tradeIdeas: arr(patch.channels.tradeIdeas),
      journalsForum: arr(patch.channels.journalsForum),
    };
  }
  if (patch.weights && typeof patch.weights === 'object') {
    for (const [k, v] of Object.entries(patch.weights)) {
      if (!CATEGORIES[k] || !v) continue;
      g.weights[k] = {
        xpMin: num(v.xpMin, CATEGORIES[k].xpMin),
        xpMax: num(v.xpMax, CATEGORIES[k].xpMax),
        cooldownMs: num(v.cooldownMs, CATEGORIES[k].cooldownMs),
      };
    }
  }
  if (Array.isArray(patch.noXpRoleIds)) g.noXpRoleIds = patch.noXpRoleIds.map(String);
  if (Array.isArray(patch.vocabularyExtra)) g.vocabularyExtra = patch.vocabularyExtra.map(String).slice(0, 200);
  if (patch.ranks && typeof patch.ranks === 'object') {
    for (const [lvl, conf] of Object.entries(patch.ranks)) {
      if (!g.ranks[lvl]) g.ranks[lvl] = {};
      if (conf.roleId !== undefined) g.ranks[lvl].roleId = conf.roleId || null;
      if (conf.label) g.ranks[lvl].label = conf.label;
    }
  }
  if (patch.badges && typeof patch.badges === 'object') {
    g.badges = { ...g.badges, ...patch.badges };
  }
  g.configVersions.push({
    at: Date.now(),
    by: staffId || null,
    weights: JSON.parse(JSON.stringify(g.weights)),
  });
  if (g.configVersions.length > 40) g.configVersions.splice(0, g.configVersions.length - 40);
  saveAll(all);
  return panelSnapshot(guildId);
}

function arr(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(String).filter(Boolean))];
}
function num(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function manualXp(guildId, { userId, amount, reason, staffId }) {
  const { all, g } = guildState(guildId);
  const u = userState(g, userId);
  const amt = Math.round(Number(amount) || 0);
  if (!amt) return { error: 'bad_amount' };
  u.xp = Math.max(0, (u.xp || 0) + amt);
  const prog = levelFromXp(u.xp, g.baseXp || 150, g.multiplier || 1.45);
  u.level = prog.level;
  pushEvent(g, {
    id: crypto.randomBytes(8).toString('hex'),
    userId, category: 'manual', xp: amt, reason: reason || 'staff',
    staffId, createdAt: Date.now(),
  });
  g.manualAudit.push({ userId, amount: amt, reason: reason || '', staffId, at: Date.now() });
  if (g.manualAudit.length > 200) g.manualAudit.splice(0, g.manualAudit.length - 200);
  saveAll(all);
  return { ok: true, xp: u.xp, level: u.level };
}

function userProfile(guildId, userId) {
  const { g } = guildState(guildId);
  const u = g.users[userId];
  if (!u) return null;
  const prog = levelFromXp(u.xp || 0, g.baseXp || 150, g.multiplier || 1.45);
  return {
    id: userId,
    xp: u.xp || 0,
    level: prog.level,
    into: prog.into,
    need: prog.need,
    rank: rankForLevel(prog.level),
    badges: u.badges || {},
    journalStreak: u.journalStreak || 0,
    radar: categoryRadar(g, userId),
    chartCount: u.chartCount || 0,
    verifiedCount: u.verifiedCount || 0,
    commentXp: u.commentXp || 0,
  };
}

module.exports = {
  CATEGORIES,
  RANKS,
  BADGE_DEFS,
  handleMessage,
  handleThreadCreate,
  panelSnapshot,
  saveConfig,
  manualXp,
  userProfile,
  levelFromXp,
  rankForLevel,
  extractSymbols,
  isValidSymbolToken,
  hasOnTopicSignal,
  guildState,
};
