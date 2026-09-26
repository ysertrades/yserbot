'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { sendTempReply } = require('../../utils/embedBuilder');
const messageStyle = require('../../utils/messageStyle');
const channelLock = require('../../utils/channelLock');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock').setDescription('Lock a channel so only staff can post')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName('channel').setDescription('Channel to lock (defaults to this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
    .addStringOption(o => o.setName('mode').setDescription('How hard to lock')
      .addChoices(
        { name: 'Chat + media', value: 'media' },
        { name: 'Full lockdown', value: 'full' },
      ).setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Reason for locking').setRequired(false)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || null;
    const mode = interaction.options.getString('mode') || 'media';
    const guildId = interaction.guild.id;

    await interaction.deferReply();

    const result = await channelLock.lockChannel(channel, {
      guildId,
      mode,
      reason,
      lockedBy: interaction.user.id,
      lockedByTag: interaction.user.tag,
    });

    if (!result.ok) {
      const msg =
        result.error === 'already_locked' ? `${channel} is already locked. Use \`/unlock\` when ready.` :
        result.error === 'not_text' ? 'Only text or announcement channels can be locked.' :
        'Could not lock this channel — check that I can manage channel permissions.';
      return interaction.editReply({ content: msg });
    }

    const lockPayload = messageStyle.buildPayload(guildId, 'mod.lock', {
      tokens: {
        channel: `${channel}`,
        reason: reason || 'No reason provided',
        user: interaction.user.toString(),
        server: interaction.guild.name,
      },
    }) || { content: `🔒 Locked (${channelLock.MODES[result.mode]?.label || result.mode})` };

    await interaction.editReply(lockPayload);
    try { await channel.send(lockPayload); } catch { /* missing send perms */ }
  },
};
