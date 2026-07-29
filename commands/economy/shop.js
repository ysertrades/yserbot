'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { getBalance, addCoins, removeCoins } = require('../../utils/economyManager');
const { EFFECT_TYPES, setEffect, getActiveEffectsList } = require('../../utils/effectsManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { MAX_EQUIPPED, getEquipped, toggleEquip } = require('../../utils/badgeManager');
const { generateMysteryBoxImage } = require('../../utils/mysteryBoxVisual');

const SHOP_FILE = 'shop.json';
const INV_FILE  = 'inventory.json';
const fmt = n => Number(n).toLocaleString();

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
  const map = {
    coin_boost: 0xFFD700, rob_shield: 0x3498DB, xp_boost: 0x9B59B6, daily_boost: 0xF39C12,
    card_magnet: 0xE91E63, vip_casino_pass: 0xF1C40F, badge: 0x1ABC9C, mystery_box: 0x8E44AD,
  };
  return map[type] || 0x2ECC71;
}

// Weighted so a mystery box is usually a modest coin-back and a jackpot is
// a real, rare swing — same shape as the fish/mine rarity tables.
const MYSTERY_BOX_TABLE = [
  { tier: 'dud',     weight: 40, min: 100,   max: 500 },
  { tier: 'small',   weight: 30, min: 1000,  max: 3000 },
  { tier: 'good',    weight: 20, min: 5000,  max: 10000 },
  { tier: 'rare',    weight: 8,  min: 15000, max: 25000 },
  { tier: 'jackpot', weight: 2,  min: 50000, max: 50000 },
];

