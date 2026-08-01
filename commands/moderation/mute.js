'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { sendModLog, dmUser } = require('../../utils/modLog');
const { parseDuration } = require('../../utils/duration');

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

    const cases = readJson('cases.json', {});
    const guildCases = cases[interaction.guild.id] || [];
    const caseId = guildCases.length + 1;
    guildCases.push({ id: caseId, type: 'mute', userId: user.id, userTag: user.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, duration: durationStr, timestamp: Date.now() });
    cases[interaction.guild.id] = guildCases;
    writeJson('cases.json', cases);

    await dmUser(user, 'mute', interaction.guild, reason, { duration: durationStr, caseId });
    await sendModLog(interaction.guild, 'mute', user, interaction.user, reason, { duration: durationStr, caseId });

    return interaction.reply({
      embeds: [createServerEmbed('success', {
        title: '🔇 User Timed Out',
        description: `<@${user.id}> has been timed out for **${durationStr}**.`,
        fields: [{ name: '📋 Reason', value: reason }, { name: '🗂️ Case', value: `#${caseId}`, inline: true }],
      }, interaction.guild)],
    });
  },
};
