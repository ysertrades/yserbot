'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson } = require('../../utils/jsonStorage');

// All JSON files that store data keyed by guildId
const GUILD_FILES = [
  'config.json',
  'economy.json',
  'levels.json',
  'bank.json',
  'shop.json',
  'casino-settings.json',
  'cases.json',
  'autoreplies.json',
  'buttons.json',
  'embeds.json',
  'schedules.json',
  'cards_config.json',
  'wheel_limits.json',
  'giveaways_ended.json',
  'active_effects.json',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('DM yourself a JSON snapshot of all bot data for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const snapshot = {
      version: 1,
      guildId,
      guildName: interaction.guild.name,
      exportedAt: new Date().toISOString(),
      data: {},
    };

    for (const file of GUILD_FILES) {
      const all = readJson(file, {});
      if (all[guildId] !== undefined) {
        snapshot.data[file] = all[guildId];
      }
    }

    const fileCount = Object.keys(snapshot.data).length;
    const json      = JSON.stringify(snapshot, null, 2);
    const buffer    = Buffer.from(json, 'utf8');
    const fileName  = `backup_${guildId}_${Date.now()}.json`;

    const attachment = new AttachmentBuilder(buffer, {
      name: fileName,
      description: `Bot data backup for ${interaction.guild.name}`,
    });

    try {
      await interaction.user.send({
        content: `📦 Here is your bot data backup for **${interaction.guild.name}**. Keep it somewhere safe — you can restore it at any time with \`/restore\`.`,
        files: [attachment],
      });

      await interaction.editReply({
        embeds: [createServerEmbed('success', {
          title: '📦 Backup Sent',
          description: `A complete snapshot has been sent to your DMs.\n\n**Files captured:** ${fileCount} of ${GUILD_FILES.length}\n**File name:** \`${fileName}\``,
        }, interaction.guild)],
      });
    } catch {
      await interaction.editReply({
        embeds: [createServerEmbed('error', {
          title: 'Could Not Send DM',
          description: 'Please enable **DMs from server members** in your Privacy Settings and try again.',
        }, interaction.guild)],
      });
    }
  },
};
