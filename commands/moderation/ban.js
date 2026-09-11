'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { sendModLog, dmUser } = require('../../utils/modLog');
const { memberAction } = require('../../utils/modEmbed');
const { appendCase } = require('../../utils/modActions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban').setDescription('Ban a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    .addIntegerOption(o => o.setName('days').setDescription('Delete messages (0-7)').setMinValue(0).setMaxValue(7).setRequired(false)),

  async execute(interaction) {
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const days   = interaction.options.getInteger('days') || 0;
    let member   = interaction.guild.members.cache.get(user.id);
    if (!member) {
      try { member = await interaction.guild.members.fetch(user.id); } catch { member = null; }
    }

    if (user.id === interaction.guild.ownerId)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Cannot ban the server owner.' }, interaction.guild)] });
    if (member && member.roles.highest.position >= interaction.member.roles.highest.position)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Cannot ban this user.' }, interaction.guild)] });
    const me = interaction.guild.members.me;
    if (member && me && member.roles.highest.position >= me.roles.highest.position)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'My role is not high enough to ban that user.' }, interaction.guild)] });

    await dmUser(user, 'ban', interaction.guild, reason, {});

    try {
      await interaction.guild.members.ban(user.id, {
        deleteMessageSeconds: days * 24 * 60 * 60,
        reason,
      });
    } catch (err) {
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Could not ban that user. Check my permissions and role order.' }, interaction.guild)] });
    }

    const { id: caseId } = appendCase(interaction.guild.id, {
      type: 'ban', userId: user.id, userTag: user.tag,
      moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason,
    });

    await sendModLog(interaction.guild, 'ban', user, interaction.user, reason, { caseId });

    return interaction.reply({
      embeds: [memberAction({ guild: interaction.guild, user, member, action: 'ban', reason })],
    });
  },
};
