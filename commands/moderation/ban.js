'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { sendModLog, dmUser } = require('../../utils/modLog');

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
    const member = interaction.guild.members.cache.get(user.id);

    if (member && member.roles.highest.position >= interaction.member.roles.highest.position)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Cannot ban this user.' }, interaction.guild)], ephemeral: true });

    // DM before ban (they get kicked so DM first)
    await dmUser(user, 'ban', interaction.guild, reason, {});

    await interaction.guild.members.ban(user.id, { deleteMessageDays: days, reason });

    const cases = readJson('cases.json', {});
    const guildCases = cases[interaction.guild.id] || [];
    const caseId = guildCases.length + 1;
    guildCases.push({ id: caseId, type: 'ban', userId: user.id, userTag: user.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, timestamp: Date.now() });
    cases[interaction.guild.id] = guildCases;
    writeJson('cases.json', cases);

    await sendModLog(interaction.guild, 'ban', user, interaction.user, reason, { caseId });

    return interaction.reply({
      embeds: [createServerEmbed('success', {
        title: '🔨 User Banned',
        description: `<@${user.id}> has been banned.`,
        fields: [{ name: '📋 Reason', value: reason }, { name: '🗂️ Case', value: `#${caseId}`, inline: true }],
      }, interaction.guild)],
    });
  },
};
