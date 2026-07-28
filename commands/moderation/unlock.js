'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
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
      return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Not Locked', description: `${channel} is not currently locked.` }, interaction.guild)] });
    }

    await interaction.deferReply();

    try {
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, record.snapshot.everyone, { reason: `Channel unlocked by ${interaction.user.tag}` });
      for (const [roleId, perms] of Object.entries(record.snapshot.roles)) {
        if (!channel.guild.roles.cache.has(roleId)) continue; // role deleted since lock — nothing to restore
        await channel.permissionOverwrites.edit(roleId, perms, { reason: `Channel unlocked by ${interaction.user.tag}` });
      }
    } catch (err) {
      console.error('[UNLOCK]', err);
      return interaction.editReply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Missing permissions to edit this channel\'s overwrites.' }, interaction.guild)] });
    }

    delete locks[guildId][channel.id];
    writeJson(LOCK_FILE, locks);

    const embed = createServerEmbed('success', {
      title: '🔓  Channel Unlocked',
      color: 0x27AE60,
      thumbnail: 'https://twemoji.maxcdn.com/v/latest/72x72/1f513.png',
      description: `${channel} is open again — everyone can send messages.`,
      fields: [{ name: '👮 By', value: `<@${interaction.user.id}>`, inline: true }],
    }, interaction.guild);

    await interaction.editReply({ embeds: [embed] });

    if (channel.id !== interaction.channelId) {
      try {
        await channel.send({ embeds: [createServerEmbed('success', {
          title: '🔓  Channel Unlocked',
          color: 0x27AE60,
          thumbnail: 'https://twemoji.maxcdn.com/v/latest/72x72/1f513.png',
          description: `Unlocked by <@${interaction.user.id}> — everyone can chat again.`,
        }, interaction.guild)] });
      } catch {}
    }
  },
};
