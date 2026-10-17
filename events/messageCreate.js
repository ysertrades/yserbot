'use strict';

const { Events, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const { createServerEmbed } = require('../utils/embedBuilder');
const { isOn } = require('../utils/messageStyle');
const { isFeatureEnabled } = require('../utils/featureToggles');
const { equip } = require('../utils/badgeManager');
const { BADGE_DEFS } = require('../utils/badges');

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
        ticketCmd.resetInactivityTimer(message.channel.id, message.channel);
      }
    }

    // Admin emoji lock/unlock — 🔒 / 🔓 alone in the channel
    {
      const raw = message.content.trim();
      if (raw === '\uD83D\uDD12' || raw === '\uD83D\uDD13' || raw === '🔒' || raw === '🔓') {
        const channelLock = require('../utils/channelLock');
        let member = message.member;
        if (!member && message.guild) {
          member = await message.guild.members.fetch(message.author.id).catch(() => null);
        }
        if (channelLock.isStaffMember(member)) {
          try {
            if (raw === '🔒' || raw === '\uD83D\uDD12') {
              const r = await channelLock.lockChannel(message.channel, {
                guildId,
                mode: 'media',
                reason: 'Emoji lock',
                lockedBy: message.author.id,
                lockedByTag: message.author.tag,
                announce: false,
              });
              if (r.ok) {
                await message.react('🔒').catch(() => {});
                await message.channel.send({ content: '🔒 **Locked**' }).catch(() => {});
              } else if (r.error === 'already_locked') {
                await message.react('🔒').catch(() => {});
              } else {
                await message.reply({ content: `Could not lock: ${r.detail || r.error}` }).catch(() => {});
              }
            } else {
              const r = await channelLock.unlockChannel(message.channel, {
                guildId,
                unlockedByTag: message.author.tag,
                announce: false,
              });
              if (r.ok) {
                await message.react('🔓').catch(() => {});
                await message.channel.send({ content: '🔓 **Unlocked** — chat is open again.' }).catch(() => {});
              } else if (r.error === 'not_locked') {
                await message.reply({ content: 'This channel is not locked.' }).catch(() => {});
              } else {
                await message.reply({ content: `Could not unlock: ${r.detail || r.error}` }).catch(() => {});
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
  },
};

async function handleAutoReply(message) {
  // Auto-replies answer everybody. This used to return for anyone who was not
  // an Administrator, so the members they exist for never got one. Abuse is
  // held off by each reply's cooldown below.
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

    const { buildEmbedPayload, toMessageOptions } = require('../commands/utility/embed');
    const payload = buildEmbedPayload(message.guild, data.embedName, { user: message.author, channel: message.channel });
    if (!payload) continue;

    try { await message.reply(toMessageOptions(payload, { allowedMentions: { parse: [], repliedUser: false } })); } catch {}
    break;
  }
}
