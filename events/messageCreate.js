'use strict';

const { Events, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const { createServerEmbed } = require('../utils/embedBuilder');
const { pickRandomCard, buildDropEmbed, buildClaimedEmbed, getCardConfig } = require('../utils/cardsManager');
const { isOn } = require('../utils/messageStyle');
const { isFeatureEnabled } = require('../utils/featureToggles');
const { equip } = require('../utils/badgeManager');
const { BADGE_DEFS } = require('../utils/badges');

if (!global.cardDrops)         global.cardDrops         = new Map();
if (!global.cardMessageCounts) global.cardMessageCounts = new Map();

const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;
    const guildId = message.guild?.id;
    if (!guildId) return;

    const isTicket = message.channel.topic?.startsWith('ticket-owner:') || message.channel.name?.startsWith('ticket-');
    if (isTicket) {
      const ticketCmd = client?.commands?.get('ticket');
      if (ticketCmd?.resetInactivityTimer) {
        ticketCmd.resetInactivityTimer(message.channel.id);
      }
    }

    // Admin emoji lock/unlock in the current channel
    {
      const raw = message.content.trim();
      if (raw === '\uD83D\uDD12' || raw === '\uD83D\uDD13' || raw === '🔒' || raw === '🔓') {
        const channelLock = require('../utils/channelLock');
        if (channelLock.isStaffMember(message.member)) {
          try {
            if (raw === '🔒' || raw === '\uD83D\uDD12') {
              const r = await channelLock.lockChannel(message.channel, {
                guildId,
                mode: 'chat',
                reason: 'Emoji lock',
                lockedBy: message.author.id,
                lockedByTag: message.author.tag,
              });
              if (r.ok) {
                await message.react('🔒').catch(() => {});
                await message.channel.send({ content: '🔒 Channel locked.' }).catch(() => {});
              }
            } else {
              const r = await channelLock.unlockChannel(message.channel, {
                guildId,
                unlockedByTag: message.author.tag,
              });
              if (r.ok) {
                await message.react('🔓').catch(() => {});
                await message.channel.send({ content: '🔓 Channel unlocked.' }).catch(() => {});
              }
            }
          } catch (err) {
            console.error('[emoji-lock]', err);
          }
          return;
        }
      }
    }

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

    if (isFeatureEnabled(guildId, 'leveling')) {
      try {
        const leveling = require('../utils/levelingEngine');
        if (typeof leveling.handleMessage === 'function') {
          await leveling.handleMessage(message);
        } else if (typeof leveling.processMessage === 'function') {
          await leveling.processMessage(message);
        }
      } catch (err) {
        console.error('[XP message]', err);
      }
    }

    if (isFeatureEnabled(guildId, 'autoreply')) await handleAutoReply(message);
    if (isFeatureEnabled(guildId, 'cards')) await handleCardDrop(message);
  },
};

async function handleCardDrop(message) {
  const guildId = message.guild.id;
  const cfg = getCardConfig(guildId);
  if (!cfg || !cfg.enabled) return;
  const channelId = message.channel.id;
  if (Array.isArray(cfg.channels) && cfg.channels.length && !cfg.channels.includes(channelId)) return;
  if (Array.isArray(cfg.denyChannels) && cfg.denyChannels.includes(channelId)) return;

  const key = `${guildId}:${channelId}`;
  const count = (global.cardMessageCounts.get(key) || 0) + 1;
  global.cardMessageCounts.set(key, count);
  const every = Math.max(1, Number(cfg.everyN) || 50);
  if (count % every !== 0) return;

  const card = pickRandomCard(guildId);
  if (!card) return;
  const dropId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  global.cardDrops.set(dropId, { guildId, card, claimedBy: null, at: Date.now() });

  const embed = buildDropEmbed(message.guild, card);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`cardclaim:${dropId}`).setLabel('Claim').setStyle(ButtonStyle.Success)
  );
  try {
    await message.channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('[CARD DROP]', err);
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
