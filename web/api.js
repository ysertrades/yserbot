'use strict';

/**
 * web/api.js
 *
 * Read-only endpoints for the control panel.
 *
 * Everything here goes through the same helpers the slash commands use
 * (modConfig, economyManager, jsonStorage), never through Mongo directly.
 * That matters more than it looks: storage is an in-memory cache warmed once
 * at boot, so reading around those helpers would eventually hand back
 * something the bot itself doesn't believe.
 */

const { ChannelType } = require('discord.js');
const auth = require('./auth');
const { readJson } = require('../utils/jsonStorage');
const { getLeaderboard } = require('../utils/economyManager');
const { isFeatureEnabled } = require('../utils/featureToggles');
const {
  getAutoModSettings, getModLogSettings, getNewsFeedSettings, getEconCalSettings,
  getModLogChannel, PANEL_LOG_CATEGORIES: LOG_CATEGORIES, getPanelLogSettings: panelLogSettings,
} = require('../utils/modConfig');
const { listSources } = require('../utils/newsFeed');
const { TOPICS } = require('../utils/newsTopics');
const { allBannerCopy } = require('../utils/bannerCopy');
const { IMPACT_LEVELS, CURRENCIES } = require('../utils/economicCalendar');
const { stats: renderStats } = require('../utils/renderCache');
const composer = require('./composer');
const giveaways = require('./giveaways');
const settings = require('./settings');
const features = require('./features');
const featureToggles = require('./featureToggles');
const tickets = require('./tickets');
const pollsPanel = require('./polls');
const casino = require('./casino');
const economyPanel = require('./economy');
const links = require('./links');
const moderation = require('./moderation');
const appearance = require('./appearance');
const whopPanel = require('./whop');
const cardsPanel = require('./cards');
const botProfile = require('./botProfile');

