'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { clearWarnings } = require('../../utils/modActions');
const { memberAction } = require('../../utils/modEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearwarnings').setDescription('Clear all warnings for a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('User to clear').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    // Through modActions rather than editing cases.json here: it marks the
    // warnings cleared instead of deleting them, which keeps the history and
    // stops a later case reusing a number that has already been handed out.
    const before = clearWarnings(interaction.guild.id, user.id);

    return interaction.reply({
      embeds: [memberAction({
        user, member: interaction.guild.members.cache.get(user.id),
        action: 'warnclear',
        note: `**Cleared:** ${before} warning${before !== 1 ? 's' : ''}`,
      })],
      flags: MessageFlags.Ephemeral,
    });
  },
};
