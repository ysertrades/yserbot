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
    .addSubcommand(s => s.setName('status').setDescription('Show the current news feed configuration'))
    .addSubcommand(s => s.setName('filter-mode').setDescription('Choose how the keyword filter is applied')
      .addStringOption(o => o.setName('mode').setDescription('Filter mode').setRequired(true)
        .addChoices(
          { name: 'Off — post everything', value: 'off' },
          { name: 'Block-list — skip headlines matching a keyword', value: 'block' },
          { name: 'Allow-list — only post headlines matching a keyword', value: 'allow' },
        )))
    .addSubcommand(s => s.setName('filter-add').setDescription('Add a keyword to the filter list')
      .addStringOption(o => o.setName('word').setDescription('Word or phrase to match against the headline/body').setRequired(true)))
    .addSubcommand(s => s.setName('filter-remove').setDescription('Remove a keyword from the filter list')
      .addStringOption(o => o.setName('word').setDescription('Word or phrase to remove').setRequired(true)))
    .addSubcommand(s => s.setName('filter-list').setDescription('View the current filter mode and keyword list')),

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

    if (sub === 'filter-mode') {
      const mode = interaction.options.getString('mode');
      const existing = getNewsFeedSettings(guildId);
      setNewsFeedSettings(guildId, { filterMode: mode });
      const labels = { off: 'Off — every headline is posted', block: 'Block-list — headlines matching a keyword are skipped', allow: 'Allow-list — only headlines matching a keyword are posted' };
      let description = labels[mode];
      if (mode === 'allow' && existing.filterWords.length === 0) {
        description += '\n\n⚠️ No keywords added yet — with an empty allow-list everything still posts. Add some with `/newsfeed filter-add`.';
      }
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '📰 Filter Mode Updated', description }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'filter-add') {
      const word = interaction.options.getString('word').trim().toLowerCase();
      if (!word) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid', description: 'Word cannot be empty.' }, interaction.guild)], ephemeral: true });
      const settings = getNewsFeedSettings(guildId);
      if (settings.filterWords.includes(word)) {
        return interaction.reply({ embeds: [createServerEmbed('info', { title: 'Already Added', description: `\`${word}\` is already in the filter list.` }, interaction.guild)], ephemeral: true });
      }
      setNewsFeedSettings(guildId, { filterWords: [...settings.filterWords, word] });
      const modeNote = settings.filterMode === 'off' ? '\n\n⚠️ Filter mode is currently **Off** — run `/newsfeed filter-mode` to turn block-list or allow-list filtering on.' : '';
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '✅ Keyword Added', description: `\`${word}\` added to the filter list.${modeNote}` }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'filter-remove') {
      const word     = interaction.options.getString('word').trim().toLowerCase();
      const settings = getNewsFeedSettings(guildId);
      if (!settings.filterWords.includes(word)) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Found', description: `\`${word}\` isn't in the filter list.` }, interaction.guild)], ephemeral: true });
      }
      setNewsFeedSettings(guildId, { filterWords: settings.filterWords.filter(w => w !== word) });
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '🗑️ Keyword Removed', description: `\`${word}\` removed from the filter list.` }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'filter-list') {
      const settings = getNewsFeedSettings(guildId);
      const modeLabels = { off: 'Off', block: 'Block-list', allow: 'Allow-list' };
      return interaction.reply({ embeds: [createServerEmbed('info', {
        title: '📰 News Feed Filter',
        description:
          `**Mode:** ${modeLabels[settings.filterMode] ?? 'Off'}\n` +
          `**Keywords (${settings.filterWords.length}):** ${settings.filterWords.length ? settings.filterWords.map(w => `\`${w}\``).join(', ') : '— none —'}`,
      }, interaction.guild)], ephemeral: true });
    }

    // status
    const settings   = getNewsFeedSettings(guildId);
    const channel    = settings.channelId ? interaction.guild.channels.cache.get(settings.channelId) : null;
    const modeLabels = { off: 'Off', block: 'Block-list', allow: 'Allow-list' };
    return interaction.reply({ embeds: [createServerEmbed('info', {
      title: '📰 News Feed Status',
      description:
        `**State:** ${settings.enabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
        `**Channel:** ${channel ? `${channel}` : '— Not set —'}\n` +
        `**Filter:** ${modeLabels[settings.filterMode] ?? 'Off'} (${settings.filterWords.length} keyword${settings.filterWords.length === 1 ? '' : 's'})\n` +
        `**Source:** Financial Juice (live, ~20s polling)`,
    }, interaction.guild)], ephemeral: true });
  },
};
