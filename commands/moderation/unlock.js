'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { generateLockToggleImage } = require('../../utils/lockVisual');

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

    const imageName  = `unlock_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateLockToggleImage({ locked: false, channelName: channel.name, reason: null }), { name: imageName });
    const embed = new EmbedBuilder().setImage(`attachment://${imageName}`);

    await interaction.editReply({ embeds: [embed], files: [attachment] });

    if (channel.id !== interaction.channelId) {
      try {
        const otherImageName  = `unlock_${Date.now()}.png`;
        const otherAttachment = new AttachmentBuilder(generateLockToggleImage({ locked: false, channelName: channel.name, reason: null }), { name: otherImageName });
        await channel.send({ embeds: [new EmbedBuilder().setImage(`attachment://${otherImageName}`)], files: [otherAttachment] });
      } catch {}
    }
  },
};
