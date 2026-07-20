'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { getBalance, removeCoins } = require('../../utils/economyManager');
const { EFFECT_TYPES, setEffect, getActiveEffectsList } = require('../../utils/effectsManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');

const SHOP_FILE = 'shop.json';
const INV_FILE  = 'inventory.json';
const fmt = n => Number(n).toLocaleString();

// Built-in item type definitions
const ITEM_TYPES = Object.entries(EFFECT_TYPES).map(([id, e]) => ({ value: id, name: `${e.label}` }));

function getShop(guildId) {
  const data = readJson(SHOP_FILE, {});
  return data[guildId]?.items || {};
}

function getInv(userId, guildId) {
  const data = readJson(INV_FILE, {});
  return data[userId]?.[guildId] || {};
}

function addToInv(userId, guildId, itemId, qty = 1) {
  const data = readJson(INV_FILE, {});
  if (!data[userId]) data[userId] = {};
  if (!data[userId][guildId]) data[userId][guildId] = {};
  data[userId][guildId][itemId] = (data[userId][guildId][itemId] || 0) + qty;
  writeJson(INV_FILE, data);
}

function removeFromInv(userId, guildId, itemId, qty = 1) {
  const data = readJson(INV_FILE, {});
  const cur  = data[userId]?.[guildId]?.[itemId] || 0;
  if (cur < qty) return false;
  data[userId][guildId][itemId] = cur - qty;
  if (data[userId][guildId][itemId] <= 0) delete data[userId][guildId][itemId];
  writeJson(INV_FILE, data);
  return true;
}

