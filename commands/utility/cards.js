'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { addCoins, getBalance }  = require('../../utils/economyManager');
const { CARDS, RARITY, SELL_PRICE } = require('../../utils/cardsManager');

const PAGE_SIZE = 6;
const fmt = n => Number(n).toLocaleString();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cards')
    .setDescription('Collectible trading cards that drop in chat')
    .addSubcommand(sub => sub.setName('collection').setDescription('View your (or someone\'s) card collection')
      .addUserOption(o => o.setName('user').setDescription('Whose collection to view').setRequired(false))
      .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1).setRequired(false)))
    .addSubcommand(sub => sub.setName('sell').setDescription('Sell a card from your collection for coins')
      .addStringOption(o => o.setName('card').setDescription('Card to sell — start typing to search').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName('leaderboard').setDescription('Top card collectors in this server'))
    .addSubcommand(sub => sub.setName('config').setDescription('Configure card drops (admin only)')
      .addStringOption(o => o.setName('setting').setDescription('What to configure').setRequired(true)
        .addChoices(
          { name: '🔢 Set messages between drops', value: 'interval' },
          { name: '📋 View config',                value: 'view' },
        ))
      .addIntegerOption(o => o.setName('interval').setDescription('How many messages before a card drops (10–500)').setMinValue(10).setMaxValue(500).setRequired(false))),

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
    const guildId = interaction.guild.id;

    // ── Collection ───────────────────────────────────────────────────────────
    if (sub === 'collection') {
      const target  = interaction.options.getUser('user') || interaction.user;
      const page    = (interaction.options.getInteger('page') || 1) - 1;
      const all     = readJson('cards.json', {});
      const owned   = all[target.id] || [];

      if (owned.length === 0)
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0x9E9E9E)
          .setTitle('🃏  Empty Collection')
          .setDescription(target.id === interaction.user.id
            ? 'You haven\'t grabbed any cards yet!\nKeep chatting — cards drop across all channels.'
            : `<@${target.id}> hasn't collected any cards yet.`)
          .setThumbnail(target.displayAvatarURL({ dynamic: true }))], ephemeral: true });

      // Group by rarity
      const grouped = {};
      for (const card of owned) {
        if (!grouped[card.rarity]) grouped[card.rarity] = [];
        grouped[card.rarity].push(card);
      }

      const summary = Object.entries(RARITY).map(([r, cfg]) => {
        const count = grouped[r]?.length || 0;
        return count > 0 ? `${cfg.emoji} **${cfg.label}:** ${count}` : null;
      }).filter(Boolean).join('  ·  ');

      const flat       = Object.entries(RARITY).flatMap(([r]) => grouped[r] || []);
      const totalPages = Math.max(1, Math.ceil(flat.length / PAGE_SIZE));
      const safePage   = Math.max(0, Math.min(page, totalPages - 1));
      const slice      = flat.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

      const fields = slice.map(card => {
        const cfg   = RARITY[card.rarity];
        const price = SELL_PRICE[card.rarity];
        const ts    = Math.floor(card.collectedAt / 1000);
        return {
          name:   `${card.emoji} ${card.name}`,
          value:  `${cfg.emoji} **${cfg.label}** ${cfg.stars}\n*${card.desc}*\n📅 <t:${ts}:d>  💰 sells for **${fmt(price)}**`,
          inline: true,
        };
      });

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xE91E63)
        .setTitle(`🃏  ${target.username}'s Collection`)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .setDescription(`**${owned.length} cards** collected\n${summary}\n\u200b`)
        .addFields(fields)
        .setFooter({ text: `Page ${safePage + 1}/${totalPages}  •  Use /cards sell to trade cards for coins` })
        .setTimestamp()] });
    }

    // ── Sell ─────────────────────────────────────────────────────────────────
    if (sub === 'sell') {
      const cardId  = interaction.options.getString('card');
      const userId  = interaction.user.id;
      const all     = readJson('cards.json', {});
      const owned   = all[userId] || [];

      const idx = owned.findIndex(c => c.id === cardId);
      if (idx === -1) {
        return interaction.reply({ content: `❌ You don't own a card with that ID. Use \`/cards collection\` to see what you have.`, ephemeral: true });
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
        .setTimestamp()], ephemeral: true });
    }

    // ── Leaderboard ──────────────────────────────────────────────────────────
    if (sub === 'leaderboard') {
      const all    = readJson('cards.json', {});
      const scores = Object.entries(all)
        .map(([uid, cards]) => ({
          uid,
          total:     cards.length,
          mythic:    cards.filter(c => c.rarity === 'mythic').length,
          legendary: cards.filter(c => c.rarity === 'legendary').length,
        }))
        .sort((a, b) => b.total - a.total || b.mythic - a.mythic || b.legendary - a.legendary)
        .slice(0, 10);

      if (scores.length === 0)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x9E9E9E).setTitle('🃏 No Cards Yet').setDescription('No one has collected any cards yet!')], ephemeral: true });

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

    // ── Config (admin) ───────────────────────────────────────────────────────
    if (sub === 'config') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild))
        return interaction.reply({ content: '❌ You need **Manage Server** to configure card drops.', ephemeral: true });

      const setting = interaction.options.getString('setting');
      const config  = readJson('cards_config.json', {});
      if (!config[guildId]) config[guildId] = { interval: 50 };
      const cfg = config[guildId];
      if (!cfg.interval) cfg.interval = 50;

      if (setting === 'view') {
        return interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0xE91E63)
          .setTitle('🃏  Card Drop Config')
          .setDescription('Cards drop in whichever channel reaches the message count — no single restricted channel.')
          .addFields({ name: '🔢 Drop Interval', value: `Every **${cfg.interval}** messages (per channel)`, inline: false })
          .setFooter({ text: 'Use /cards config interval to change the number' })], ephemeral: true });
      }

      if (setting === 'interval') {
        const interval = interaction.options.getInteger('interval');
        if (!interval) return interaction.reply({ content: '❌ Provide an interval value (10–500).', ephemeral: true });
        cfg.interval = interval;
        config[guildId] = cfg;
        writeJson('cards_config.json', config);
        return interaction.reply({ content: `✅ Card drops set to every **${interval} messages** per channel.`, ephemeral: true });
      }
    }
  },
};
