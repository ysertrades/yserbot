'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { sendModLog } = require('../../utils/modLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban').setDescription('Unban a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('userid').setDescription('User ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    const userId = interaction.options.getString('userid');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    try {
      const user = await interaction.client.users.fetch(userId);
      await interaction.guild.members.unban(userId, reason);
      await sendModLog(interaction.guild, 'unban', user, interaction.user, reason, {});

      return interaction.reply({
        embeds: [createServerEmbed('success', {
          title: '🔓 User Unbanned',
          description: `<@${userId}> (\`${user.tag}\`) has been unbanned.`,
          fields: [{ name: '📋 Reason', value: reason }],
        }, interaction.guild)],
      });
    } catch {
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Failed to unban. Make sure the ID is correct.' }, interaction.guild)], ephemeral: true });
    }
  },
};
