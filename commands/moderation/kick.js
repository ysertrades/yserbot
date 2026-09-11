'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { sendModLog, dmUser } = require('../../utils/modLog');
const { memberAction } = require('../../utils/modEmbed');
const { appendCase } = require('../../utils/modActions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick').setDescription('Kick a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    let member   = interaction.guild.members.cache.get(user.id);
    if (!member) {
      try { member = await interaction.guild.members.fetch(user.id); } catch { member = null; }
    }

    if (!member) return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found.' }, interaction.guild)] });
    if (member.id === interaction.guild.ownerId)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Cannot kick the server owner.' }, interaction.guild)] });
    if (member.roles.highest.position >= interaction.member.roles.highest.position)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Cannot kick this user.' }, interaction.guild)] });
    const me = interaction.guild.members.me;
    if (me && member.roles.highest.position >= me.roles.highest.position)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'My role is not high enough to kick that user.' }, interaction.guild)] });

    await dmUser(user, 'kick', interaction.guild, reason, {});
    try {
      await member.kick(reason);
    } catch (err) {
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Could not kick that user. Check my permissions and role order.' }, interaction.guild)] });
    }

    const { id: caseId } = appendCase(interaction.guild.id, {
      type: 'kick', userId: user.id, userTag: user.tag,
      moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason,
    });

    await sendModLog(interaction.guild, 'kick', user, interaction.user, reason, { caseId });

    return interaction.reply({
      embeds: [memberAction({ guild: interaction.guild, user, member, action: 'kick', reason })],
    });
  },
};
