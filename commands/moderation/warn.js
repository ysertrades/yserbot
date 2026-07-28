'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { issueWarning } = require('../../utils/warnUtil');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn').setDescription('Warn a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found in this server.' }, interaction.guild)], ephemeral: true });
    if (member.roles.highest.position >= interaction.member.roles.highest.position)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'You cannot warn this user.' }, interaction.guild)], ephemeral: true });

    const { caseId, warnCount, autoPunish } = await issueWarning(interaction.guild, interaction.user, user, member, reason);

    // Public reply
    await interaction.reply({
      embeds: [createServerEmbed('success', {
        title: '⚠️ Warning Issued',
        description: `<@${user.id}> has been warned.`,
        fields: [
          { name: '📋 Reason',       value: reason,            inline: false },
          { name: '🗂️ Case',         value: `#${caseId}`,      inline: true  },
          { name: '📊 Total Warns',  value: `${warnCount}`,    inline: true  },
        ],
      }, interaction.guild)],
    });

    if (autoPunish) {
      await interaction.followUp({
        embeds: [createServerEmbed('info', {
          title: `🤖 Auto-Punishment: ${autoPunish.action.toUpperCase()}`,
          description: `<@${user.id}> was automatically ${autoPunish.action}ed after reaching **${autoPunish.threshold}** warnings.`,
        }, interaction.guild)],
      });
    }
  },
};
