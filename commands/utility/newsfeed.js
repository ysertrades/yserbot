'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { getNewsFeedSettings, setNewsFeedSettings } = require('../../utils/modConfig');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('newsfeed').setDescription('Post live Financial Juice market news headlines to a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('enable').setDescription('Start posting live news headlines to a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post headlines in').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('disable').setDescription('Stop posting news headlines'))
    .addSubcommand(s => s.setName('status').setDescription('Show the current news feed configuration')),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel');
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Missing Permissions', description: `I need **Send Messages** and **Embed Links** in ${channel} to post news there.` }, interaction.guild)], ephemeral: true });
      }
      // Reset lastGuid so we establish a fresh baseline instead of replaying
      // whatever backlog built up while it was off / pointed elsewhere.
      setNewsFeedSettings(guildId, { enabled: true, channelId: channel.id, lastGuid: null });
      return interaction.reply({ embeds: [createServerEmbed('success', {
        title: '📰 News Feed Enabled',
        description: `Live Financial Juice market headlines will now be posted to ${channel} as they're published (checked every ~20s).`,
      }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'disable') {
      const settings = getNewsFeedSettings(guildId);
      if (!settings.enabled) {
        return interaction.reply({ embeds: [createServerEmbed('info', { title: 'Already Off', description: 'The news feed is not currently enabled.' }, interaction.guild)], ephemeral: true });
      }
      setNewsFeedSettings(guildId, { enabled: false });
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '📰 News Feed Disabled', description: 'Headline posting has been turned off.' }, interaction.guild)], ephemeral: true });
    }

    // status
    const settings = getNewsFeedSettings(guildId);
    const channel  = settings.channelId ? interaction.guild.channels.cache.get(settings.channelId) : null;
    return interaction.reply({ embeds: [createServerEmbed('info', {
      title: '📰 News Feed Status',
      description:
        `**State:** ${settings.enabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
        `**Channel:** ${channel ? `${channel}` : '— Not set —'}\n` +
        `**Source:** Financial Juice (live, ~20s polling)`,
    }, interaction.guild)], ephemeral: true });
  },
};
