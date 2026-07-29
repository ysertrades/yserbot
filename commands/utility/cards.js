'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { addCoins, getBalance }  = require('../../utils/economyManager');
const { CARDS, RARITY, SELL_PRICE } = require('../../utils/cardsManager');
const { generateCollectionBoard } = require('../../utils/cardCollectionVisual');
const { filterNonBotIds } = require('../../utils/discordHelpers');

const CARD_CATALOG = CARDS.map(c => ({ id: c.id, name: c.name, rarity: c.rarity }));
const fmt = n => Number(n).toLocaleString();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cards')
    .setDescription('Collectible trading cards that drop in chat')
    .addSubcommand(sub => sub.setName('collection').setDescription('View your (or someone\'s) card collection')
      .addUserOption(o => o.setName('user').setDescription('Whose collection to view').setRequired(false)))
    .addSubcommand(sub => sub.setName('sell').setDescription('Sell a card from your collection for coins')
      .addStringOption(o => o.setName('card').setDescription('Card to sell — start typing to search').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName('leaderboard').setDescription('Top card collectors in this server')),

  // ── Autocomplete ─────────────────────────────────────────────────────────────
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const all     = readJson('cards.json', {});
    const owned   = all[interaction.user.id] || [];

    // Build unique card map with counts
    const seen = new Map(); // cardId → { card, count }
    for (const c of owned) {
      if (seen.has(c.id)) { seen.get(c.id).count++; }
      else                { seen.set(c.id, { card: c, count: 1 }); }
    }

    const choices = [...seen.values()]
      .filter(({ card }) =>
        card.name.toLowerCase().includes(focused) ||
        card.rarity.toLowerCase().includes(focused),
      )
      .slice(0, 25)
      .map(({ card, count }) => {
        const r     = RARITY[card.rarity];
        const price = SELL_PRICE[card.rarity];
        const label = `${card.emoji} ${card.name} (${r.label})${count > 1 ? ` ×${count}` : ''} — ${fmt(price)} coins`;
        return { name: label.slice(0, 100), value: card.id };
      });

    await interaction.respond(choices);
  },

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();

    // ── Collection ───────────────────────────────────────────────────────────
    if (sub === 'collection') {
      const target  = interaction.options.getUser('user') || interaction.user;
      const all     = readJson('cards.json', {});
      const owned   = all[target.id] || [];

      if (owned.length === 0)
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0x9E9E9E)
          .setTitle('🃏  Empty Collection')
          .setDescription(target.id === interaction.user.id
            ? 'You haven\'t grabbed any cards yet!\nKeep chatting — cards drop across all channels.'
            : `<@${target.id}> hasn't collected any cards yet.`)
          .setThumbnail(target.displayAvatarURL({ dynamic: true }))], flags: MessageFlags.Ephemeral });

      const ownedCounts = {};
      for (const card of owned) ownedCounts[card.id] = (ownedCounts[card.id] || 0) + 1;

      const grouped = {};
      for (const card of owned) {
        if (!grouped[card.rarity]) grouped[card.rarity] = [];
        grouped[card.rarity].push(card);
      }
      const summary = Object.entries(RARITY).map(([r, cfg]) => {
        const count = grouped[r]?.length || 0;
        return count > 0 ? `${cfg.emoji} **${cfg.label}:** ${count}` : null;
      }).filter(Boolean).join('  ·  ');

      const imageName  = `card_board_${Date.now()}.png`;
      const boardBuf   = generateCollectionBoard({ catalog: CARD_CATALOG, ownedCounts, title: `${target.username}'s Collection` });
      const attachment = new AttachmentBuilder(boardBuf, { name: imageName });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xE91E63)
        .setDescription(`**${owned.length} cards** collected  ·  **${Object.keys(ownedCounts).length}/${CARD_CATALOG.length}** unique\n${summary}`)
        .setImage(`attachment://${imageName}`)
        .setFooter({ text: 'Use /cards sell to trade duplicates for coins' })
        .setTimestamp()], files: [attachment] });
    }

    // ── Sell ─────────────────────────────────────────────────────────────────
    if (sub === 'sell') {
      const cardId  = interaction.options.getString('card');
      const userId  = interaction.user.id;
      const all     = readJson('cards.json', {});
      const owned   = all[userId] || [];

      const idx = owned.findIndex(c => c.id === cardId);
      if (idx === -1) {
        return interaction.reply({ content: `❌ You don't own a card with that ID. Use \`/cards collection\` to see what you have.`, flags: MessageFlags.Ephemeral });
      }

      const card  = owned[idx];
      const price = SELL_PRICE[card.rarity];
      const cfg   = RARITY[card.rarity];

      // Remove one copy
      owned.splice(idx, 1);
      all[userId] = owned;
      writeJson('cards.json', all);
      addCoins(userId, price);

      // Count remaining copies
      const remaining = owned.filter(c => c.id === cardId).length;

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(cfg.color)
        .setTitle('💰 Card Sold!')
        .setDescription(`You sold **${card.emoji} ${card.name}** for **${fmt(price)} coins**!${remaining > 0 ? `\nYou still have **${remaining}** cop${remaining === 1 ? 'y' : 'ies'}` : '\nThat was your last copy.'}`)
        .addFields(
          { name: `${cfg.emoji} Rarity`, value: `**${cfg.label}**`, inline: true },
          { name: '💰 New Balance',      value: `**${fmt(getBalance(userId))}** coins`, inline: true },
        )
        .setFooter({ text: 'Keep chatting to collect more cards!' })
        .setTimestamp()], flags: MessageFlags.Ephemeral });
    }

    // ── Leaderboard ──────────────────────────────────────────────────────────
    if (sub === 'leaderboard') {
      const all    = readJson('cards.json', {});
      const ranked = Object.entries(all)
        .map(([uid, cards]) => ({
          uid,
          total:     cards.length,
          mythic:    cards.filter(c => c.rarity === 'mythic').length,
          legendary: cards.filter(c => c.rarity === 'legendary').length,
        }))
        .sort((a, b) => b.total - a.total || b.mythic - a.mythic || b.legendary - a.legendary)
        .slice(0, 30);
      const humanIds = new Set(await filterNonBotIds(interaction.client, ranked.map(s => s.uid)));
      const scores = ranked.filter(s => humanIds.has(s.uid)).slice(0, 10);

      if (scores.length === 0)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x9E9E9E).setTitle('🃏 No Cards Yet').setDescription('No one has collected any cards yet!')], flags: MessageFlags.Ephemeral });

      const medals = ['🥇', '🥈', '🥉'];
      const desc = scores.map((s, i) =>
        `${medals[i] || `**${i + 1}.**`} <@${s.uid}> — **${s.total}** cards  ${s.mythic ? `⚜️×${s.mythic}` : ''}${s.legendary ? ` 🟨×${s.legendary}` : ''}`,
      ).join('\n');

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('🃏  Top Card Collectors')
        .setDescription(desc)
        .setFooter({ text: 'Collect cards by grabbing drops in chat!' })
        .setTimestamp()] });
    }
  },
};