function rarityColor(type) {
  const map = { coin_boost: 0xFFD700, rob_shield: 0x3498DB, xp_boost: 0x9B59B6, daily_boost: 0xF39C12, card_magnet: 0xE91E63 };
  return map[type] || 0x2ECC71;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse, buy, and use items in the server shop')
    .addSubcommand(sub => sub.setName('browse').setDescription('View all items for sale'))
    .addSubcommand(sub => sub.setName('buy').setDescription('Purchase an item from the shop')
      .addStringOption(o => o.setName('item').setDescription('Item ID to buy').setRequired(true))
      .addIntegerOption(o => o.setName('quantity').setDescription('How many to buy').setMinValue(1).setMaxValue(10).setRequired(false)))
    .addSubcommand(sub => sub.setName('inventory').setDescription('View your owned items and active effects'))
    .addSubcommand(sub => sub.setName('use').setDescription('Use/activate an item from your inventory')
      .addStringOption(o => o.setName('item').setDescription('Item ID to use').setRequired(true)))
    .addSubcommand(sub => sub.setName('manage').setDescription('Manage the shop (admin only)')
      .addStringOption(o => o.setName('action').setDescription('What to do').setRequired(true)
        .addChoices({ name: '➕ Add Item', value: 'add' }, { name: '🗑️ Remove Item', value: 'remove' }, { name: '📋 View All', value: 'list' }))
      .addStringOption(o => o.setName('id').setDescription('Item ID (slug, e.g. coin_boost_s)').setRequired(false))
      .addStringOption(o => o.setName('name').setDescription('Display name').setRequired(false))
      .addIntegerOption(o => o.setName('price').setDescription('Price in coins').setMinValue(1).setRequired(false))
      .addStringOption(o => o.setName('type').setDescription('Item effect type').setRequired(false)
        .addChoices(...ITEM_TYPES))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji for the item').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Item description').setRequired(false))),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const userId  = interaction.user.id;
    const guildId = interaction.guild.id;

    // ── Browse ───────────────────────────────────────────────────────────────
    if (sub === 'browse') {
      const items = getShop(guildId);
      const list  = Object.entries(items);
      if (list.length === 0)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('🛒  Shop Empty').setDescription('No items available yet.\nAn admin can add items with `/shop manage add`.')], ephemeral: true });

      const fields = list.map(([id, item]) => {
        const def = EFFECT_TYPES[item.type];
        const dur = def ? `⏳ ${def.duration / 3600000 >= 1 ? `${def.duration / 3600000}h` : `${def.duration / 60000}m`}` : '';
        return {
          name:   `${item.emoji || '📦'} ${item.name}`,
          value:  `💸 **${fmt(item.price)}** coins\n${item.description || def?.desc || ''}\n${dur}\n🆔 \`${id}\``,
          inline: true,
        };
      });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xE91E63)
        .setTitle('🛒  Server Shop')
        .setDescription('Use `/shop buy <item-id>` to purchase.\nUse `/shop use <item-id>` to activate.\n\u200b')
        .addFields(fields)
        .setFooter({ text: 'Items grant temporary boosts when used  •  Check /shop inventory for your items' })
        .setTimestamp()] });
    }

    // ── Buy ──────────────────────────────────────────────────────────────────
    if (sub === 'buy') {
      const itemId = interaction.options.getString('item').toLowerCase();
      const qty    = interaction.options.getInteger('quantity') || 1;
      const items  = getShop(guildId);
      const item   = items[itemId];
      if (!item)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('❌ Not Found').setDescription(`No item with ID \`${itemId}\` exists. Use \`/shop browse\` to see available items.`)], ephemeral: true });

      const total   = item.price * qty;
      const balance = getBalance(userId);
      if (balance < total)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('❌ Insufficient Coins').setDescription(`You need **${fmt(total)}** coins but only have **${fmt(balance)}**.`)], ephemeral: true });

      removeCoins(userId, total);
      addToInv(userId, guildId, itemId, qty);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(rarityColor(item.type))
        .setTitle(`${item.emoji || '📦'}  Purchase Complete!`)
        .setDescription(`You bought **${qty}× ${item.name}**!`)
        .addFields(
          { name: '💸 Spent',       value: `**${fmt(total)}** coins`,          inline: true },
          { name: '💰 Remaining',   value: `**${fmt(getBalance(userId))}** coins`, inline: true },
          { name: '💡 Tip',         value: 'Use `/shop use ' + itemId + '` to activate it!', inline: false },
        )
        .setTimestamp()] });
    }

    // ── Inventory ────────────────────────────────────────────────────────────
    if (sub === 'inventory') {
      const inv     = getInv(userId, guildId);
      const items   = getShop(guildId);
      const active  = getActiveEffectsList(userId, guildId);
      const owned   = Object.entries(inv).filter(([, qty]) => qty > 0);

      const fields = [];
      if (owned.length > 0) {
        fields.push({
          name:  '📦 Owned Items',
          value: owned.map(([id, qty]) => {
            const item = items[id];
            return `${item?.emoji || '📦'} **${item?.name || id}** × ${qty}  —  \`/shop use ${id}\``;
          }).join('\n'),
          inline: false,
        });
      }
      if (active.length > 0) {
        fields.push({
          name:  '✨ Active Effects',
          value: active.map(e => `${e.label} — expires <t:${Math.floor(e.activeUntil / 1000)}:R>`).join('\n'),
          inline: false,
        });
      }
      if (fields.length === 0)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x9E9E9E).setTitle('🎒  Inventory Empty').setDescription('You have no items.\nVisit \`/shop browse\` to see what\'s available.')], ephemeral: true });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🎒  Your Inventory')
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .addFields(fields)
        .setTimestamp()] });
    }

    // ── Use ──────────────────────────────────────────────────────────────────
    if (sub === 'use') {
      const itemId = interaction.options.getString('item').toLowerCase();
      const items  = getShop(guildId);
      const item   = items[itemId];
      if (!item)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('❌ Not Found').setDescription(`No item \`${itemId}\` in this shop.`)], ephemeral: true });

      const inv = getInv(userId, guildId);
      if (!inv[itemId] || inv[itemId] <= 0)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('❌ Not Owned').setDescription(`You don't own **${item.name}**.\nBuy it first with \`/shop buy ${itemId}\`.`)], ephemeral: true });

      const removed = removeFromInv(userId, guildId, itemId);
      if (!removed)
        return interaction.reply({ content: '❌ Failed to remove from inventory.', ephemeral: true });

      setEffect(userId, guildId, item.type);
      const def     = EFFECT_TYPES[item.type];
      const expiresTs = Math.floor((Date.now() + def.duration) / 1000);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(rarityColor(item.type))
        .setTitle(`${item.emoji || '✨'}  ${item.name} Activated!`)
        .setDescription(`> ${def.desc}`)
        .addFields({ name: '⏳ Expires', value: `<t:${expiresTs}:R>`, inline: true })
        .setFooter({ text: 'Check /shop inventory to see all active effects' })
        .setTimestamp()] });
    }

    // ── Manage (admin) ───────────────────────────────────────────────────────
    if (sub === 'manage') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))
        return interaction.reply({ content: '❌ You need **Manage Server** to manage the shop.', ephemeral: true });

      const action = interaction.options.getString('action');

      if (action === 'list') {
        const items = getShop(guildId);
        const list  = Object.entries(items);
        if (list.length === 0)
          return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('📋 Shop is Empty').setDescription('Add items with `/shop manage add`.')], ephemeral: true });
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
        if (!id || !name || !price || !type)
          return interaction.reply({ content: '❌ `id`, `name`, `price`, and `type` are all required.', ephemeral: true });

        const data = readJson(SHOP_FILE, {});
        if (!data[guildId]) data[guildId] = { items: {} };
        if (!data[guildId].items) data[guildId].items = {};
        data[guildId].items[id] = { name, price, type, emoji, description: desc };
        writeJson(SHOP_FILE, data);

        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('✅  Item Added')
          .addFields(
            { name: '🆔 ID',       value: `\`${id}\``,           inline: true },
            { name: '📦 Name',     value: name,                   inline: true },
            { name: '💸 Price',    value: `${fmt(price)} coins`,  inline: true },
            { name: '⚙️ Type',    value: `\`${type}\``,          inline: true },
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
    }
  },
};
