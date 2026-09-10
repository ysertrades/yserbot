use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { sendTempReply } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

const LOCK_FILE = 'locked_channels.json';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock').setDescription('Unlock a previously locked channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName('channel').setDescription('Channel to unlock (defaults to this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const guildId = interaction.guild.id;

    const locks = readJson(LOCK_FILE, {});
    const record = locks[guildId]?.[channel.id];
    if (!record) {
      return sendTempReply(interaction, {
        content: `${channel} is not locked right now.`,
      });
    }

    await interaction.deferReply();

    try {
      await channel.permissionOverwrites.edit(
        interaction.guild.roles.everyone.id,
        record.snapshot.everyone,
        { reason: `Channel unlocked by ${interaction.user.tag}` },
      );
      for (const [roleId, perms] of Object.entries(record.snapshot.roles || {})) {
        if (!channel.guild.roles.cache.has(roleId)) continue;
        await channel.permissionOverwrites.edit(roleId, perms, {
          reason: `Channel unlocked by ${interaction.user.tag}`,
        });
      }
    } catch (err) {
      console.error('[UNLOCK]', err);
      return interaction.editReply({
        content: 'Could not unlock this channel — check that I can manage channel permissions.',
      });
    }

    delete locks[guildId][channel.id];
    writeJson(LOCK_FILE, locks);

    const msg =
      `🔓 **Channel unlocked**\n` +
      `${channel} is open again.\n` +
      `Everyone can send messages as before.\n` +
      `Unlocked by ${interaction.user}`;

    await interaction.editReply({ content: msg });

    if (channel.id !== interaction.channelId) {
      try {
        await channel.send({ content: msg });
      } catch {}
    }
  },
};
