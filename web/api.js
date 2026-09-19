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

/**
 * Guilds this session may open, as the picker expects them.
 */
function me(session, client) {
  return {
    user: { id: session.uid, name: session.name, avatar: session.avatar },
    guilds: auth.accessibleGuilds(session, client).map(g => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 64, extension: 'png', forceStatic: true }) || null,
    })),
    isOwner: auth.isOwner(session.uid),
  };
}

/**
 * Cache member fetches so large guilds don't re-pull on every overview tick.
 */
const memberFetchedAt = new Map();
const MEMBER_TTL_MS = 5 * 60 * 1000;

async function ensureMembers(guild) {
  if (typeof guild?.members?.fetch !== 'function') return;
  if (Date.now() - (memberFetchedAt.get(guild.id) || 0) < MEMBER_TTL_MS) return;
  memberFetchedAt.set(guild.id, Date.now());
  try {
    await guild.members.fetch({ time: 20_000 });
  } catch (err) {
    // A timeout or a missing intent must not take the overview down with it.
    console.warn('[Panel] could not fetch the member list:', err.message);
  }
}

/** Everything the overview screen shows for one guild. */
async function guildOverview(guildId, client, session = null, opts = {}) {
  const guild = client.guilds.cache.get(guildId);
  // Bot-profile saves must not wait on a full member fetch — that is what
  // made "Save global profile" look frozen on larger servers.
  if (!opts.skipMembers) await ensureMembers(guild);

  const newsfeed = getNewsFeedSettings(guildId);
  const econcal  = getEconCalSettings(guildId);
  const automod  = getAutoModSettings(guildId);
  const modlog   = getModLogSettings(guildId);

  const channelName = id => (id && guild.channels.cache.get(id)?.name) || null;

  // Shop items are keyed by item id rather than stored as an array — the same
  // shape commands/economy/shop.js reads.
  const shop     = readJson('shop.json', {})[guildId]?.items || {};
  const embeds   = readJson('embeds.json', {})[guildId] || {};
  // cases.json stores an array per guild (see utils/modActions). Object.keys
  // on an array counts indices, which is fine, but cleared warnings must not
  // inflate the tile — match moderation.read's caseTotal filter.
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
      // Not cache.size — that counts categories and every open thread too, so
      // it reads far higher than the channel list you actually see.
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
    },
    econcal: {
      enabled: !!econcal.enabled,
      channelId: econcal.channelId ?? null,
      channel: channelName(econcal.channelId),
      impact: econcal.filterImpact || [],
      currencies: econcal.filterCurrency || [],
      impactOptions: IMPACT_LEVELS.slice(),
      currencyOptions: CURRENCIES.slice(),
    },
    automod: {
      badWords: !!automod.badWords,
      linkFilter: !!automod.linkFilter,
      mentionSpam: !!automod.mentionSpamProtection,
      customWords: (automod.customWords || []).length,
    },
    modlog: {
      channelId: modlog.channelId ?? null,
      channel: channelName(modlog.channelId),
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
    mod: moderation.read(guildId, guild),
    appearance: appearance.read(guildId),
    whop: whopPanel.read(guildId, guild),
    botProfile: session ? botProfile.read(guildId, client, session) : null,
    counts: {
      shopItems: Object.keys(shop).length,
      embedTemplates: Object.keys(embeds).length,
      moderationCases: casesList.filter(c => c && !(c.type === 'warn' && c.clearedAt)).length,
      activeGiveaways: giveawayState.active.length,
    },
  };
}

/**
 * Top balances. Coins are global rather than per-guild in this bot, so this
 * is labelled as such in the UI — it is not a per-server ranking.
 */
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

/** Bot health, including what the render cache has saved. */
function health(client) {
  const rs = renderStats();
  return {
    uptime: process.uptime(),
    ping: client.ws.ping,
    guilds: client.guilds.cache.size,
    users: client.users.cache.size,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    renderCache: rs,
  };
}

module.exports = { me, guildOverview, leaderboard, health, ensureMembers };
