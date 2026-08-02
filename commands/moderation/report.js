'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, UserSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} = require('discord.js');
const { readJson } = require('../../utils/jsonStorage');
const reports = require('../../utils/reports');
const messageStyle = require('../../utils/messageStyle');

const REASON_OPTIONS = [
  { value: 'spam',          label: '📨 Spam' },
  { value: 'insult',        label: '🗣️ Insult / Harassment' },
  { value: 'advertisement', label: '📢 Advertisement' },
  { value: 'nsfw',          label: '🔞 NSFW Content' },
  { value: 'raiding',       label: '⚔️ Raiding' },
  { value: 'scam',          label: '💸 Scam / Phishing' },
  { value: 'other',         label: '❓ Other' },
];
const REASON_LABELS = Object.fromEntries(REASON_OPTIONS.map(r => [r.value, r.label]));
const SESSION_TTL_MS = 10 * 60 * 1000;

// One in-progress report panel per user — filling in the user/reason/link
// is all local state until Submit actually sends anything.
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, {});
  return sessions.get(userId);
}

function buildPanelEmbed(session, guild = null) {
  // Wording and colour from the Appearance catalogue; the three fields stay
  // here because they are the form's state, not copy — they change as it is
  // filled in and there is nothing to edit about them.
  const built = guild && messageStyle.build(guild.id, 'report.form', {
    tokens: { server: guild.name },
  });
  return (built || new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('🚨 File a Report')
    .setDescription('Pick the user below (type to search), choose a reason, optionally attach a message link, then press **Submit Report**.\n​'))
    .addFields(
      { name: '👤 User',   value: session.targetUserId ? `<@${session.targetUserId}>` : '*Not selected*', inline: true },
      { name: '🏷️ Reason', value: session.reason ? REASON_LABELS[session.reason] : '*Not selected*',      inline: true },
      { name: '🔗 Link',   value: session.link || '*None*',                                                inline: true },
    );
}

