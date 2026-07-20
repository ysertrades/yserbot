'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { sendModLog, dmUser } = require('../../utils/modLog');

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

    if (!member) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found.' }, interaction.guild)], ephemeral: true });
    if (member.roles.highest.position >= interaction.member.roles.highest.position)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Cannot kick this user.' }, interaction.guild)], ephemeral: true });

    await dmUser(user, 'kick', interaction.guild, reason, {});
    await member.kick(reason);

    const cases = readJson('cases.json', {});
    const guildCases = cases[interaction.guild.id] || [];
    const caseId = guildCases.length + 1;
    guildCases.push({ id: caseId, type: 'kick', userId: user.id, userTag: user.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, timestamp: Date.now() });
    cases[interaction.guild.id] = guildCases;
    writeJson('cases.json', cases);

    await sendModLog(interaction.guild, 'kick', user, interaction.user, reason, { caseId });

    return interaction.reply({
      embeds: [createServerEmbed('success', {
        title: '👢 User Kicked',
        description: `<@${user.id}> has been kicked.`,
        fields: [{ name: '📋 Reason', value: reason }, { name: '🗂️ Case', value: `#${caseId}`, inline: true }],
      }, interaction.guild)],
    });
  },
};
