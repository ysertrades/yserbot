'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { sendModLog, dmUser } = require('../../utils/modLog');
const { memberAction } = require('../../utils/modEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute').setDescription('Remove timeout from a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    // The interaction carries the member; the cache alone missed anyone the
    // bot had not seen recently, so they could not be unmuted.
    const member = interaction.options.getMember('user')
      || await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found.' }, interaction.guild)] });

    // A refused timeout (role order, missing permission) used to throw out of
    // the command unanswered — "The application did not respond".
    try {
      await member.timeout(null, reason);
    } catch (err) {
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Could not remove the timeout. Check my permissions and role order.' }, interaction.guild)] });
    }
    await dmUser(user, 'unmute', interaction.guild, reason, {});
    await sendModLog(interaction.guild, 'unmute', user, interaction.user, reason, {});

    return interaction.reply({
      embeds: [memberAction({ guild: interaction.guild, user, member, action: 'unmute', reason })],
    });
  },
};