function buildPanelRows(userId, guild = null) {
  const userSelect = new UserSelectMenuBuilder().setCustomId(`report_user_select:${userId}`).setPlaceholder('Select a user to report…').setMinValues(1).setMaxValues(1);
  const reasonSelect = new StringSelectMenuBuilder().setCustomId(`report_reason_select:${userId}`).setPlaceholder('Select a reason…')
    .addOptions(REASON_OPTIONS.map(r => new StringSelectMenuOptionBuilder().setLabel(r.label).setValue(r.value)));
  // Every custom id here carries the owner on the end, so a form left open in
  // one channel cannot be driven by somebody else pressing in another.
  const buttons = guild && messageStyle.buildButtons(guild.id, 'report.form', {
    customId: id => `${id}:${userId}`,
    ButtonBuilder, ActionRowBuilder, ButtonStyle,
  });
  const rows = [new ActionRowBuilder().addComponents(userSelect), new ActionRowBuilder().addComponents(reasonSelect)];
  if (buttons) rows.push(buttons);
  return rows;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report').setDescription('Report a user to the moderation team'),

  async execute(interaction) {
    const userId = interaction.user.id;
    sessions.delete(userId);
    const session = getSession(userId);
    setTimeout(() => sessions.delete(userId), SESSION_TTL_MS);
    await interaction.reply({ embeds: [buildPanelEmbed(session, interaction.guild)], components: buildPanelRows(userId, interaction.guild), flags: MessageFlags.Ephemeral });
  },

  async handleUserSelect(interaction) {
    const ownerId = interaction.customId.split(':')[1];
    if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ This isn't your report panel.", flags: MessageFlags.Ephemeral });

    const targetId   = interaction.values[0];
    const targetUser = interaction.users?.first?.() || null;
    if (targetId === interaction.user.id) return interaction.reply({ content: '❌ You cannot report yourself.', flags: MessageFlags.Ephemeral });
    if (targetUser?.bot) return interaction.reply({ content: '❌ You cannot report bots.', flags: MessageFlags.Ephemeral });

    const session = getSession(ownerId);
    session.targetUserId = targetId;
    return interaction.update({ embeds: [buildPanelEmbed(session, interaction.guild)], components: buildPanelRows(ownerId, interaction.guild) });
  },

  async handleReasonSelect(interaction) {
    const ownerId = interaction.customId.split(':')[1];
    if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ This isn't your report panel.", flags: MessageFlags.Ephemeral });

    const session = getSession(ownerId);
    session.reason = interaction.values[0];
    return interaction.update({ embeds: [buildPanelEmbed(session, interaction.guild)], components: buildPanelRows(ownerId, interaction.guild) });
  },

  async handleButton(interaction) {
    const [action, ownerId] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ This isn't your report panel.", flags: MessageFlags.Ephemeral });
    const session = getSession(ownerId);

    if (action === 'report_link') {
      const modal = new ModalBuilder().setCustomId(`report_link_modal:${ownerId}`).setTitle('Add a Message Link').addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('link').setLabel('Message link (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue(session.link || ''),
        ),
      );
      return interaction.showModal(modal);
    }

    if (action === 'report_cancel') {
      sessions.delete(ownerId);
      return interaction.update({ embeds: [new EmbedBuilder().setColor(0x95A5A6).setTitle('❌ Cancelled').setDescription('No report was sent.')], components: [] });
    }

    if (action === 'report_submit') {
      if (!session.targetUserId) return interaction.reply({ content: '❌ Select a user first.', flags: MessageFlags.Ephemeral });
      if (!session.reason) return interaction.reply({ content: '❌ Select a reason first.', flags: MessageFlags.Ephemeral });

      const config     = readJson('config.json', {});
      const gCfg       = config[interaction.guild.id] || {};
      const reportChId = gCfg.reportChannel;
      const reportRole = gCfg.reportRole;

      if (!reportChId) return interaction.reply({ content: '❌ No report channel configured. Ask an admin to run `/config report-channel`.', flags: MessageFlags.Ephemeral });
      const reportCh = interaction.guild.channels.cache.get(reportChId);
      if (!reportCh) return interaction.reply({ content: '❌ Configured report channel not found.', flags: MessageFlags.Ephemeral });

      const targetUser = await interaction.client.users.fetch(session.targetUserId).catch(() => null);

      // The three fields are the record and stay put; everything around them
      // is the catalogue's. The picture is the reported member's avatar, which
      // the thumbnail switch decides whether to show.
      const embed = messageStyle.build(interaction.guild.id, 'report.card', {
        thumbnailURL: targetUser?.displayAvatarURL({ dynamic: true }) ?? null,
        tokens: {
          server: interaction.guild.name,
          target: `<@${session.targetUserId}>`,
          reporter: `<@${interaction.user.id}>`,
          reason: REASON_LABELS[session.reason] || session.reason,
        },
        fields: [
          { name: '👤 Reported User', value: `<@${session.targetUserId}>${targetUser ? ` \`${targetUser.tag}\`` : ''}`, inline: true },
          { name: '📝 Reporter',      value: `<@${interaction.user.id}>`,                                              inline: true },
          { name: '​',           value: '​',                                                                 inline: true },
          { name: '🏷️ Reason',        value: REASON_LABELS[session.reason] || session.reason,                         inline: false },
          ...(session.link ? [{ name: '🔗 Message Link', value: session.link, inline: false }] : []),
        ],
      });
      const actionRow = messageStyle.buildButtons(interaction.guild.id, 'report.card', {
        customId: () => `rpt_action:${session.targetUserId}:${reportChId}`,
        ButtonBuilder, ActionRowBuilder, ButtonStyle,
      });

      const content = reportRole ? `<@&${reportRole}>` : undefined;
      const posted = await reportCh.send({ content, embeds: [embed], components: actionRow ? [actionRow] : [] });

      // Recorded as well as posted. The message used to be the only copy,
      // which meant the queue could only be read by scrolling this channel.
      reports.create({
        guildId: interaction.guild.id,
        channelId: reportChId,
        messageId: posted?.id || null,
        reporterId: interaction.user.id,
        reporterTag: interaction.user.tag,
        targetId: session.targetUserId,
        targetTag: targetUser?.tag || session.targetUserId,
        reason: REASON_LABELS[session.reason] || session.reason,
        link: session.link || '',
      });

      sessions.delete(ownerId);
      return interaction.update({
        embeds: [messageStyle.build(interaction.guild.id, 'report.submitted', {
          tokens: {
            user: interaction.user.username,
            server: interaction.guild.name,
            target: `<@${session.targetUserId}>`,
          },
        })],
        components: [],
      });
    }
  },

  async handleModal(interaction) {
    const [, ownerId] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ This isn't your report panel.", flags: MessageFlags.Ephemeral });

    const session = getSession(ownerId);
    const link = interaction.fields.getTextInputValue('link').trim();
    session.link = link || undefined;
    return interaction.update({ embeds: [buildPanelEmbed(session, interaction.guild)], components: buildPanelRows(ownerId, interaction.guild) });
  },
};