function me(session, client) {
  const owner = auth.isOwner(session.uid);
  const ids = new Set([...(session.guilds || []), ...auth.staffGuildsFor(session.uid)]);
  if (owner) for (const id of client.guilds.cache.keys()) ids.add(id);

  const guilds = [...ids]
    .filter(id => client.guilds.cache.has(id))
    .map(id => {
      const g = client.guilds.cache.get(id);
      return { id: g.id, name: g.name, icon: g.iconURL({ size: 128, extension: 'png', forceStatic: true }) || null, members: g.memberCount };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    user: { id: session.uid, name: session.name, avatar: session.avatar },
    expiresAt: session.exp,
    guilds,
    isOwner: owner,
  };
}

const memberFetchedAt = new Map();
const MEMBER_TTL_MS = 5 * 60 * 1000;

async function ensureMembers(guild) {
  if (typeof guild?.members?.fetch !== 'function') return;
  if (Date.now() - (memberFetchedAt.get(guild.id) || 0) < MEMBER_TTL_MS) return;
  memberFetchedAt.set(guild.id, Date.now());
  try {
    await guild.members.fetch({ time: 20_000 });
  } catch (err) {
    console.warn('[Panel] could not fetch the member list:', err.message);
  }
}

/** Everything the overview screen shows for one guild. */
async function guildOverview(guildId, client, session = null, opts = {}) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    const err = new Error('guild_not_found');
    err.code = 'guild_not_found';
    throw err;
  }
  if (!opts.skipMembers) await ensureMembers(guild);

  const newsfeed = getNewsFeedSettings(guildId);
  const econcal  = getEconCalSettings(guildId);
  const automod  = getAutoModSettings(guildId);
  const modlog   = getModLogSettings(guildId);

  const channelName = id => (id && guild.channels.cache.get(id)?.name) || null;

  const shop     = readJson('shop.json', {})[guildId]?.items || {};
  const embeds   = readJson('embeds.json', {})[guildId] || {};
  const casesRaw = readJson('cases.json', {})[guildId] || [];
  const casesList = Array.isArray(casesRaw) ? casesRaw : Object.values(casesRaw || {});
  const known    = listSources();
  const giveawayState = giveaways.list(guildId, guild);

  return {
    guild: {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ size: 128, extension: 'png', forceStatic: true }) || null,
      members: guild.memberCount,
      channels: guild.channels.cache.filter(c => !c.isThread?.() && c.type !== ChannelType.GuildCategory).size,
      categories: guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size,
    },
    newsfeed: {
      enabled: !!newsfeed.enabled,
      channelId: newsfeed.channelId ?? null,
      channel: channelName(newsfeed.channelId),
      topics: newsfeed.filterTopics || [],
      topicOptions: TOPICS.map(t => ({
        value: t.key,
        label: `${t.emoji} ${t.label}`,
        hint: t.description,
      })),
      sources: (newsfeed.sources || []).map(key => ({
        key,
        label: (known.find(s => s.key === key) || {}).label || key,
      })),
      sourceOptions: known.map(s => ({ value: s.key, label: s.label })),
    },
    econcal: {
      enabled: !!econcal.enabled,
      channelId: econcal.channelId ?? null,
      channel: channelName(econcal.channelId),
      roleId: econcal.roleId ?? null,
      impact: econcal.impactFilter || [],
      currencies: econcal.currencyFilter || [],
      // Aliases the Feeds tab still reads
      impactLevels: [...IMPACT_LEVELS],
      currencyCodes: [...CURRENCIES],
      impactOptions: [...IMPACT_LEVELS],
      currencyOptions: [...CURRENCIES],
      weekly: {
        enabled: !!(econcal.weeklyPost && econcal.weeklyPost.enabled),
        weekday: (econcal.weeklyPost && econcal.weeklyPost.weekday) ?? 1,
        hour: (econcal.weeklyPost && econcal.weeklyPost.hour) ?? 0,
        minute: (econcal.weeklyPost && econcal.weeklyPost.minute) ?? 0,
        offsetMinutes: (econcal.weeklyPost && econcal.weeklyPost.offsetMinutes) ?? 0,
      },
      weeklyChannelId: econcal.weeklyChannelId ?? null,
      weeklyChannel: channelName(econcal.weeklyChannelId),
      postHour: econcal.postHour ?? 8,
      postMinute: econcal.postMinute ?? 0,
    },
    automod: {
      badWords: !!automod.badWords,
      linkFilter: !!automod.linkFilter,
      mentionSpam: !!automod.mentionSpamProtection,
      customWords: (automod.customWords || []).length,
    },
    modlog: {
      channelId: modlog.channelId ?? getModLogChannel(guildId) ?? null,
      channel: channelName(modlog.channelId || getModLogChannel(guildId)),
      members: !!modlog.members,
      messages: !!modlog.messages,
      roles: !!modlog.roles,
      purges: !!modlog.purges,
    },
    giveaways: giveawayState,
    settings: settings.read(guildId, guild, { ownerOnly: !!session && auth.isOwner(session.uid) }),
    features: features.read(guildId, guild),
    featureToggles: featureToggles.read(guildId),
    tickets: tickets.read(guildId, guild),
    polls: pollsPanel.read(guildId, guild),
    casino: casino.read(guildId),
    economy: economyPanel.read(guildId),
    cards: cardsPanel.read(guildId, guild),
    links: links.read(guildId, guild),
    mod: (function () { try { return moderation.read(guildId, guild); } catch (e) { console.warn('[api] mod read', e.message); return { reports: { open: [], handled: [] }, cases: [], caseTotal: 0, warned: [], filters: {}, lockedChannels: [], lockModes: [], roles: [] }; } })(),
    appearance: appearance.read(guildId),
    whop: whopPanel.read(guildId, guild),
    botProfile: session ? botProfile.read(guildId, client, session) : null,
    panelLog: {
      categories: Object.entries(LOG_CATEGORIES).map(([key, c]) => ({ key, label: c.label })),
      values: panelLogSettings(guildId),
    },
    panelLogCategories: LOG_CATEGORIES,
    bannerCopy: allBannerCopy(guildId),
    composer: await composer.list(guildId, guild),
    composerMeta: composer.meta(),
    counts: {
      shopItems: Object.keys(shop).length,
      embedTemplates: Object.keys(embeds).length,
      moderationCases: casesList.filter(c => c && !(c.type === 'warn' && c.clearedAt)).length,
      activeGiveaways: giveawayState.active.length,
    },
  };
}

async function leaderboard(client, limit = 10, guildId = null) {
  if (guildId && !isFeatureEnabled(guildId, 'economy')) {
    return { scope: 'global', entries: [], economyOff: true };
  }

  const candidates = getLeaderboard(limit * 3);
  const rows = [];

  for (const entry of candidates) {
    if (rows.length >= limit) break;
    const user = client.users.cache.get(entry.userId)
      ?? await client.users.fetch(entry.userId).catch(() => null);
    if (!user || user.bot) continue;
    rows.push({
      id: user.id,
      name: user.globalName || user.username,
      avatar: user.displayAvatarURL({ size: 64 }),
      balance: entry.balance,
    });
  }

  return { scope: 'global', entries: rows };
}

function health(client) {
  const renders = renderStats();
  const saved = renders.reduce((ms, r) => ms + (r.misses ? (r.ms / r.misses) * r.hits : 0), 0);
  return {
    uptimeMs: Math.round(process.uptime() * 1000),
    guilds: client.guilds.cache.size,
    ping: Math.round(client.ws.ping),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    renderCache: {
      hits: renders.reduce((n, r) => n + r.hits, 0),
      misses: renders.reduce((n, r) => n + r.misses, 0),
      blockingMsAvoided: Math.round(saved),
    },
  };
}

module.exports = { me, guildOverview, leaderboard, health, ensureMembers };
