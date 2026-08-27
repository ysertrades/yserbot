'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { sendModLog } = require('../../utils/modLog');
const { memberAction } = require('../../utils/modEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban').setDescription('Unban a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('userid').setDescription('User ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    const userId = interaction.options.getString('userid');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Three calls to Discord — look the user up, lift the ban, write the log
    // — all before the first reply. Usually under a second, but a rate limit
    // on any of them is enough to lose the interaction entirely.
    await interaction.deferReply();

    try {
      const user = await interaction.client.users.fetch(userId);
      await interaction.guild.members.unban(userId, reason);
      await sendModLog(interaction.guild, 'unban', user, interaction.user, reason, {});

      return interaction.editReply({
        embeds: [memberAction({ guild: interaction.guild, user, action: 'unban', reason })],
      });
    } catch {
      // editReply rather than sendTempReply: the interaction is already
      // acknowledged, so a fresh reply would be refused. It still clears
      // itself the way the old transient error did — a failed unban is not a
      // record worth keeping in the channel.
      await interaction.editReply({
        embeds: [createServerEmbed('error', { title: 'Error', description: 'Failed to unban. Make sure the ID is correct.' }, interaction.guild)],
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return null;
    }
  },
};
