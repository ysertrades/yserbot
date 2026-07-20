'use strict';

const { Events, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const { createServerEmbed } = require('../utils/embedBuilder');
const { pickRandomCard, buildDropEmbed, buildClaimedEmbed } = require('../utils/cardsManager');

if (!global.cardDrops)         global.cardDrops         = new Map();
if (!global.cardMessageCounts) global.cardMessageCounts = new Map(); // key: "guildId:channelId"

const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;
    const guildId = message.guild?.id;
    if (!guildId) return;

    // ── Ticket inactivity reset ───────────────────────────────────────────
    const isTicket = message.channel.topic?.startsWith('ticket-owner:') || message.channel.name?.startsWith('ticket-');
    if (isTicket) {
      const ticketCmd = client?.commands?.get('ticket');
      if (ticketCmd?.resetInactivityTimer) {
        ticketCmd.resetInactivityTimer(message.channel.id);
      }
    }

    // ── g.reroll <id> prefix command ─────────────────────────────────────
    const content = message.content.trim();
    if (content.toLowerCase().startsWith('g.reroll')) {
      const parts  = content.split(/\s+/);
      const shortId = parts[1] || '';
      const { reroll } = require('../commands/utility/giveaway');
      try { await reroll(message, shortId); } catch (err) { console.error('[REROLL]', err); }
      return;
    }

    await handleLeveling(message);
    await handleAutoReply(message);
    await handleCardDrop(message);
  },
};

async function handleLeveling(message) {
  const levels    = readJson('levels.json', {});
  const guildData = levels[message.guild.id] || { users: {}, roles: {}, settings: { xpPerMessage: [15, 25], baseXp: 100, multiplier: 1.5 } };
  const userId    = message.author.id;

  if (!guildData.users[userId]) {
    guildData.users[userId] = { xp: 0, level: 1, messages: 0, lastMessage: 0, totalXp: 0 };
  }

  const now        = Date.now();
  const cooldownMs = 20000;
  if (now - guildData.users[userId].lastMessage < cooldownMs) return;

  guildData.users[userId].lastMessage = now;
  guildData.users[userId].messages   += 1;

  const settings  = guildData.settings || { xpPerMessage: [15, 25], baseXp: 100, multiplier: 1.5 };
  const minXp     = settings.xpPerMessage[0] || 15;
  const maxXp     = settings.xpPerMessage[1] || 25;
  const xpGain    = Math.floor(Math.random() * (maxXp - minXp + 1)) + minXp;
  guildData.users[userId].xp      += xpGain;
  guildData.users[userId].totalXp += xpGain;

  const baseXp     = settings.baseXp || 100;
  const multiplier = settings.multiplier || 1.5;
  const neededXp   = Math.floor(baseXp * Math.pow(guildData.users[userId].level, multiplier));

  if (guildData.users[userId].xp >= neededXp) {
    guildData.users[userId].level += 1;
    guildData.users[userId].xp    = 0;

    const levelRoles = guildData.roles || {};
    const roleId     = levelRoles[guildData.users[userId].level];
    if (roleId) {
      const role = message.guild.roles.cache.get(roleId);
      if (role) { try { await message.member.roles.add(role); } catch {} }
    }

    try {
      const embed = createServerEmbed('success', {
        title: '🎉 Level Up!',
        description: `${message.author} reached **Level ${guildData.users[userId].level}**!`,
        fields: [
          { name: 'Total XP',  value: `${guildData.users[userId].totalXp}`, inline: true },
          { name: 'Messages',  value: `${guildData.users[userId].messages}`, inline: true },
        ],
      }, message.guild);
      await message.channel.send({ embeds: [embed] });
    } catch {}
  }

  levels[message.guild.id] = guildData;
  writeJson('levels.json', levels);
}

async function handleCardDrop(message) {
  try {
    const config   = readJson('cards_config.json', {});
    const cfg      = config[message.guild.id];
    const interval = cfg?.interval || 50;

    // Increment per-channel counter
    const key   = `${message.guild.id}:${message.channel.id}`;
    const count = (global.cardMessageCounts.get(key) || 0) + 1;

    if (count < interval) {
      global.cardMessageCounts.set(key, count);
      return;
    }

    // Hit the threshold — reset and drop a card
    global.cardMessageCounts.set(key, 0);

    const card  = pickRandomCard();
    const embed = buildDropEmbed(card);
    const row   = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('card_grab').setLabel('🃏 Grab Card!').setStyle(ButtonStyle.Secondary),
    );

    const msg = await message.channel.send({ embeds: [embed], components: [row] });
    global.cardDrops.set(msg.id, { card, grabbed: false, guildId: message.guild.id });

    // Expire after 8 seconds
    setTimeout(async () => {
      const drop = global.cardDrops.get(msg.id);
      if (!drop || drop.grabbed) return;
      global.cardDrops.delete(msg.id);
      const expiredEmbed = buildDropEmbed(card, true);
      const disabled = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('card_gone').setLabel('💨 Nobody grabbed it...').setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
      await msg.edit({ embeds: [expiredEmbed], components: [disabled] }).catch(() => {});
    }, 8000);
  } catch (err) {
    console.error('[CARD DROP]', err);
  }
}

async function handleAutoReply(message) {
  // ── Admin-only: only admins trigger auto-replies ──────────────────────
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

    // Use buildEmbedPayload so buttons attached to the template are included
    const { buildEmbedPayload } = require('../commands/utility/embed');
    const payload = buildEmbedPayload(message.guild, data.embedName);
    if (!payload) continue;

    try { await message.reply({ embeds: payload.embeds, components: payload.components }); } catch {}
    break;
  }
}
