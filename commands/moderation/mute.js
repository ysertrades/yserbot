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
    const member      = interaction.guild.members.cache.get(user.id);

    if (!member) return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found.' }, interaction.guild)] });

    const ms = parseDuration(durationStr);
    if (!ms || ms > 28 * 24 * 60 * 60 * 1000)
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Error', description: 'Invalid duration. Max 28 days.' }, interaction.guild)] });

    await member.timeout(ms, reason);

    const { id: caseId } = appendCase(interaction.guild.id, {
      type: 'mute', userId: user.id, userTag: user.tag,
      moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason,
      duration: durationStr,
    });

    await dmUser(user, 'mute', interaction.guild, reason, { duration: durationStr, caseId });
    await sendModLog(interaction.guild, 'mute', user, interaction.user, reason, { duration: durationStr, caseId });

    return interaction.reply({
      // How long is the one extra fact that cannot be worked out from
      // anywhere else, so it rides on the same line as the reason.
      embeds: [memberAction({ user, member, action: 'timeout', reason, note: `**For:** ${durationStr}` })],
    });
  },
};
