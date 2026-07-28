'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { readJson, writeJson } = require('./jsonStorage');

const AUTOMOD_DEFAULTS = { badWords: false, linkFilter: false, customWords: [] };
const MODLOG_DEFAULTS  = { members: true, messages: true, roles: true, purges: true };

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
  AUTOMOD_DEFAULTS, MODLOG_DEFAULTS,
  getAutoModSettings, setAutoModSettings,
  getModLogSettings, setModLogSettings,
  getModLogChannel, isAutoModExempt,
};
