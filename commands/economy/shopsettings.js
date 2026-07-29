'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { EFFECT_TYPES } = require('../../utils/effectsManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');

const SHOP_FILE = 'shop.json';
const fmt = n => Number(n).toLocaleString();
const SESSION_TTL_MS = 10 * 60 * 1000;

const TYPE_LABELS = {
  ...Object.fromEntries(Object.entries(EFFECT_TYPES).map(([id, e]) => [id, e.label])),
  badge:         '🎖️ Profile Badge (cosmetic, shown on /rank)',
  mystery_box:   '🎁 Mystery Box (random reward)',
  cooldown_skip: '⏩ Cooldown Skip (temporary — bypasses cooldowns while active)',
};
const NEEDS_MULTIPLIER = new Set(['coin_boost', 'vip_casino_pass']);
const NEEDS_BADGE_ICON = new Set(['badge']);

const BADGE_ICONS = [
  { value: 'star',    name: '⭐ Star' },
  { value: 'crown',   name: '👑 Crown' },
  { value: 'shield',  name: '🛡️ Shield' },
  { value: 'flame',   name: '🔥 Flame' },
  { value: 'diamond', name: '💎 Diamond' },
];

// In-memory wizard state for the multi-step Add flow (type → common fields
// modal → [conditional] multiplier/badge-icon step). Short-lived, mirrors
// trivia.js's session pattern.
const addSessions = new Map();

function getShop(guildId) {
  const data = readJson(SHOP_FILE, {});
  return data[guildId]?.items || {};
}

function saveShop(guildId, items) {
  const data = readJson(SHOP_FILE, {});
  if (!data[guildId]) data[guildId] = { items: {} };
  data[guildId].items = items;
  writeJson(SHOP_FILE, data);
}

// ── Panel ────────────────────────────────────────────────────────────────────

function buildPanelEmbed(guildId) {
  const items = getShop(guildId);
  const list  = Object.entries(items);
  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('⚙️  Shop Settings')
    .setDescription(list.length
      ? list.map(([id, i]) => `${i.emoji || '📦'} **${i.name}** \`${id}\` — 💸 **${fmt(i.price)}** coins — \`${i.type}\``).join('\n')
      : 'No items yet — use **Add Item** below to create one.')
    .setFooter({ text: `${list.length} item${list.length !== 1 ? 's' : ''} in the shop` })
    .setTimestamp();
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shopset_add').setLabel('Add Item').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shopset_edit').setLabel('Edit Item').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shopset_remove').setLabel('Remove Item').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shopset_close').setLabel('Close').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  );
}

function buildItemSelect(guildId, customId, placeholder) {
  const items = getShop(guildId);
  const entries = Object.entries(items);
  if (entries.length === 0) return null;
  const options = entries.slice(0, 25).map(([id, item]) => new StringSelectMenuOptionBuilder()
    .setLabel(`${item.name} — ${fmt(item.price)} coins`.slice(0, 100))
    .setDescription(id.slice(0, 100))
    .setEmoji(item.emoji || '📦')
    .setValue(id));
  return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(options);
}

// ── Add wizard ───────────────────────────────────────────────────────────────

function buildCommonFieldsModal(sessionId) {
  return new ModalBuilder().setCustomId(`shopset_add_modal:${sessionId}`).setTitle('Add Shop Item').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('id').setLabel('Item ID (slug, e.g. coin_boost_super)').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Display Name').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price').setLabel('Price (coins)').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji (optional)').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false)),
  );
}

function buildMultiplierModal(sessionId) {
  return new ModalBuilder().setCustomId(`shopset_add_multiplier_modal:${sessionId}`).setTitle('Boost Details').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('multiplier').setLabel('Multiplier (e.g. 2 or 2.5, optional)').setStyle(TextInputStyle.Short).setRequired(false)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration_hours').setLabel('Duration in hours (optional)').setStyle(TextInputStyle.Short).setRequired(false)),
  );
}

function buildBadgeIconSelect(sessionId) {
  const options = BADGE_ICONS.map(b => new StringSelectMenuOptionBuilder().setLabel(b.name).setValue(b.value));
  return new StringSelectMenuBuilder().setCustomId(`shopset_add_badgeicon_select:${sessionId}`).setPlaceholder('Choose an icon for this badge…').addOptions(options);
}

function finalizeAddItem(session) {
  const items = getShop(session.guildId);
  const { itemId, name, price, emoji, description, multiplier, durationMs, badgeIcon } = session.common;
  const item = { name, price, type: session.type, emoji: emoji || '📦', description: description || '' };
  if (multiplier != null) item.multiplier = multiplier;
  if (durationMs != null) item.durationMs = durationMs;
  if (badgeIcon) item.badgeIcon = badgeIcon;
  items[itemId] = item;
  saveShop(session.guildId, items);
  return item;
}

