'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');

// QuantLab Phantom palette — purple (#9397EE), not neon green
const BRAND_PURPLE = 0x9397EE;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top members by Quantlab XP'),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({ content: 'Leveling is turned off on this server.', ephemeral: true });
    }

    const ranked = levelingEngine.getLeaderboard(interaction.guild.id, 15);

    if (!ranked.length) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(BRAND_PURPLE)
          .setTitle('XP leaderboard')
          .setDescription('No ranks yet — chat in allowed channels to earn 15–25 XP per message.')],
      });
    }

    const lines = ranked.map((u, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
      return `${medal} <@${u.id}> — Lv **${u.level}** · **${u.totalXp.toLocaleString()}** XP`;
    });

    const embed = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setTitle('XP leaderboard')
      .setDescription(`All-time · Quantlab curve\n\n${lines.join('\n')}`)
      .setFooter({ text: '15–25 XP per message · 60s cooldown' });

    return interaction.reply({ embeds: [embed] });
  },
};
