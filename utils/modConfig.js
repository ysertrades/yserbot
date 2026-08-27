'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { readJson, writeJson } = require('./jsonStorage');

const AUTOMOD_DEFAULTS  = { badWords: false, linkFilter: false, customWords: [], mentionSpamProtection: false, mentionSpamRuleId: null };
const MODLOG_DEFAULTS   = { members: true, messages: true, roles: true, purges: true };
// `sources` defaults to Financial Juice alone so existing servers keep exactly
// the feed they already had; `lastGuids` is the per-source read cursor that
// replaces the single `lastGuid` (kept for backward compatibility).
const NEWSFEED_DEFAULTS = {
  enabled: false, channelId: null, lastGuid: null, filterTopics: [],
  sources: ['financialjuice'], lastGuids: {},
};
const ECONCAL_DEFAULTS  = {
  enabled: false, channelId: null, roleId: null,
  impactFilter: [], currencyFilter: [], // empty = everything
  weeklyPost: { enabled: false, weekday: 1, hour: 0, minute: 0, offsetMinutes: 0 }, // weekday: 0=Sun..6=Sat
  lastWeeklyPostAt: null,
  firedKeys: [], // dedupes reminder/release sends across runner ticks
};

function getGuildConfig(guildId) {
  const config = readJson('config.json', {});
  if (!config[guildId]) config[guildId] = {};
  return config;
}

function getAutoModSettings(guildId) {
  const config = readJson('config.json', {});
  return { ...AUTOMOD_DEFAULTS, ...(config[guildId]?.autoModSettings || {}) };
}

function setAutoModSettings(guildId, patch) {
  const config = getGuildConfig(guildId);
  config[guildId].autoModSettings = { ...AUTOMOD_DEFAULTS, ...(config[guildId].autoModSettings || {}), ...patch };
  writeJson('config.json', config);
  return config[guildId].autoModSettings;
}

function getModLogSettings(guildId) {
  const config = readJson('config.json', {});
  return { ...MODLOG_DEFAULTS, ...(config[guildId]?.modLogSettings || {}) };
}

function setModLogSettings(guildId, patch) {
  const config = getGuildConfig(guildId);
  config[guildId].modLogSettings = { ...MODLOG_DEFAULTS, ...(config[guildId].modLogSettings || {}), ...patch };
  writeJson('config.json', config);
  return config[guildId].modLogSettings;
}

/**
 * The registry lives in newsFeed.js. Required lazily and guarded, so this
 * cannot create a load-order problem or a require cycle — and if it ever
 * fails, the stored list is returned untouched rather than emptied.
 */
function knownSourceKeys() {
  try { return require('./newsFeed').listSources().map(s => s.key); }
  catch { return null; }
}

function getNewsFeedSettings(guildId) {
  const config = readJson('config.json', {});
  const settings = { ...NEWSFEED_DEFAULTS, ...(config[guildId]?.newsFeedSettings || {}) };

  // Drop sources that no longer exist. Removing one from the registry used to
  // leave it sitting in every guild that had selected it — visible in the
  // panels, and quietly skipped by the runner. Filtering on read means it
  // disappears everywhere at once, and the next save writes the clean list.
  const known = knownSourceKeys();
  if (known) {
    const kept = (settings.sources || []).filter(key => known.includes(key));
    // Never hand back an empty list: a feed with no sources silently stops.
    settings.sources = kept.length ? kept : [...NEWSFEED_DEFAULTS.sources];
  }
  return settings;
}

function setNewsFeedSettings(guildId, patch) {
  const config = getGuildConfig(guildId);
  config[guildId].newsFeedSettings = { ...NEWSFEED_DEFAULTS, ...(config[guildId].newsFeedSettings || {}), ...patch };
  writeJson('config.json', config);
  return config[guildId].newsFeedSettings;
}

function getEconCalSettings(guildId) {
  const config   = readJson('config.json', {});
  const stored   = config[guildId]?.econCalSettings || {};
  return { ...ECONCAL_DEFAULTS, ...stored, weeklyPost: { ...ECONCAL_DEFAULTS.weeklyPost, ...(stored.weeklyPost || {}) } };
}

function setEconCalSettings(guildId, patch) {
  const config  = getGuildConfig(guildId);
  const current = getEconCalSettings(guildId);
  config[guildId].econCalSettings = { ...current, ...patch, weeklyPost: { ...current.weeklyPost, ...(patch.weeklyPost || {}) } };
  writeJson('config.json', config);
  return config[guildId].econCalSettings;
}

/**
 * Which kinds of control-panel action get written to the mod log.
 *
 * Defaults to on for everything: the log is what makes handing the panel out
 * safe, so silence has to be chosen deliberately rather than arrived at.
 * Coin movements are deliberately absent — an economy change that leaves no
 * trace is the one thing worth keeping unconditional.
 */
const PANEL_LOG_CATEGORIES = {
  feeds:      { label: 'News feed and calendar' },
  moderation: { label: 'Moderation and filters' },
  shop:       { label: 'Shop items' },
  composer:   { label: 'Messages, buttons and posting' },
  giveaways:  { label: 'Giveaways and lottery' },
  settings:   { label: 'Server settings' },
  features:   { label: 'Feature settings and levelling' },
  studio:     { label: 'Studio banner wording' },
  appearance: { label: 'Bot message wording and colour' },
  social:     { label: 'Social accounts' },
  tickets:    { label: 'Tickets' },
  automation: { label: 'Schedules and auto-replies' },
};

function getPanelLogSettings(guildId) {
  const stored = readJson('config.json', {})[guildId]?.panelLogSettings || {};
  const out = {};
  for (const key of Object.keys(PANEL_LOG_CATEGORIES)) out[key] = stored[key] !== false;
  return out;
}

function setPanelLogSettings(guildId, next) {
  const config = getGuildConfig(guildId);
  config[guildId].panelLogSettings = next;
  writeJson('config.json', config);
  return next;
}

function getModLogChannel(guild) {
  const config    = readJson('config.json', {});
  const channelId = config[guild.id]?.logsChannel;
  if (!channelId) return null;
  return guild.channels.cache.get(channelId) || null;
}

// Reuses the same moderator-role list as `/cmd mod-role` (config.cmdSetup.modRoles)
// rather than introducing a second, separate role list — a real server
// Administrator always bypasses too, same as everywhere else in the bot.
function isAutoModExempt(member) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const config    = readJson('config.json', {});
  const modRoles  = config[member.guild.id]?.cmdSetup?.modRoles || [];
  return modRoles.length > 0 && modRoles.some(id => member.roles.cache.has(id));
}

module.exports = {
  AUTOMOD_DEFAULTS, MODLOG_DEFAULTS, NEWSFEED_DEFAULTS, ECONCAL_DEFAULTS,
  getAutoModSettings, setAutoModSettings,
  getModLogSettings, setModLogSettings,
  getNewsFeedSettings, setNewsFeedSettings,
  getEconCalSettings, setEconCalSettings,
  getModLogChannel, isAutoModExempt,
  PANEL_LOG_CATEGORIES, getPanelLogSettings, setPanelLogSettings,
};