function addedConfirmEmbed(itemId, item) {
  return new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('✅  Item Added')
    .addFields(
      { name: '🆔 ID',    value: `\`${itemId}\``,        inline: true },
      { name: '📦 Name',  value: item.name,               inline: true },
      { name: '💸 Price', value: `${fmt(item.price)} coins`, inline: true },
      { name: '⚙️ Type', value: `\`${item.type}\``,      inline: true },
      ...(item.multiplier != null ? [{ name: '✖️ Multiplier', value: `${item.multiplier}×`, inline: true }] : []),
      ...(item.durationMs != null ? [{ name: '⏳ Duration', value: `${item.durationMs / 3600000}h`, inline: true }] : []),
      ...(item.badgeIcon ? [{ name: '🎖️ Icon', value: item.badgeIcon, inline: true }] : []),
    )
    .setTimestamp();
}

// ── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shopsettings')
    .setDescription('Manage the server shop (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.reply({ embeds: [buildPanelEmbed(interaction.guild.id)], components: [buildPanelRow()] });
  },

  async handleButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guild.id;

    if (id === 'shopset_close') {
      try { await interaction.message.delete(); } catch {}
      return;
    }

    if (id === 'shopset_add') {
      const options = Object.entries(TYPE_LABELS).map(([value, label]) => new StringSelectMenuOptionBuilder().setLabel(label.slice(0, 100)).setValue(value));
      const select  = new StringSelectMenuBuilder().setCustomId('shopset_add_type_select').setPlaceholder('Choose item type…').addOptions(options);
      return interaction.reply({ content: 'What type of item do you want to add?', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
    }

    if (id === 'shopset_edit') {
      const select = buildItemSelect(guildId, 'shopset_edit_select', 'Choose an item to edit…');
      if (!select) return interaction.reply({ content: '❌ No items to edit yet.', flags: MessageFlags.Ephemeral });
      return interaction.reply({ content: 'Which item do you want to edit?', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
    }

    if (id === 'shopset_remove') {
      const select = buildItemSelect(guildId, 'shopset_remove_select', 'Choose an item to remove…');
      if (!select) return interaction.reply({ content: '❌ No items to remove yet.', flags: MessageFlags.Ephemeral });
      return interaction.reply({ content: 'Which item do you want to remove?', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
    }

    if (id.startsWith('shopset_remove_confirm:')) {
      const itemId = id.slice('shopset_remove_confirm:'.length);
      const items  = getShop(guildId);
      const name   = items[itemId]?.name || itemId;
      delete items[itemId];
      saveShop(guildId, items);
      return interaction.update({ content: `✅ Removed **${name}** (\`${itemId}\`) from the shop.`, components: [] });
    }

    if (id === 'shopset_remove_cancel') {
      return interaction.update({ content: 'Cancelled — nothing was removed.', components: [] });
    }
  },

  async handleSelect(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guild.id;

    if (id === 'shopset_add_type_select') {
      const type = interaction.values[0];
      const sessionId = `${interaction.user.id}-${Date.now()}`;
      addSessions.set(sessionId, { guildId, type });
      setTimeout(() => addSessions.delete(sessionId), SESSION_TTL_MS);
      return interaction.showModal(buildCommonFieldsModal(sessionId));
    }

    if (id === 'shopset_edit_select') {
      const itemId = interaction.values[0];
      const item = getShop(guildId)[itemId];
      if (!item) return interaction.update({ content: '❌ That item no longer exists.', components: [] });

      const modal = new ModalBuilder().setCustomId(`shopset_edit_modal:${itemId}`).setTitle(`Edit: ${item.name}`.slice(0, 45)).addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Display Name').setStyle(TextInputStyle.Short).setRequired(true).setValue(item.name)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('price').setLabel('Price (coins)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(item.price))),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(false).setValue(item.emoji || '')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(item.description || '')),
      );
      return interaction.showModal(modal);
    }

    if (id === 'shopset_remove_select') {
      const itemId = interaction.values[0];
      const item = getShop(guildId)[itemId];
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`shopset_remove_confirm:${itemId}`).setLabel('Confirm Remove').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('shopset_remove_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      return interaction.update({ content: `Remove **${item?.name || itemId}**? This can't be undone.`, components: [row] });
    }

    if (id.startsWith('shopset_add_badgeicon_select:')) {
      const sessionId = id.slice('shopset_add_badgeicon_select:'.length);
      const session = addSessions.get(sessionId);
      if (!session) return interaction.update({ content: '❌ This session expired — please start over with Add Item.', components: [] });

      session.common.badgeIcon = interaction.values[0];
      const item = finalizeAddItem(session);
      addSessions.delete(sessionId);
      return interaction.update({ content: null, embeds: [addedConfirmEmbed(session.common.itemId, item)], components: [] });
    }
  },

  async handleModal(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guild.id;

    if (id.startsWith('shopset_add_modal:')) {
      const sessionId = id.slice('shopset_add_modal:'.length);
      const session = addSessions.get(sessionId);
      if (!session) return interaction.reply({ content: '❌ This session expired — please start over with Add Item.', flags: MessageFlags.Ephemeral });

      const itemId = interaction.fields.getTextInputValue('id').toLowerCase().trim().replace(/\s+/g, '_');
      const name   = interaction.fields.getTextInputValue('name').trim();
      const price  = parseInt(interaction.fields.getTextInputValue('price'), 10);
      const emoji  = interaction.fields.getTextInputValue('emoji').trim();
      const description = interaction.fields.getTextInputValue('description').trim();

      if (!itemId || !name || isNaN(price) || price < 1) {
        addSessions.delete(sessionId);
        return interaction.reply({ content: '❌ Invalid input — ID and Name are required, and Price must be a positive number.', flags: MessageFlags.Ephemeral });
      }
      if (getShop(session.guildId)[itemId]) {
        addSessions.delete(sessionId);
        return interaction.reply({ content: `❌ An item with ID \`${itemId}\` already exists — use **Edit Item** instead.`, flags: MessageFlags.Ephemeral });
      }

      session.common = { itemId, name, price, emoji, description };

      if (NEEDS_MULTIPLIER.has(session.type)) {
        addSessions.set(sessionId, session);
        return interaction.showModal(buildMultiplierModal(sessionId));
      }
      if (NEEDS_BADGE_ICON.has(session.type)) {
        addSessions.set(sessionId, session);
        return interaction.reply({ content: 'Pick an icon for this badge:', components: [new ActionRowBuilder().addComponents(buildBadgeIconSelect(sessionId))], flags: MessageFlags.Ephemeral });
      }

      const item = finalizeAddItem(session);
      addSessions.delete(sessionId);
      return interaction.reply({ embeds: [addedConfirmEmbed(itemId, item)], flags: MessageFlags.Ephemeral });
    }

    if (id.startsWith('shopset_add_multiplier_modal:')) {
      const sessionId = id.slice('shopset_add_multiplier_modal:'.length);
      const session = addSessions.get(sessionId);
      if (!session) return interaction.reply({ content: '❌ This session expired — please start over with Add Item.', flags: MessageFlags.Ephemeral });

      const multRaw = interaction.fields.getTextInputValue('multiplier').trim();
      const durRaw  = interaction.fields.getTextInputValue('duration_hours').trim();
      const multiplier = multRaw ? parseFloat(multRaw) : null;
      const durationHours = durRaw ? parseFloat(durRaw) : null;

      session.common.multiplier = (multiplier != null && !isNaN(multiplier)) ? multiplier : undefined;
      session.common.durationMs = (durationHours != null && !isNaN(durationHours)) ? Math.round(durationHours * 60 * 60 * 1000) : undefined;

      const item = finalizeAddItem(session);
      addSessions.delete(sessionId);
      return interaction.reply({ embeds: [addedConfirmEmbed(session.common.itemId, item)], flags: MessageFlags.Ephemeral });
    }

    if (id.startsWith('shopset_edit_modal:')) {
      const itemId = id.slice('shopset_edit_modal:'.length);
      const items  = getShop(guildId);
      const item   = items[itemId];
      if (!item) return interaction.reply({ content: '❌ That item no longer exists.', flags: MessageFlags.Ephemeral });

      const name  = interaction.fields.getTextInputValue('name').trim();
      const price = parseInt(interaction.fields.getTextInputValue('price'), 10);
      const emoji = interaction.fields.getTextInputValue('emoji').trim();
      const description = interaction.fields.getTextInputValue('description').trim();

      if (!name || isNaN(price) || price < 1)
        return interaction.reply({ content: '❌ Invalid input — Name is required and Price must be a positive number.', flags: MessageFlags.Ephemeral });

      item.name = name;
      item.price = price;
      item.emoji = emoji || item.emoji;
      item.description = description;
      items[itemId] = item;
      saveShop(guildId, items);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅  Item Updated')
        .addFields(
          { name: '🆔 ID',    value: `\`${itemId}\``,           inline: true },
          { name: '📦 Name',  value: name,                       inline: true },
          { name: '💸 Price', value: `${fmt(price)} coins`,      inline: true },
        )
        .setTimestamp()], flags: MessageFlags.Ephemeral });
    }
  },
};
