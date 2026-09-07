'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('newsfeed')
    .setDescription('(Retired) Live market news feed has been removed.'),
  async execute(interaction) {
    await interaction.reply({
      content: 'The Financial Juice live news feed has been removed. Use **Feeds → Economic calendar** for releases.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
