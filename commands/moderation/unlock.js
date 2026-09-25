'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { sendTempReply } = require('../../utils/embedBuilder');
const messageStyle = require('../../utils/messageStyle');
const channelLock = require('../../utils/channelLock');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock').setDescription('Unlock a previously locked channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName('channel').setDescription('Channel to unlock (defaults to this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const guildId = interaction.guild.id;

    await interaction.deferReply();

    const result = await channelLock.unlockChannel(channel, {
      guildId,
      unlockedByTag: interaction.user.tag,
    });

    if (!result.ok) {
      const msg =
        result.error === 'not_locked' ? `${channel} is not locked right now.` :
        'Could not unlock this channel — check that I can manage channel permissions.';
      return interaction.editReply({ content: msg });
    }

    const unlockPayload = messageStyle.buildPayload(guildId, 'mod.unlock', {
      tokens: {
        channel: `${channel}`,
        user: interaction.user.toString(),
        server: interaction.guild.name,
      },
    }) || { content: '🔓 Unlocked' };

    await interaction.editReply(unlockPayload);
    try { await channel.send(unlockPayload); } catch {}
  },
};
