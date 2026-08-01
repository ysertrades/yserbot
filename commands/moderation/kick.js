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
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found.' }, interaction.guild)] });
    if (member.roles.highest.position >= interaction.member.roles.highest.position)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Cannot kick this user.' }, interaction.guild)] });

    await dmUser(user, 'kick', interaction.guild, reason, {});
    await member.kick(reason);

    // appendCase, not a hand-rolled row: it is the only thing that decides a
    // case number, and two of them deciding separately is how two cases end
    // up claiming to be the same one.
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
