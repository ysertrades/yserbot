'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  MessageFlags,
} = require('discord.js');
const { getBalance, addCoins, removeCoins } = require('../../utils/economyManager');
const { EFFECT_TYPES, setEffect, getEffect, getActiveEffectsList } = require('../../utils/effectsManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { MAX_EQUIPPED, getEquipped, toggleEquip } = require('../../utils/badgeManager');
const { generateMysteryBoxImage } = require('../../utils/mysteryBoxVisual');
const { generateShopBanner } = require('../../utils/shopVisual');

const SHOP_FILE = 'shop.json';
const INV_FILE  = 'inventory.json';
const fmt = n => Number(n).toLocaleString();

// ── Data helpers ─────────────────────────────────────────────────────────────
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
    cooldown_skip: 0x2ECC71,
  };
  return map[type] || 0x2ECC71;
}

function errorEmbed(title, desc) {
  return new EmbedBuilder().setColor(0xFF4757).setTitle(`❌ ${title}`).setDescription(desc);
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

// ── Panel builders ───────────────────────────────────────────────────────────

function buildShopPanel(guildId) {
  const items = getShop(guildId);
  const list  = Object.entries(items);
  const imageName  = `shop_banner_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(generateShopBanner({ itemCount: list.length }), { name: imageName });

  const embed = new EmbedBuilder()
    .setColor(0xE6C85A)
    .setImage(`attachment://${imageName}`)
    .setDescription(list.length
      ? list.map(([, item]) => `${item.emoji || '📦'} **${item.name}** — 💸 **${fmt(item.price)}** coins\n> ${item.description || ''}`).join('\n\n').slice(0, 4000)
      : 'No items available yet. An admin can add items with `/shopsettings action:Add Item`.')
    .setFooter({ text: 'Use the buttons below to buy, view your inventory, or use an item' });

  return { embed, attachment };
}

function buildMainRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shop_buy').setLabel('Buy').setEmoji('🛒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shop_inventory').setLabel('Inventory').setEmoji('🎒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shop_use').setLabel('Use').setEmoji('✨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`shop_close:${userId}`).setLabel('Close').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  );
}

