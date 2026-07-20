'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

// Must stay in sync with backup.js
const GUILD_FILES = new Set([
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
]);

// In-memory store for pending restore sessions
// key: `${guildId}:${userId}` → { snapshot, expiresAt }
const pendingRestores = new Map();
const PENDING_TTL_MS  = 5 * 60 * 1000; // 5 minutes

// ── Button handlers (called from interactionCreate.js) ────────────────────────

async function handleRestoreConfirm(interaction) {
  const key     = `${interaction.guild.id}:${interaction.user.id}`;
  const pending = pendingRestores.get(key);

  if (!pending || Date.now() > pending.expiresAt) {
    pendingRestores.delete(key);
    return interaction.update({
      embeds: [createServerEmbed('error', {
        title: 'Session Expired',
        description: 'The restore session has expired (5-minute window). Please run `/restore` again.',
      }, interaction.guild)],
      components: [],
    });
  }

  const { snapshot } = pending;
  pendingRestores.delete(key);

  const guildId = interaction.guild.id;
  const applied = [];
  const failed  = [];

  for (const [file, guildData] of Object.entries(snapshot.data)) {
    if (!GUILD_FILES.has(file)) continue;
    try {
      const all    = readJson(file, {});
      all[guildId] = guildData;
      writeJson(file, all);
      applied.push(file);
    } catch (err) {
      console.error(`[RESTORE] Failed to write ${file}:`, err);
      failed.push(file);
    }
  }

  const fields = [];
  if (applied.length) fields.push({ name: 'Restored', value: applied.map(f => `\`${f}\``).join(', '), inline: false });
  if (failed.length)  fields.push({ name: '⚠️ Failed',  value: failed.map(f => `\`${f}\``).join(', '),  inline: false });

  return interaction.update({
    embeds: [createServerEmbed('success', {
      title: '✅ Restore Complete',
      description: `All bot data has been restored from the backup snapshot.\n**Restored:** ${applied.length} file(s)${failed.length ? ` · **Failed:** ${failed.length}` : ''}`,
      fields,
    }, interaction.guild)],
    components: [],
  });
}

async function handleRestoreCancel(interaction) {
  const key = `${interaction.guild.id}:${interaction.user.id}`;
  pendingRestores.delete(key);

  return interaction.update({
    embeds: [createServerEmbed('info', {
      title: 'Restore Cancelled',
      description: 'No changes were made.',
    }, interaction.guild)],
    components: [],
  });
}

// ── Command definition ────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('restore')
    .setDescription('Restore all bot data for this server from a backup JSON file')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addAttachmentOption(o =>
      o.setName('backup')
        .setDescription('The .json backup file created by /backup')
        .setRequired(true),
    ),

  handleRestoreConfirm,
  handleRestoreCancel,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const attachment = interaction.options.getAttachment('backup');

    // Basic type check — Discord doesn't always set contentType, so also check extension
    const isJson = attachment.name.endsWith('.json') || attachment.contentType?.includes('json');
    if (!isJson) {
      return interaction.editReply({
        embeds: [createServerEmbed('error', {
          title: 'Invalid File Type',
          description: 'Please attach the `.json` file created by `/backup`.',
        }, interaction.guild)],
      });
    }

    if (attachment.size > 10 * 1024 * 1024) {
      return interaction.editReply({
        embeds: [createServerEmbed('error', {
          title: 'File Too Large',
          description: 'The backup file exceeds 10 MB and cannot be imported.',
        }, interaction.guild)],
      });
    }

    // Download and parse
    let snapshot;
    try {
      const res  = await fetch(attachment.url);
      const text = await res.text();
      snapshot   = JSON.parse(text);
    } catch {
      return interaction.editReply({
        embeds: [createServerEmbed('error', {
          title: 'Could Not Read File',
          description: 'Failed to download or parse the backup file. Make sure it is a valid JSON file from `/backup`.',
        }, interaction.guild)],
      });
    }

    // Validate structure
    if (
      !snapshot ||
      snapshot.version !== 1 ||
      typeof snapshot.guildId !== 'string' ||
      typeof snapshot.data !== 'object' ||
      Array.isArray(snapshot.data)
    ) {
      return interaction.editReply({
        embeds: [createServerEmbed('error', {
          title: 'Invalid Backup File',
          description: 'This file is not a valid bot backup. Only files created by `/backup` are supported.',
        }, interaction.guild)],
      });
    }

    const fileList = Object.keys(snapshot.data).filter(f => GUILD_FILES.has(f));
    if (fileList.length === 0) {
      return interaction.editReply({
        embeds: [createServerEmbed('error', {
          title: 'Empty Backup',
          description: 'No recognisable data files were found in this backup.',
        }, interaction.guild)],
      });
    }

    // Store pending restore
    const key = `${interaction.guild.id}:${interaction.user.id}`;
    pendingRestores.set(key, { snapshot, expiresAt: Date.now() + PENDING_TTL_MS });

    // Build confirmation message
    const guildMismatch = snapshot.guildId !== interaction.guild.id;
    const exportedAt    = snapshot.exportedAt
      ? new Date(snapshot.exportedAt).toUTCString()
      : 'unknown';

    const descLines = [];
    if (guildMismatch) {
      descLines.push(`> ⚠️ **This backup is from a different server** (\`${snapshot.guildName || snapshot.guildId}\`). Restoring it will replace this server's data.`);
      descLines.push('');
    }
    descLines.push(`**Exported:** ${exportedAt}`);
    descLines.push(`**Files to restore:** ${fileList.length} — ${fileList.map(f => `\`${f}\``).join(', ')}`);
    descLines.push('');
    descLines.push('**This will overwrite all current bot data for this server and cannot be undone.** Do you want to continue?');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`restore_confirm:${interaction.guild.id}:${interaction.user.id}`)
        .setLabel('Yes, Restore')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`restore_cancel:${interaction.guild.id}:${interaction.user.id}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.editReply({
      embeds: [createServerEmbed('warning', {
        title: '⚠️ Confirm Restore',
        description: descLines.join('\n'),
      }, interaction.guild)],
      components: [row],
    });
  },
};
