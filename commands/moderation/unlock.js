'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
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
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Locked', description: `${channel} is not currently locked.` }, interaction.guild)], ephemeral: true });
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
      title: '🔓 Channel Unlocked',
      description: `${channel} has been unlocked. Everyone can send messages again.`,
      fields: [{ name: '👮 Unlocked By', value: `<@${interaction.user.id}>`, inline: true }],
    }, interaction.guild);

    await interaction.editReply({ embeds: [embed] });

    if (channel.id !== interaction.channelId) {
      try {
        await channel.send({ embeds: [createServerEmbed('success', { title: '🔓 Channel Unlocked', description: `This channel has been unlocked by <@${interaction.user.id}>.` }, interaction.guild)] });
      } catch {}
    }
  },
};
