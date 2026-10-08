'use strict';
const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('newsfeed')
    .setDescription('Live Financial Juice news — configure in Control Panel → Feeds.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    await interaction.reply({
      content: 'Configure **Live market news** under Control Panel → **Feeds**. Headlines post as Components V2 cards with Financial Juice images.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
