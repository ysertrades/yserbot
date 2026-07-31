'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// /newsfeed — one command, one panel. Enable/disable, pick the channel and
// filter topics, all from the same message rather than four separate
// subcommands.
//
// Buttons carry the opener's id and are checked, so a bystander can't
// reconfigure a panel someone else opened.
// ─────────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { getNewsFeedSettings, setNewsFeedSettings } = require('../../utils/modConfig');
const { TOPICS } = require('../../utils/newsTopics');
const { listSources } = require('../../utils/newsFeed');
const { generateNewsfeedPanelImage } = require('../../utils/newsfeedPanelVisual');

const NEWS_BLUE = 0x1D9BF0;

function cadenceLabel(pollMs) {
  return pollMs >= 60_000 ? `every ${Math.round(pollMs / 60_000)}m` : `every ${Math.round(pollMs / 1000)}s`;
}

function topicsLabel(settings) {
  const picked = settings.filterTopics || [];
  if (picked.length === 0 || picked.length >= TOPICS.length) return 'All topics';
  return picked.map(k => TOPICS.find(t => t.key === k)?.label).filter(Boolean).join(', ');
}

function activeSources(settings) {
  return Array.isArray(settings.sources) ? settings.sources : ['financialjuice'];
}

// ── Main panel ───────────────────────────────────────────────────────────────

