'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { EFFECT_TYPES } = require('../../utils/effectsManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');

const SHOP_FILE = 'shop.json';
const fmt = n => Number(n).toLocaleString();

const ITEM_TYPES = [
  ...Object.entries(EFFECT_TYPES).map(([id, e]) => ({ value: id, name: `${e.label}` })),
  { value: 'badge',         name: '🎖️ Profile Badge (cosmetic, shown on /rank)' },
  { value: 'mystery_box',   name: '🎁 Mystery Box (random reward)' },
  { value: 'cooldown_skip', name: '⏩ Cooldown Skip (resets game cooldowns)' },
];

const BADGE_ICONS = [
  { value: 'star',    name: '⭐ Star' },
  { value: 'crown',   name: '👑 Crown' },
  { value: 'shield',  name: '🛡️ Shield' },
  { value: 'flame',   name: '🔥 Flame' },
  { value: 'diamond', name: '💎 Diamond' },
];

function getShop(guildId) {
  const data = readJson(SHOP_FILE, {});
  return data[guildId]?.items || {};
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shopsettings')
    .setDescription('Manage the server shop (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true)
      .addChoices({ name: '➕ Add Item', value: 'add' }, { name: '🗑️ Remove Item', value: 'remove' }, { name: '📋 View All', value: 'list' }))
    .addStringOption(o => o.setName('id').setDescription('Item ID (slug, e.g. coin_boost_s)').setRequired(false).setAutocomplete(true))
    .addStringOption(o => o.setName('name').setDescription('Display name').setRequired(false))
    .addIntegerOption(o => o.setName('price').setDescription('Price in coins').setMinValue(1).setRequired(false))
    .addStringOption(o => o.setName('type').setDescription('Item effect type').setRequired(false)
      .addChoices(...ITEM_TYPES))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji for the item').setRequired(false))
    .addStringOption(o => o.setName('description').setDescription('Item description').setRequired(false))
    .addNumberOption(o => o.setName('multiplier').setDescription('Earnings/bet multiplier override (coin_boost, vip_casino_pass)').setMinValue(1).setRequired(false))
    .addNumberOption(o => o.setName('duration_hours').setDescription('Effect duration override, in hours').setMinValue(0.1).setRequired(false))
    .addStringOption(o => o.setName('badge_icon').setDescription('Icon to draw for a badge-type item').setRequired(false)
      .addChoices(...BADGE_ICONS)),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const guildId = interaction.guild.id;
    const q       = String(focused.value || '').toLowerCase();
    const items   = getShop(guildId);
    let ids = [];

    const action = interaction.options.getString('action');
    if (focused.name === 'id' && action === 'remove') ids = Object.keys(items);

    const choices = ids
      .filter(id => id.includes(q))
      .slice(0, 25)
      .map(id => {
        const item = items[id];
        return { name: (item ? `${item.emoji || '📦'} ${item.name} (${id})` : id).slice(0, 100), value: id };
      });
    await interaction.respond(choices).catch(() => {});
  },

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const action = interaction.options.getString('action');

    if (action === 'list') {
      const items = getShop(guildId);
      const list  = Object.entries(items);
      if (list.length === 0)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('📋 Shop is Empty').setDescription('Add items with `/shopsettings action:Add Item`.')], ephemeral: true });
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📋 All Shop Items')
        .setDescription(list.map(([id, i]) => `**${i.emoji || '📦'} ${i.name}** \`${id}\`  •  ${fmt(i.price)} coins  •  \`${i.type}\``).join('\n'))
        .setTimestamp()], ephemeral: true });
    }

    if (action === 'add') {
      const id   = interaction.options.getString('id')?.toLowerCase().replace(/\s+/g, '_');
      const name = interaction.options.getString('name');
      const price = interaction.options.getInteger('price');
      const type  = interaction.options.getString('type');
      const emoji = interaction.options.getString('emoji') || '📦';
      const desc  = interaction.options.getString('description') || '';
      const multiplier     = interaction.options.getNumber('multiplier');
      const durationHours  = interaction.options.getNumber('duration_hours');
      const badgeIcon      = interaction.options.getString('badge_icon');
      if (!id || !name || !price || !type)
        return interaction.reply({ content: '❌ `id`, `name`, `price`, and `type` are all required.', ephemeral: true });
      if (type === 'badge' && !badgeIcon)
        return interaction.reply({ content: '❌ `badge_icon` is required for badge-type items.', ephemeral: true });

      const data = readJson(SHOP_FILE, {});
      if (!data[guildId]) data[guildId] = { items: {} };
      if (!data[guildId].items) data[guildId].items = {};
      const item = { name, price, type, emoji, description: desc };
      if (multiplier != null) item.multiplier = multiplier;
      if (durationHours != null) item.durationMs = Math.round(durationHours * 60 * 60 * 1000);
      if (type === 'badge') item.badgeIcon = badgeIcon;
      data[guildId].items[id] = item;
      writeJson(SHOP_FILE, data);

      const extraFields = [];
      if (multiplier != null) extraFields.push({ name: '✖️ Multiplier', value: `${multiplier}×`, inline: true });
      if (durationHours != null) extraFields.push({ name: '⏳ Duration', value: `${durationHours}h`, inline: true });
      if (badgeIcon) extraFields.push({ name: '🎖️ Badge Icon', value: badgeIcon, inline: true });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅  Item Added')
        .addFields(
          { name: '🆔 ID',       value: `\`${id}\``,           inline: true },
          { name: '📦 Name',     value: name,                   inline: true },
          { name: '💸 Price',    value: `${fmt(price)} coins`,  inline: true },
          { name: '⚙️ Type',    value: `\`${type}\``,          inline: true },
          ...extraFields,
        )
        .setTimestamp()], ephemeral: true });
    }

    if (action === 'remove') {
      const id   = interaction.options.getString('id')?.toLowerCase();
      if (!id) return interaction.reply({ content: '❌ Provide an item ID to remove.', ephemeral: true });
      const data = readJson(SHOP_FILE, {});
      if (!data[guildId]?.items?.[id])
        return interaction.reply({ content: `❌ No item \`${id}\` found.`, ephemeral: true });
      delete data[guildId].items[id];
      writeJson(SHOP_FILE, data);
      return interaction.reply({ content: `✅ Item \`${id}\` removed from the shop.`, ephemeral: true });
    }
  },
};
