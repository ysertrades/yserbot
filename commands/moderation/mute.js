'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { sendModLog, dmUser } = require('../../utils/modLog');
const { parseDuration } = require('../../utils/duration');
const { memberAction } = require('../../utils/modEmbed');
const { appendCase } = require('../../utils/modActions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute').setDescription('Timeout a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('e.g. 10m, 1h, 1d').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    const user        = interaction.options.getUser('user');
    const durationStr = interaction.options.getString('duration');
    const reason      = interaction.options.getString('reason') || 'No reason provided';
    let member        = interaction.guild.members.cache.get(user.id);
    if (!member) {
      try { member = await interaction.guild.members.fetch(user.id); } catch { member = null; }
    }

    if (!member) return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found.' }, interaction.guild)] });
    if (member.id === interaction.guild.ownerId)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Cannot timeout the server owner.' }, interaction.guild)] });
    if (member.roles.highest.position >= interaction.member.roles.highest.position)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Cannot timeout this user.' }, interaction.guild)] });
    const me = interaction.guild.members.me;
    if (me && member.roles.highest.position >= me.roles.highest.position)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'My role is not high enough to timeout that user.' }, interaction.guild)] });

    const ms = parseDuration(durationStr);
    if (!ms || ms > 28 * 24 * 60 * 60 * 1000)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Invalid duration. Max 28 days.' }, interaction.guild)] });

    try {
      await member.timeout(ms, reason);
    } catch (err) {
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Could not timeout that user. Check my permissions and role order.' }, interaction.guild)] });
    }

    const { id: caseId } = appendCase(interaction.guild.id, {
      type: 'mute', userId: user.id, userTag: user.tag,
      moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason,
      duration: durationStr,
    });

    await dmUser(user, 'mute', interaction.guild, reason, { duration: durationStr, caseId });
    await sendModLog(interaction.guild, 'mute', user, interaction.user, reason, { duration: durationStr, caseId });

    return interaction.reply({
      embeds: [memberAction({ guild: interaction.guild, user, member, action: 'timeout', reason, tokens: { duration: durationStr } })],
    });
  },
};
