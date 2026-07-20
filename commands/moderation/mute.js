'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { sendModLog, dmUser } = require('../../utils/modLog');

function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  return parseInt(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
}

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

    if (!member) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found.' }, interaction.guild)], ephemeral: true });

    const ms = parseDuration(durationStr);
    if (!ms || ms > 28 * 24 * 60 * 60 * 1000)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Invalid duration. Max 28 days.' }, interaction.guild)], ephemeral: true });

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
