'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { readJson, writeJson } = require('../../utils/jsonStorage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cardsettings')
    .setDescription('Configure trading card drops (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('setting').setDescription('What to configure').setRequired(true)
      .addChoices(
        { name: '🔢 Set messages between drops', value: 'interval' },
        { name: '📋 View config',                value: 'view' },
      ))
    .addIntegerOption(o => o.setName('interval').setDescription('How many messages before a card drops (10–500)').setMinValue(10).setMaxValue(500).setRequired(false)),

  async execute(interaction) {
    const guildId  = interaction.guild.id;
    const setting  = interaction.options.getString('setting');
    const config   = readJson('cards_config.json', {});
    if (!config[guildId]) config[guildId] = { interval: 50 };
    const cfg = config[guildId];
    if (!cfg.interval) cfg.interval = 50;

    if (setting === 'view') {
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xE91E63)
        .setTitle('🃏  Card Drop Config')
        .setDescription('Cards drop in whichever channel reaches the message count — no single restricted channel.')
        .addFields({ name: '🔢 Drop Interval', value: `Every **${cfg.interval}** messages (per channel)`, inline: false })
        .setFooter({ text: 'Use /cardsettings setting:Set messages between drops to change the number' })], ephemeral: true });
    }

    if (setting === 'interval') {
      const interval = interaction.options.getInteger('interval');
      if (!interval) return interaction.reply({ content: '❌ Provide an interval value (10–500).', ephemeral: true });
      cfg.interval = interval;
      config[guildId] = cfg;
      writeJson('cards_config.json', config);
      return interaction.reply({ content: `✅ Card drops set to every **${interval} messages** per channel.`, ephemeral: true });
    }
  },
};
