'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { sendModLog, dmUser } = require('../../utils/modLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute').setDescription('Remove timeout from a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found.' }, interaction.guild)], ephemeral: true });

    await member.timeout(null, reason);
    await dmUser(user, 'unmute', interaction.guild, reason, {});
    await sendModLog(interaction.guild, 'unmute', user, interaction.user, reason, {});

    return interaction.reply({
      embeds: [createServerEmbed('success', {
        title: '🔊 Timeout Removed',
        description: `<@${user.id}>'s timeout has been removed.`,
        fields: [{ name: '📋 Reason', value: reason }],
      }, interaction.guild)],
    });
  },
};