function buildInventoryEmbed(userId, guildId) {
  const inv    = getInv(userId, guildId);
  const items  = getShop(guildId);
  const active = getActiveEffectsList(userId, guildId);
  const owned  = Object.entries(inv).filter(([, qty]) => qty > 0);

  const fields = [];
  if (owned.length > 0) {
    fields.push({
      name:  '📦 Owned Items',
      value: owned.map(([id, qty]) => `${items[id]?.emoji || '📦'} **${items[id]?.name || id}** × ${qty}`).join('\n'),
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

  const embed = new EmbedBuilder().setColor(0x9B59B6).setTitle('🎒  Your Inventory').setTimestamp();
  if (fields.length === 0) embed.setColor(0x9E9E9E).setDescription("You have no items.\nUse the Buy button on the shop panel to get started.");
  else embed.addFields(fields);
  return embed;
}

function buildBuySelect(guildId) {
  const items = getShop(guildId);
  const list  = Object.entries(items);
  if (list.length === 0) return null;
  const options = list.slice(0, 25).map(([id, item]) => new StringSelectMenuOptionBuilder()
    .setLabel(`${item.name} — ${fmt(item.price)} coins`.slice(0, 100))
    .setDescription((item.description || 'No description').slice(0, 100))
    .setEmoji(item.emoji || '📦')
    .setValue(id));
  return new StringSelectMenuBuilder().setCustomId('shop_buy_select').setPlaceholder('Choose an item to buy…').addOptions(options);
}

function buildUseSelect(userId, guildId) {
  const items = getShop(guildId);
  const inv   = getInv(userId, guildId);
  const owned = Object.entries(inv).filter(([, qty]) => qty > 0);
  if (owned.length === 0) return null;
  const options = owned.slice(0, 25).map(([id, qty]) => new StringSelectMenuOptionBuilder()
    .setLabel(`${items[id]?.name || id} × ${qty}`.slice(0, 100))
    .setDescription((items[id]?.description || 'No description').slice(0, 100))
    .setEmoji(items[id]?.emoji || '📦')
    .setValue(id));
  return new StringSelectMenuBuilder().setCustomId('shop_use_select').setPlaceholder('Choose an item to use…').addOptions(options);
}

// ── Buy / use core logic — returns a payload ({ embeds, files? }) ───────────

function purchaseItem(userId, guildId, itemId) {
  const items = getShop(guildId);
  const item  = items[itemId];
  if (!item) return { embeds: [errorEmbed('Not Found', `No item \`${itemId}\` in this shop.`)] };

  const balance = getBalance(userId);
  if (balance < item.price) return { embeds: [errorEmbed('Insufficient Coins', `You need **${fmt(item.price)}** coins but only have **${fmt(balance)}**.`)] };

  removeCoins(userId, item.price);
  addToInv(userId, guildId, itemId, 1);

  return { embeds: [new EmbedBuilder()
    .setColor(rarityColor(item.type))
    .setTitle(`${item.emoji || '📦'}  Purchase Complete!`)
    .setDescription(`You bought **${item.name}**!\nUse the **Use** button on the shop panel to activate it.`)
    .addFields(
      { name: '💸 Spent',     value: `**${fmt(item.price)}** coins`,          inline: true },
      { name: '💰 Remaining', value: `**${fmt(getBalance(userId))}** coins`, inline: true },
    )
    .setTimestamp()] };
}

function useItem(userId, guildId, itemId) {
  const items = getShop(guildId);
  const item  = items[itemId];
  if (!item) return { embeds: [errorEmbed('Not Found', `No item \`${itemId}\` in this shop.`)] };

  const inv = getInv(userId, guildId);
  if (!inv[itemId] || inv[itemId] <= 0)
    return { embeds: [errorEmbed('Not Owned', `You don't own **${item.name}**.`)] };

  // Badges are a permanent cosmetic unlock, not a consumable effect — "using"
  // one toggles whether it's equipped (shown on /rank) instead of spending
  // it from inventory.
  if (item.type === 'badge') {
    const result = toggleEquip(userId, guildId, itemId);
    if (!result.ok) {
      const equippedNames = getEquipped(userId, guildId).map(id => items[id]?.name || id).join(', ');
      return { embeds: [errorEmbed('Badge Slots Full', `You can only equip **${MAX_EQUIPPED}** badges at once.\nCurrently equipped: ${equippedNames}\nUse this on one of those to unequip it first.`)] };
    }
    return { embeds: [new EmbedBuilder()
      .setColor(result.action === 'equipped' ? 0x2ECC71 : 0x9E9E9E)
      .setTitle(`${item.emoji || '🎖️'}  ${item.name} ${result.action === 'equipped' ? 'Equipped' : 'Unequipped'}`)
      .setDescription(result.action === 'equipped'
        ? 'Now showing on your `/rank` card.'
        : 'Removed from your `/rank` card. You still own it — use it again to re-equip.')
      .setFooter({ text: `${result.equipped.length}/${MAX_EQUIPPED} badge slots used` })
      .setTimestamp()] };
  }

  if (item.type === 'mystery_box') {
    const opened = removeFromInv(userId, guildId, itemId);
    if (!opened) return { embeds: [errorEmbed('Failed', 'Could not remove from inventory.')] };

    const tierDef = rollMysteryBox();
    let reward    = Math.floor(Math.random() * (tierDef.max - tierDef.min + 1)) + tierDef.min;
    const boost   = getEffect(userId, guildId, 'coin_boost');
    if (boost) reward = Math.floor(reward * (boost.multiplier || 1.5));
    addCoins(userId, reward);

    const imageName  = `mbox_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateMysteryBoxImage({ tier: tierDef.tier, reward }), { name: imageName });

    return { embeds: [new EmbedBuilder()
      .setColor(rarityColor('mystery_box'))
      .setTitle(`${item.emoji || '🎁'}  ${item.name} Opened!`)
      .setDescription(`**Balance:** ${fmt(getBalance(userId))} coins${boost ? `\n💰 Coin Boost active — ${boost.multiplier || 1.5}× earnings!` : ''}`)
      .setImage(`attachment://${imageName}`)], files: [attachment] };
  }

  const def = EFFECT_TYPES[item.type];
  if (!def) return { embeds: [errorEmbed('Not Usable', `\`${item.type}\` items aren't usable yet.`)] };

  const removed = removeFromInv(userId, guildId, itemId);
  if (!removed) return { embeds: [errorEmbed('Failed', 'Could not remove from inventory.')] };

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
  return { embeds: [new EmbedBuilder()
    .setColor(rarityColor(item.type))
    .setTitle(`${item.emoji || '✨'}  ${item.name} Activated!`)
    .setDescription(`> ${item.description || def.desc}`)
    .addFields({ name: '⏳ Expires', value: `<t:${expiresTs}:R>`, inline: true })
    .setTimestamp()] };
}

// ── Command ──────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse the server shop'),

  async execute(interaction) {
    const { embed, attachment } = buildShopPanel(interaction.guild.id);
    await interaction.reply({ embeds: [embed], files: [attachment], components: [buildMainRow(interaction.user.id)] });
  },

  async handleButton(interaction) {
    const id = interaction.customId;
    const guildId = interaction.guild.id;
    const userId  = interaction.user.id;

    if (id === 'shop_buy') {
      const select = buildBuySelect(guildId);
      if (!select) return interaction.reply({ embeds: [errorEmbed('Shop Empty', 'No items available yet.')], flags: MessageFlags.Ephemeral });
      return interaction.reply({ content: 'Pick an item to buy:', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
    }

    if (id === 'shop_inventory') {
      return interaction.reply({ embeds: [buildInventoryEmbed(userId, guildId)], flags: MessageFlags.Ephemeral });
    }

    if (id === 'shop_use') {
      const select = buildUseSelect(userId, guildId);
      if (!select) return interaction.reply({ embeds: [errorEmbed('Nothing to Use', "You don't own any items yet — buy one first!")], flags: MessageFlags.Ephemeral });
      return interaction.reply({ content: 'Pick an item to use:', components: [new ActionRowBuilder().addComponents(select)], flags: MessageFlags.Ephemeral });
    }

    if (id.startsWith('shop_close:')) {
      const ownerId = id.split(':')[1];
      if (userId !== ownerId) return interaction.reply({ content: "❌ Only the person who opened this shop panel can close it.", flags: MessageFlags.Ephemeral });
      try { await interaction.message.delete(); } catch {}
      return;
    }
  },

  async handleSelect(interaction) {
    const id      = interaction.customId;
    const guildId = interaction.guild.id;
    const userId  = interaction.user.id;
    const itemId  = interaction.values[0];

    if (id === 'shop_buy_select') {
      const payload = purchaseItem(userId, guildId, itemId);
      return interaction.update({ content: null, embeds: payload.embeds, files: payload.files || [], components: [], attachments: [] });
    }

    if (id === 'shop_use_select') {
      const payload = useItem(userId, guildId, itemId);
      return interaction.update({ content: null, embeds: payload.embeds, files: payload.files || [], components: [], attachments: [] });
    }
  },
};