function buildPanel(guild, ownerId) {
  const settings = getNewsFeedSettings(guild.id);
  const channel  = settings.channelId ? guild.channels.cache.get(settings.channelId) : null;
  const active   = activeSources(settings);

  const imageName  = `newsfeed_panel_${Date.now()}.png`;
  const attachment = new AttachmentBuilder(generateNewsfeedPanelImage({
    enabled: settings.enabled,
    channelName: channel?.name ?? null,
    sources: listSources().map(s => ({
      key: s.key, label: s.label, blurb: s.blurb,
      active: active.includes(s.key), cadence: cadenceLabel(s.pollMs),
    })),
    topicsLabel: topicsLabel(settings),
  }), { name: imageName });

  // The image carries the whole status; the description only holds what it
  // can't — a live channel mention that stays clickable.
  const embed = new EmbedBuilder()
    .setColor(NEWS_BLUE)
    .setImage(`attachment://${imageName}`)
    .setDescription(channel ? `Posting to ${channel}` : '⚠️ No channel set yet — pick one below to start.');

  const canRun = Boolean(settings.channelId);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`nf:toggle:${ownerId}`)
        .setLabel(settings.enabled ? 'Pause Feed' : 'Start Feed')
        .setEmoji(settings.enabled ? '⏸️' : '▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canRun),
      new ButtonBuilder().setCustomId(`nf:channel:${ownerId}`).setLabel('Channel').setEmoji('📢').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`nf:topics:${ownerId}`).setLabel('Topics').setEmoji('🎯').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`nf:close:${ownerId}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embeds: [embed], files: [attachment], components: rows };
}

// ── Sub-screens ──────────────────────────────────────────────────────────────


function buildTopicsView(guild, ownerId) {
  const settings = getNewsFeedSettings(guild.id);
  const selected = new Set(settings.filterTopics || []);

  const embed = createServerEmbed('info', {
    title: '🎯  News Topics',
    description:
      'Pick the topics you want — each one is a pre-built keyword bundle, no need to know the keywords yourself.\n\n' +
      TOPICS.map(t => `${t.emoji} **${t.label}** — ${t.description}${selected.has(t.key) ? ' ✅' : ''}`).join('\n') +
      `\n\n${selected.size ? '**Only headlines matching a picked topic are sent.**' : 'Nothing picked — every headline is sent. Pick topics to narrow it down.'}`,
  }, guild);

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`nf_topics_select:${ownerId}`)
    .setPlaceholder('Select topics…')
    .setMinValues(0)
    .setMaxValues(TOPICS.length)
    .addOptions(TOPICS.map(t => new StringSelectMenuOptionBuilder()
      .setLabel(`${t.emoji} ${t.label}`)
      .setDescription(t.description.slice(0, 100))
      .setValue(t.key)
      .setDefault(selected.has(t.key))));

  return {
    embeds: [embed],
    files: [],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nf:panel:${ownerId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildChannelView(guild, ownerId) {
  const embed = createServerEmbed('info', {
    title: '📢  Post Headlines In…',
    description: 'Choose the channel headlines get posted to. I need **Send Messages** and **Embed Links** there.',
  }, guild);

  return {
    embeds: [embed],
    files: [],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`nf_channel_select:${ownerId}`)
          .setPlaceholder('Select a channel…')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setMinValues(1).setMaxValues(1),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`nf:panel:${ownerId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

// Every component id ends with the opener's id — see the header note.
function ownerOf(customId) {
  const parts = customId.split(':');
  return parts[parts.length - 1];
}

async function guardOwner(interaction) {
  const ownerId = ownerOf(interaction.customId);
  if (interaction.user.id === ownerId) return ownerId;
  await interaction.reply({
    content: `🔒 This news feed panel belongs to <@${ownerId}> — run \`/newsfeed\` to open your own.`,
    flags: MessageFlags.Ephemeral,
  });
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('newsfeed')
    .setDescription('Open the news feed panel — channel, topics and on/off in one place')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Posted publicly, not ephemerally: the panel is a piece of server config
    // other admins should be able to see, and an ephemeral message can't be
    // deleted — which is what made the Close button fail.
    return interaction.reply(buildPanel(interaction.guild, interaction.user.id));
  },

  // ── Buttons ───────────────────────────────────────────────────────────────
  async handleButton(interaction) {
    const ownerId = await guardOwner(interaction);
    if (!ownerId) return;

    const action = interaction.customId.split(':')[1];
    const guild  = interaction.guild;

    if (action === 'close') {
      // Acknowledge before deleting. Discord marks an interaction failed if
      // nothing responds within 3s, and a delete on its own doesn't count as
      // a response — so a delete that throws left the user staring at
      // "This interaction failed".
      await interaction.deferUpdate().catch(() => {});
      try {
        await interaction.message.delete();
      } catch {
        // Couldn't remove the message (already gone, or ephemeral) — collapse
        // it in place so the panel is still dismissed rather than left live.
        await interaction.editReply({ content: '📰 News feed panel closed.', embeds: [], files: [], components: [] }).catch(() => {});
      }
      return;
    }
    if (action === 'panel')   return interaction.update(buildPanel(guild, ownerId));
    if (action === 'topics')  return interaction.update(buildTopicsView(guild, ownerId));
    if (action === 'channel') return interaction.update(buildChannelView(guild, ownerId));

    if (action === 'toggle') {
      const settings = getNewsFeedSettings(guild.id);
      if (!settings.channelId) {
        return interaction.reply({ content: '⚠️ Pick a channel first.', flags: MessageFlags.Ephemeral });
      }
      if (!settings.enabled) {
        const channel = guild.channels.cache.get(settings.channelId);
        const perms   = channel?.permissionsFor(guild.members.me);
        if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
          return interaction.reply({
            content: `❌ I need **Send Messages** and **Embed Links** in ${channel ?? 'that channel'} before I can post there.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        // Clear the cursors so we baseline fresh instead of replaying whatever
        // piled up while the feed was off.
        setNewsFeedSettings(guild.id, { enabled: true, lastGuid: null, lastGuids: {} });
      } else {
        setNewsFeedSettings(guild.id, { enabled: false });
      }
      return interaction.update(buildPanel(guild, ownerId));
    }
  },

  // ── Selects ───────────────────────────────────────────────────────────────

  async handleTopicsSelect(interaction) {
    const ownerId = await guardOwner(interaction);
    if (!ownerId) return;
    setNewsFeedSettings(interaction.guild.id, { filterTopics: interaction.values });
    return interaction.update(buildTopicsView(interaction.guild, ownerId));
  },

  async handleChannelSelect(interaction) {
    const ownerId = await guardOwner(interaction);
    if (!ownerId) return;
    // Switching channel re-baselines too, so a new channel doesn't immediately
    // receive a burst of headlines that were published before it was chosen.
    setNewsFeedSettings(interaction.guild.id, { channelId: interaction.values[0], lastGuid: null, lastGuids: {} });
    return interaction.update(buildPanel(interaction.guild, ownerId));
  },
};
