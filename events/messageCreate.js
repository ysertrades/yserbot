'use strict';

const { Events, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const { createServerEmbed } = require('../utils/embedBuilder');
const { pickRandomCard, buildDropEmbed, buildClaimedEmbed, getCardConfig } = require('../utils/cardsManager');
const { isOn } = require('../utils/messageStyle');
const { isFeatureEnabled } = require('../utils/featureToggles');
const { equip } = require('../utils/badgeManager');
const { BADGE_DEFS } = require('../utils/badges');
const levelingEngine = require('../utils/levelingEngine');

if (!global.cardDrops)         global.cardDrops         = new Map();
if (!global.cardMessageCounts) global.cardMessageCounts = new Map();

const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;
    const guildId = message.guild?.id;
    if (!guildId) return;

    const content = message.content.trim();
    if (content.toLowerCase().startsWith('g.reroll')) {
      const parts  = content.split(/\s+/);
      const shortId = parts[1] || '';
      const { reroll } = require('../commands/utility/giveaway');
      try { await reroll(message, shortId); } catch (err) { console.error('[REROLL]', err); }
      return;
    }

    const handled = isFeatureEnabled(guildId, 'automod')
      && await client?.commands?.get('automod')?.handleMessage(message, client).catch(() => false);
    if (handled) return;

    if (isFeatureEnabled(guildId, 'leveling')) await handleLeveling(message);
    if (isFeatureEnabled(guildId, 'autoreply')) await handleAutoReply(message);
    if (isFeatureEnabled(guildId, 'cards')) await handleCardDrop(message);
  },
};

const _levelQueues = new Map();
function withLevelLock(guildId, fn) {
  const prev = _levelQueues.get(guildId) || Promise.resolve();
  const next = prev.then(fn, fn);
  _levelQueues.set(guildId, next.catch(() => {}));
  return next;
}

async function handleLeveling(message) {
  return withLevelLock(message.guild.id, () => _handleLevelingBody(message));
}

async function _handleLevelingBody(message) {
  const result = await levelingEngine.processMessage(message);
  if (!result || !result.ok) return;

  const levels = levelingEngine.loadAll();
  const guildData = levels[message.guild.id];
  if (!guildData) return;

  const userId = message.author.id;
  const user = guildData.users[userId];
  if (!user) return;

  const levelsGained = result.levelsGained || [];
  if (!levelsGained.length) return;

  for (const newLevel of levelsGained) {
    const levelRoles = guildData.roles || {};
    const roleId = levelRoles[newLevel];
    if (roleId) {
      const role = message.guild.roles.cache.get(roleId);
      if (role) { try { await message.member.roles.add(role); } catch {} }
    }

    const levelBadges = guildData.badges || {};
    const badgeId = levelBadges[newLevel];
    let awardedBadge = null;
    if (badgeId && BADGE_DEFS[badgeId]) {
      try {
        const r = equip(userId, message.guild.id, badgeId);
        if (r?.ok && !r.already) awardedBadge = BADGE_DEFS[badgeId];
      } catch {}
    }

    if (isOn(message.guild.id, 'member.levelup')) {
      const src = result.type && result.type !== 'legacy'
        ? String(result.type).replace(/_/g, ' ')
        : null;
      const lines = [
        '-# quantlab \u00b7 level up',
        `**${message.member?.displayName || message.author.username}** just reached **level ${newLevel}.**`,
      ];
      if (src) lines.push(`-# source \u00b7 ${src}`);
      if (awardedBadge) lines.push(`-# ${awardedBadge.emoji} new badge equipped \u2014 ${awardedBadge.label}`);
      lines.push(`-# ${(user.totalXp || 0).toLocaleString()} xp total`);
      try { await message.channel.send({ content: lines.join('\n') }); } catch {}
    }
  }
}

async function handleAutoReply(message) {
  const isAdmin = message.member?.permissions?.has(PermissionFlagsBits.Administrator);
  if (!isAdmin) return;

  const autoreplies  = readJson('autoreplies.json', {});
  const guildReplies = autoreplies[message.guild.id] || {};

  for (const [name, data] of Object.entries(guildReplies)) {
    if (!data.enabled) continue;
    const content = message.content;
    const match   = data.exact
      ? content.toLowerCase() === data.trigger.toLowerCase()
      : content.toLowerCase().includes(data.trigger.toLowerCase());
    if (!match) continue;

    const key        = `${message.guild.id}-${name}`;
    const lastUsed   = cooldowns.get(key) || 0;
    const cooldownMs = (data.cooldown || 5) * 1000;
    if (Date.now() - lastUsed < cooldownMs) continue;

    cooldowns.set(key, Date.now());

    const { buildEmbedPayload } = require('../commands/utility/embed');
    const payload = buildEmbedPayload(message.guild, data.embedName);
    if (!payload) continue;

    try { await message.reply({ embeds: payload.embeds, files: payload.files, components: payload.components }); } catch {}
    break;
  }
}

async function handleCardDrop(message) {
  try {
    const guildId = message.guild.id;
    const cfg = getCardConfig(guildId);
    if (cfg.channelId && cfg.channelId !== message.channel.id) return;
    const key   = `${guildId}:${message.channel.id}`;
    const count = (global.cardMessageCounts.get(key) || 0) + 1;
    global.cardMessageCounts.set(key, count);
    const every = cfg.every || 50;
    if (count % every !== 0) return;
    const card = pickRandomCard(guildId);
    if (!card) return;
    const dropId = `${guildId}-${Date.now()}`;
    global.cardDrops.set(dropId, { card, guildId, claimed: false });
    const payload = buildDropEmbed(card, dropId);
    await message.channel.send(payload);
  } catch (err) {
    console.error('[CardDrop]', err);
  }
}
