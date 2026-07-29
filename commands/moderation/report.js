'use strict';

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder, UserSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { readJson } = require('../../utils/jsonStorage');

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

function buildPanelEmbed(session) {
  return new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('🚨 File a Report')
    .setDescription('Pick the user below (type to search), choose a reason, optionally attach a message link, then press **Submit Report**.\n​')
    .addFields(
      { name: '👤 User',   value: session.targetUserId ? `<@${session.targetUserId}>` : '*Not selected*', inline: true },
      { name: '🏷️ Reason', value: session.reason ? REASON_LABELS[session.reason] : '*Not selected*',      inline: true },
      { name: '🔗 Link',   value: session.link || '*None*',                                                inline: true },
    )
    .setFooter({ text: 'Only you can see this — nothing is sent until you press Submit' });
}

function buildPanelRows(userId) {
  const userSelect = new UserSelectMenuBuilder().setCustomId(`report_user_select:${userId}`).setPlaceholder('Select a user to report…').setMinValues(1).setMaxValues(1);
  const reasonSelect = new StringSelectMenuBuilder().setCustomId(`report_reason_select:${userId}`).setPlaceholder('Select a reason…')
    .addOptions(REASON_OPTIONS.map(r => new StringSelectMenuOptionBuilder().setLabel(r.label).setValue(r.value)));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`report_link:${userId}`).setLabel('Add Link').setEmoji('🔗').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`report_submit:${userId}`).setLabel('Submit Report').setEmoji('📤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`report_cancel:${userId}`).setLabel('Cancel').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
  );
  return [new ActionRowBuilder().addComponents(userSelect), new ActionRowBuilder().addComponents(reasonSelect), buttons];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('report').setDescription('Report a user to the moderation team'),

  async execute(interaction) {
    const userId = interaction.user.id;
    sessions.delete(userId);
    const session = getSession(userId);
    setTimeout(() => sessions.delete(userId), SESSION_TTL_MS);
    await interaction.reply({ embeds: [buildPanelEmbed(session)], components: buildPanelRows(userId), ephemeral: true });
  },

  async handleUserSelect(interaction) {
    const ownerId = interaction.customId.split(':')[1];
    if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ This isn't your report panel.", ephemeral: true });

    const targetId   = interaction.values[0];
    const targetUser = interaction.users?.first?.() || null;
    if (targetId === interaction.user.id) return interaction.reply({ content: '❌ You cannot report yourself.', ephemeral: true });
    if (targetUser?.bot) return interaction.reply({ content: '❌ You cannot report bots.', ephemeral: true });

    const session = getSession(ownerId);
    session.targetUserId = targetId;
    return interaction.update({ embeds: [buildPanelEmbed(session)], components: buildPanelRows(ownerId) });
  },

  async handleReasonSelect(interaction) {
    const ownerId = interaction.customId.split(':')[1];
    if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ This isn't your report panel.", ephemeral: true });

    const session = getSession(ownerId);
    session.reason = interaction.values[0];
    return interaction.update({ embeds: [buildPanelEmbed(session)], components: buildPanelRows(ownerId) });
  },

  async handleButton(interaction) {
    const [action, ownerId] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ This isn't your report panel.", ephemeral: true });
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
      if (!session.targetUserId) return interaction.reply({ content: '❌ Select a user first.', ephemeral: true });
      if (!session.reason) return interaction.reply({ content: '❌ Select a reason first.', ephemeral: true });

      const config     = readJson('config.json', {});
      const gCfg       = config[interaction.guild.id] || {};
      const reportChId = gCfg.reportChannel;
      const reportRole = gCfg.reportRole;

      if (!reportChId) return interaction.reply({ content: '❌ No report channel configured. Ask an admin to run `/config report-channel`.', ephemeral: true });
      const reportCh = interaction.guild.channels.cache.get(reportChId);
      if (!reportCh) return interaction.reply({ content: '❌ Configured report channel not found.', ephemeral: true });

      const targetUser = await interaction.client.users.fetch(session.targetUserId).catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🚨 New User Report')
        .setThumbnail(targetUser?.displayAvatarURL({ dynamic: true }) ?? null)
        .addFields(
          { name: '👤 Reported User', value: `<@${session.targetUserId}>${targetUser ? ` \`${targetUser.tag}\`` : ''}`, inline: true },
          { name: '📝 Reporter',      value: `<@${interaction.user.id}>`,                                              inline: true },
          { name: '​',           value: '​',                                                                 inline: true },
          { name: '🏷️ Reason',        value: REASON_LABELS[session.reason] || session.reason,                         inline: false },
        )
        .setTimestamp()
        .setFooter({ text: `Report from ${interaction.guild.name}` });
      if (session.link) embed.addFields({ name: '🔗 Message Link', value: session.link, inline: false });

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rpt_action:${session.targetUserId}:${reportChId}`).setLabel('⚡ Take Action').setStyle(ButtonStyle.Danger),
      );

      const content = reportRole ? `<@&${reportRole}>` : undefined;
      await reportCh.send({ content, embeds: [embed], components: [actionRow] });

      sessions.delete(ownerId);
      return interaction.update({
        embeds: [new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('✅ Report Submitted')
          .setDescription(`Your report against <@${session.targetUserId}> has been sent to the moderation team.\n\nThank you for helping keep the server safe.`)
          .setTimestamp()],
        components: [],
      });
    }
  },

  async handleModal(interaction) {
    const [, ownerId] = interaction.customId.split(':');
    if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ This isn't your report panel.", ephemeral: true });

    const session = getSession(ownerId);
    const link = interaction.fields.getTextInputValue('link').trim();
    session.link = link || undefined;
    return interaction.update({ embeds: [buildPanelEmbed(session)], components: buildPanelRows(ownerId) });
  },
};
