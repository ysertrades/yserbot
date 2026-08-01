'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { issueWarning } = require('../../utils/warnUtil');
const { memberAction } = require('../../utils/modEmbed');

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

    if (!member) return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found in this server.' }, interaction.guild)] });
    if (member.roles.highest.position >= interaction.member.roles.highest.position)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'You cannot warn this user.' }, interaction.guild)] });

    const { autoPunish } = await issueWarning(interaction.guild, interaction.user, user, member, reason);

    // Public reply
    // The case number and the running total live in the mod log and in
    // /warnings; repeating them here is what made this card three times the
    // height of the thing it was announcing.
    await interaction.reply({
      embeds: [memberAction({ user, member, action: 'warn', reason })],
    });

    if (autoPunish) {
      await interaction.followUp({
        embeds: [memberAction({
          user, member, action: autoPunish.action,
          reason: `reached ${autoPunish.threshold} warnings`,
        })],
      });
    }
  },
};
