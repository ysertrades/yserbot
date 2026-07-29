'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { getNewsFeedSettings, setNewsFeedSettings } = require('../../utils/modConfig');
const { TOPICS } = require('../../utils/newsTopics');

function buildTopicsPanel(guild, settings) {
  const selected = new Set(settings.filterTopics);
  const embed = createServerEmbed('info', {
    title: '📰 News Topics',
    description:
      'Pick the topics you want — no need to know keywords, each one is a pre-built bundle grounded in real Financial Juice headlines.\n\n' +
      TOPICS.map(t => `${t.emoji} **${t.label}** — ${t.description}${selected.has(t.key) ? ' ✅' : ''}`).join('\n') +
      `\n\n${selected.size ? '**Only headlines matching a picked topic will be sent.**' : 'Nothing picked yet — every headline is sent. Pick topics to narrow it down.'}`,
  }, guild);

  const menu = new StringSelectMenuBuilder()
    .setCustomId('newsfeed_topics_select')
    .setPlaceholder('Select topics…')
    .setMinValues(0)
    .setMaxValues(TOPICS.length)
    .addOptions(TOPICS.map(t => new StringSelectMenuOptionBuilder()
      .setLabel(`${t.emoji} ${t.label}`)
      .setDescription(t.description)
      .setValue(t.key)
      .setDefault(selected.has(t.key))));

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('newsfeed').setDescription('Post live Financial Juice market news headlines to a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('enable').setDescription('Start posting live news headlines to a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post headlines in').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('disable').setDescription('Stop posting news headlines'))
    .addSubcommand(s => s.setName('status').setDescription('Show the current news feed configuration'))
    .addSubcommand(s => s.setName('topics').setDescription('Pick which topics get sent — only picked topics are posted')),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel');
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
        return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Missing Permissions', description: `I need **Send Messages** and **Embed Links** in ${channel} to post news there.` }, interaction.guild)] });
      }
      // Reset lastGuid so we establish a fresh baseline instead of replaying
      // whatever backlog built up while it was off / pointed elsewhere.
      setNewsFeedSettings(guildId, { enabled: true, channelId: channel.id, lastGuid: null });
      return sendTempReply(interaction, { embeds: [createServerEmbed('success', {
        title: '📰 News Feed Enabled',
        description: `Live Financial Juice market headlines will now be posted to ${channel} as they're published (checked every ~20s). Use \`/newsfeed topics\` to pick specific topics.`,
      }, interaction.guild)] });
    }

    if (sub === 'disable') {
      const settings = getNewsFeedSettings(guildId);
      if (!settings.enabled) {
        return sendTempReply(interaction, { embeds: [createServerEmbed('info', { title: 'Already Off', description: 'The news feed is not currently enabled.' }, interaction.guild)] });
      }
      setNewsFeedSettings(guildId, { enabled: false });
      return sendTempReply(interaction, { embeds: [createServerEmbed('success', { title: '📰 News Feed Disabled', description: 'Headline posting has been turned off.' }, interaction.guild)] });
    }

    if (sub === 'topics') {
      const settings = getNewsFeedSettings(guildId);
      return interaction.reply({ ...buildTopicsPanel(interaction.guild, settings), flags: MessageFlags.Ephemeral });
    }

    // status
    const settings = getNewsFeedSettings(guildId);
    const channel   = settings.channelId ? interaction.guild.channels.cache.get(settings.channelId) : null;
    const topicLabels = settings.filterTopics.map(key => TOPICS.find(t => t.key === key)?.label).filter(Boolean);
    return interaction.reply({ embeds: [createServerEmbed('info', {
      title: '📰 News Feed Status',
      description:
        `**State:** ${settings.enabled ? '🟢 Enabled' : '🔴 Disabled'}\n` +
        `**Channel:** ${channel ? `${channel}` : '— Not set —'}\n` +
        `**Topics:** ${topicLabels.length ? topicLabels.join(', ') : 'All (none picked) — narrow it down with `/newsfeed topics`'}\n` +
        `**Source:** Financial Juice (live, ~20s polling)`,
    }, interaction.guild)], flags: MessageFlags.Ephemeral });
  },

  // ── Topics select menu ──────────────────────────────────────────────────
  async handleTopicsSelect(interaction) {
    const guildId = interaction.guild.id;
    setNewsFeedSettings(guildId, { filterTopics: interaction.values });
    const settings = getNewsFeedSettings(guildId);
    return interaction.update(buildTopicsPanel(interaction.guild, settings));
  },
};
