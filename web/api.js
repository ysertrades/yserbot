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

const { readJson } = require('../utils/jsonStorage');
const { getLeaderboard } = require('../utils/economyManager');
const {
  getAutoModSettings, getModLogSettings, getNewsFeedSettings, getEconCalSettings,
  getModLogChannel,
} = require('../utils/modConfig');
const { listSources } = require('../utils/newsFeed');
const { stats: renderStats } = require('../utils/renderCache');
const composer = require('./composer');
const giveaways = require('./giveaways');
const settings = require('./settings');
const features = require('./features');

/** Guilds this session may open, as the picker needs them. */
function me(session, client) {
  const guilds = session.guilds
    .filter(id => client.guilds.cache.has(id))
    .map(id => {
      const g = client.guilds.cache.get(id);
      return { id: g.id, name: g.name, icon: g.iconURL({ size: 128 }), members: g.memberCount };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    user: { id: session.uid, name: session.name, avatar: session.avatar },
    expiresAt: session.exp,
    guilds,
  };
}

/** Everything the overview screen shows for one guild. */
function guildOverview(guildId, client) {
  const guild = client.guilds.cache.get(guildId);

  const newsfeed = getNewsFeedSettings(guildId);
  const econcal  = getEconCalSettings(guildId);
  const automod  = getAutoModSettings(guildId);
  const modlog   = getModLogSettings(guildId);

  const channelName = id => (id && guild.channels.cache.get(id)?.name) || null;

  // Shop items are keyed by item id rather than stored as an array — the same
  // shape commands/economy/shop.js reads.
  const shop     = readJson('shop.json', {})[guildId]?.items || {};
  const embeds   = readJson('embeds.json', {})[guildId] || {};
  const cases    = readJson('cases.json', {})[guildId] || {};
  const known    = listSources();
  const giveawayState = giveaways.list(guildId);

  return {
    guild: {
      id: guild.id,
      name: guild.name,
      icon: guild.iconURL({ size: 128 }),
      members: guild.memberCount,
      channels: guild.channels.cache.size,
    },
    newsfeed: {
      enabled: !!newsfeed.enabled,
      // Both the id and the resolved name: the id drives the picker, the name
      // is what the overview shows.
      channelId: newsfeed.channelId ?? null,
      channel: channelName(newsfeed.channelId),
      topics: newsfeed.filterTopics || [],
      // Map the stored keys onto their display names, and keep any key that
      // is no longer in the registry visible rather than silently dropping it.
      sources: (newsfeed.sources || []).map(key => ({
        key,
        label: known.find(s => s.key === key)?.label || key,
        known: known.some(s => s.key === key),
      })),
    },
    econcal: {
      enabled: !!econcal.enabled,
      channelId: econcal.channelId ?? null,
      channel: channelName(econcal.channelId),
      impact: econcal.impactFilter || [],
      currencies: econcal.currencyFilter || [],
      weeklyPost: !!econcal.weeklyPost?.enabled,
    },
    automod: {
      badWords: !!automod.badWords,
      linkFilter: !!automod.linkFilter,
      mentionSpam: !!automod.mentionSpamProtection,
      customWords: (automod.customWords || []).length,
    },
    modlog: {
      // The log channel lives at config.logsChannel, not inside modLogSettings.
      channel: getModLogChannel(guild)?.name || null,
      members: !!modlog.members,
      messages: !!modlog.messages,
      roles: !!modlog.roles,
      purges: !!modlog.purges,
    },
    // The editable fields only. Effect payloads (multipliers, durations, tier
    // definitions) are deliberately left out — those change game balance and
    // belong in /shopsettings where the command can validate them together.
    shop: Object.entries(shop).map(([id, item]) => ({
      id,
      name: item.name || id,
      description: item.description || '',
      price: Number(item.price) || 0,
      emoji: item.emoji || '',
      type: item.type || '',
    })).sort((a, b) => a.name.localeCompare(b.name)),
    // The composer, giveaways and settings screens all read from the same
    // overview call, so switching between sections never waits on the network.
    composer: composer.list(guildId),
    composerMeta: composer.meta(),
    giveaways: giveawayState,
    settings: settings.read(guildId, guild),
    features: features.read(guildId, guild),
    counts: {
      shopItems: Object.keys(shop).length,
      embedTemplates: Object.keys(embeds).length,
      moderationCases: Object.keys(cases).length,
      activeGiveaways: giveawayState.active.length,
    },
  };
}

/**
 * Top balances. Coins are global rather than per-guild in this bot, so this
 * is labelled as such in the UI — it is not a per-server ranking.
 */
async function leaderboard(client, limit = 10) {
  // Over-fetch, then drop bots and accounts Discord no longer knows, so the
  // list still reaches `limit` real people.
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

module.exports = { me, guildOverview, leaderboard, health };
