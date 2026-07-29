'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { getModLogSettings, setModLogSettings, getModLogChannel } = require('../../utils/modConfig');

const CATEGORIES = [
  { key: 'members',  label: '👋 Member Joins / Leaves' },
  { key: 'messages',  label: '📝 Message Edits / Deletes' },
  { key: 'roles',     label: '🎭 Role & Nickname Changes' },
  { key: 'purges',    label: '🧹 Purge Summaries' },
];

function buildPanelEmbed(guild, settings) {
  const channel = getModLogChannel(guild);
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📋 Mod Log Control Panel')
    .setDescription(
      `Log channel: ${channel ? `${channel}` : '⚠️ Not set — run `/config logs #channel` first.'}\n\n` +
      'Click a button below to toggle that category on or off.',
    )
    .addFields(CATEGORIES.map(c => ({ name: c.label, value: settings[c.key] ? '🟢 ON' : '🔴 OFF', inline: true })))
    .setFooter({ text: 'Admins only • Also receives Auto-Mod filter actions' });
}

function buildPanelRow(settings) {
  return new ActionRowBuilder().addComponents(
    CATEGORIES.map(c => new ButtonBuilder()
      .setCustomId(`modlog_toggle:${c.key}`)
      .setLabel(c.label.replace(/^\S+\s/, ''))
      .setStyle(settings[c.key] ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modlog').setDescription('Configure passive mod-action logging')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('panel').setDescription('Open the toggle panel for log categories')),

  async execute(interaction) {
    const settings = getModLogSettings(interaction.guild.id);
    return interaction.reply({ embeds: [buildPanelEmbed(interaction.guild, settings)], components: [buildPanelRow(settings)], flags: MessageFlags.Ephemeral });
  },

  // ── Panel toggle button ─────────────────────────────────────────────────
  async handleToggle(interaction, category) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only Administrators can change mod-log settings.', flags: MessageFlags.Ephemeral });
    }
    const current  = getModLogSettings(interaction.guild.id);
    const settings = setModLogSettings(interaction.guild.id, { [category]: !current[category] });
    return interaction.update({ embeds: [buildPanelEmbed(interaction.guild, settings)], components: [buildPanelRow(settings)] });
  },
};
