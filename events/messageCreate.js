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
if (!global.cardMessageCounts) global.cardMessageCounts = new Map(); // key: "guildId:channelId"

const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;
    const guildId = message.guild?.id;
    if (!guildId) return;


    // ── g.reroll <id> prefix command ─────────────────────────────────────
    const content = message.content.trim();
    if (content.toLowerCase().startsWith('g.reroll')) {
      const parts  = content.split(/\s+/);
      const shortId = parts[1] || '';
      const { reroll } = require('../commands/utility/giveaway');
      try { await reroll(message, shortId); } catch (err) { console.error('[REROLL]', err); }
      return;
    }

    // ── Auto-mod (bad-word / link filter) ─────────────────────────────────
    // Runs before XP/cards/autoreply — a filtered message shouldn't earn XP,
    // drop a card, or trigger an autoreply.
    const handled = isFeatureEnabled(guildId, 'automod')
      && await client?.commands?.get('automod')?.handleMessage(message, client).catch(() => false);
    if (handled) return;

    if (isFeatureEnabled(guildId, 'autoreply')) await handleAutoReply(message);
    if (isFeatureEnabled(guildId, 'cards')) await handleCardDrop(message);
  },
};

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

    try { await message.reply({ embeds: payload.embeds, files: payload.files, components: payload.components }); } catch {}
    break;
  }
}
