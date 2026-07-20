'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearwarnings').setDescription('Clear all warnings for a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('User to clear').setRequired(true)),

  async execute(interaction) {
    const user       = interaction.options.getUser('user');
    const cases      = readJson('cases.json', {});
    const guildCases = cases[interaction.guild.id] || [];
    const before     = guildCases.filter(c => c.type === 'warn' && c.userId === user.id).length;

    cases[interaction.guild.id] = guildCases.filter(c => !(c.type === 'warn' && c.userId === user.id));
    writeJson('cases.json', cases);

    return interaction.reply({
      embeds: [createServerEmbed('success', {
        title: '🗑️ Warnings Cleared',
        description: `Cleared **${before}** warning${before !== 1 ? 's' : ''} from <@${user.id}>.`,
      }, interaction.guild)],
      ephemeral: true,
    });
  },
};