function rollMysteryBox() {
  const total = MYSTERY_BOX_TABLE.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const t of MYSTERY_BOX_TABLE) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return MYSTERY_BOX_TABLE[MYSTERY_BOX_TABLE.length - 1];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse, buy, and use items in the server shop')
    .addSubcommand(sub => sub.setName('browse').setDescription('View all items for sale'))
    .addSubcommand(sub => sub.setName('buy').setDescription('Purchase an item from the shop')
      .addStringOption(o => o.setName('item').setDescription('Item ID to buy').setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName('quantity').setDescription('How many to buy').setMinValue(1).setMaxValue(10).setRequired(false)))
    .addSubcommand(sub => sub.setName('inventory').setDescription('View your owned items and active effects'))
    .addSubcommand(sub => sub.setName('use').setDescription('Use/activate an item from your inventory')
      .addStringOption(o => o.setName('item').setDescription('Item ID to use').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    const sub     = interaction.options.getSubcommand();
    const focused = interaction.options.getFocused(true);
    const guildId = interaction.guild.id;
    const q       = String(focused.value || '').toLowerCase();
    const items   = getShop(guildId);
    let ids       = [];

    if (focused.name === 'item') {
      ids = Object.keys(items);
      if (sub === 'use') {
        const inv   = getInv(interaction.user.id, guildId);
        const owned = Object.entries(inv).filter(([, qty]) => qty > 0).map(([itemId]) => itemId);
        if (owned.length) ids = owned;
      }
    }

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
    const sub     = interaction.options.getSubcommand();
    const userId  = interaction.user.id;
    const guildId = interaction.guild.id;

    // ── Browse ───────────────────────────────────────────────────────────────
    if (sub === 'browse') {
      const items = getShop(guildId);
      const list  = Object.entries(items);
      if (list.length === 0)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('🛒  Shop Empty').setDescription('No items available yet.\nAn admin can add items with `/shopsettings action:Add Item`.')], ephemeral: true });

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
          value: active.map(e => `${e.label}${e.multiplier ? ` (${e.multiplier}×)` : ''} — expires <t:${Math.floor(e.activeUntil / 1000)}:R>`).join('\n'),
          inline: false,
        });
      }
      const equipped = getEquipped(userId, guildId);
      if (equipped.length > 0) {
        fields.push({
          name:  `🎖️ Equipped Badges (${equipped.length}/${MAX_EQUIPPED})`,
          value: equipped.map(id => `${items[id]?.emoji || '🎖️'} **${items[id]?.name || id}**`).join('\n'),
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

      // Badges are a permanent cosmetic unlock, not a consumable effect —
      // "using" one toggles whether it's equipped (shown on /rank) instead
      // of spending it from inventory.
      if (item.type === 'badge') {
        const result = toggleEquip(userId, guildId, itemId);
        if (!result.ok) {
          const equippedNames = getEquipped(userId, guildId).map(id => items[id]?.name || id).join(', ');
          return interaction.reply({ embeds: [new EmbedBuilder()
            .setColor(0xFF4757)
            .setTitle('❌ Badge Slots Full')
            .setDescription(`You can only equip **${MAX_EQUIPPED}** badges at once.\nCurrently equipped: ${equippedNames}\nUse \`/shop use\` on one of those to unequip it first.`)], ephemeral: true });
        }
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(result.action === 'equipped' ? 0x2ECC71 : 0x9E9E9E)
          .setTitle(`${item.emoji || '🎖️'}  ${item.name} ${result.action === 'equipped' ? 'Equipped' : 'Unequipped'}`)
          .setDescription(result.action === 'equipped'
            ? `Now showing on your \`/rank\` card.`
            : `Removed from your \`/rank\` card. You still own it — use it again to re-equip.`)
          .setFooter({ text: `${result.equipped.length}/${MAX_EQUIPPED} badge slots used` })
          .setTimestamp()] });
      }

      if (item.type === 'mystery_box') {
        const opened = removeFromInv(userId, guildId, itemId);
        if (!opened)
          return interaction.reply({ content: '❌ Failed to remove from inventory.', ephemeral: true });

        const tierDef = rollMysteryBox();
        const reward  = Math.floor(Math.random() * (tierDef.max - tierDef.min + 1)) + tierDef.min;
        addCoins(userId, reward);

        const imageName  = `mbox_${Date.now()}.png`;
        const attachment = new AttachmentBuilder(generateMysteryBoxImage({ tier: tierDef.tier, reward }), { name: imageName });

        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(rarityColor('mystery_box'))
          .setTitle(`${item.emoji || '🎁'}  ${item.name} Opened!`)
          .setDescription(`**Balance:** ${fmt(getBalance(userId))} coins`)
          .setImage(`attachment://${imageName}`)], files: [attachment] });
      }

      const def = EFFECT_TYPES[item.type];
      if (!def)
        return interaction.reply({ content: `❌ \`${item.type}\` items aren't usable through this command yet.`, ephemeral: true });

      const removed = removeFromInv(userId, guildId, itemId);
      if (!removed)
        return interaction.reply({ content: '❌ Failed to remove from inventory.', ephemeral: true });

      // A shop item's own multiplier/durationMs (set via /shopsettings) override
      // the effect type's defaults, so one type (e.g. coin_boost) can back
      // several differently-priced tiers.
      const extraData = {};
      if (item.multiplier != null) {
        if (item.type === 'vip_casino_pass') extraData.betMultiplier = item.multiplier;
        else extraData.multiplier = item.multiplier;
      }
      const durationMs = item.durationMs || def.duration;
      if (item.durationMs) extraData.activeUntil = Date.now() + item.durationMs;
      setEffect(userId, guildId, item.type, extraData);

      const expiresTs = Math.floor((Date.now() + durationMs) / 1000);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(rarityColor(item.type))
        .setTitle(`${item.emoji || '✨'}  ${item.name} Activated!`)
        .setDescription(`> ${item.description || def.desc}`)
        .addFields({ name: '⏳ Expires', value: `<t:${expiresTs}:R>`, inline: true })
        .setFooter({ text: 'Check /shop inventory to see all active effects' })
        .setTimestamp()] });
    }
  },
};
