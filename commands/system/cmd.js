'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, REST, Routes, MessageFlags } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { serverAction } = require('../../utils/modEmbed');

// /report is for members to reach the moderators, so it is public only. It
// was listed here as well, and once a mod role was set that locked every
// regular member out of reporting anything.
const MOD_COMMANDS = [
  'ban', 'clearwarnings', 'kick', 'lock', 'mute', 'purge',
  'unban', 'unlock', 'unmute', 'warn', 'warn-settings', 'warnings',
];

const ADMIN_COMMANDS = [
  'automod', 'autoreply', 'backup', 'button',
  'cmd', 'config', 'econcal', 'embed', 'giveaway',
  'levelsettings', 'modlog', 'newsfeed', 'restore', 'schedule',
  'ticket', 'verify', 'warn-settings',
];

const PUBLIC_COMMANDS = [
  'help', 'leaderboard', 'ping',
  'poll', 'rank', 'report', 'risk', 'userinfo',
];

function getCmdSetup(guildId) {
  const config = readJson('config.json', {});
  if (!config[guildId]) config[guildId] = {};
  if (!config[guildId].cmdSetup) config[guildId].cmdSetup = { modRoles: [], adminRoles: [] };
  return { config, setup: config[guildId].cmdSetup };
}

// ── Sync Discord guild command permissions ─────────────────────────────────────
// When roles are configured, hide affected commands from everyone except those
// roles and server administrators. When roles are cleared, reset to defaults.

// Visibility only: the bot itself refuses these commands to anyone without a
// configured role (checkCmdPermission in interactionCreate). Discord accepts
// permission edits only from a user OAuth token — see permissionsRest in
// utils/commandVisibility.js — so without COMMAND_PERMS_BEARER this skips the
// call that was always refused.
async function syncGuildCommandPerms(interaction, isAdmin, roles) {
  const permRest = require('../../utils/commandVisibility').permissionsRest();
  if (!permRest) return false;
  try {
    const rest    = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const appId   = interaction.client.application.id;
    const guildId = interaction.guild.id;

    // Fetch all globally registered commands to get their IDs
    const rawCmds   = await rest.get(Routes.applicationCommands(appId));
    const cmdMap    = new Map(rawCmds.map(c => [c.name, c.id]));
    const cmdList   = isAdmin ? ADMIN_COMMANDS : MOD_COMMANDS;

    for (const cmdName of cmdList) {
      const cmdId = cmdMap.get(cmdName);
      if (!cmdId) continue;

      // Build permission overrides
      let permissions;
      if (roles.length === 0) {
        // No custom roles — reset to empty overrides so defaultMemberPermissions takes over
        permissions = [];
      } else {
        permissions = [
          // Deny @everyone so the command is hidden by default
          { id: guildId, type: 1, permission: false },
          // Allow each configured role
          ...roles.map(roleId => ({ id: roleId, type: 1, permission: true })),
        ];
      }

      await permRest.put(
        Routes.applicationCommandPermissions(appId, guildId, cmdId),
        { body: { permissions } },
      );
    }
    return true;
  } catch (err) {
    console.error('[CMD PERMS SYNC]', err.message ?? err);
    return false;
  }
}

module.exports = {
  MOD_COMMANDS,
  ADMIN_COMMANDS,
  PUBLIC_COMMANDS,

  data: new SlashCommandBuilder()
    .setName('cmd').setDescription('Command permission setup')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('view').setDescription('View current command permission setup'))
    .addSubcommand(s => s.setName('mod-role').setDescription('Toggle a role for moderation commands')
      .addRoleOption(o => o.setName('role').setDescription('Role to toggle').setRequired(true)))
    .addSubcommand(s => s.setName('admin-role').setDescription('Toggle a role for admin commands')
      .addRoleOption(o => o.setName('role').setDescription('Role to toggle').setRequired(true)))
    .addSubcommand(s => s.setName('reset').setDescription('Reset all command permission roles')),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const { config, setup } = getCmdSetup(guildId);

    if (sub === 'view') {
      const modRoles   = setup.modRoles.length   ? setup.modRoles.map(id => `<@&${id}>`).join(', ')   : '*(anyone)*';
      const adminRoles = setup.adminRoles.length  ? setup.adminRoles.map(id => `<@&${id}>`).join(', ') : '*(admins only)*';
      return interaction.reply({
        embeds: [createServerEmbed('info', {
          title: '⚙️ Command Permission Setup',
          fields: [
            { name: '🛡️ Moderation Commands', value: `Allowed roles: ${modRoles}\n\`${MOD_COMMANDS.join('`, `')}\``, inline: false },
            { name: '🔑 Admin Commands',       value: `Allowed roles: ${adminRoles}\n\`${ADMIN_COMMANDS.join('`, `')}\``, inline: false },
            { name: '🌐 Public Commands',      value: `Always available to everyone.\n\`${PUBLIC_COMMANDS.join('`, `')}\``, inline: false },
          ],
        }, interaction.guild)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'reset') {
      setup.modRoles   = [];
      setup.adminRoles = [];
      writeJson('config.json', config);

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const [modOk, adminOk] = await Promise.all([
        syncGuildCommandPerms(interaction, false, []),
        syncGuildCommandPerms(interaction, true,  []),
      ]);

      const syncNote = (modOk && adminOk)
        ? '\n✅ Discord command visibility reset to defaults.'
        : '\nThe bot enforces this itself. To also change who *sees* the commands, use **Server Settings → Integrations**.';

      return interaction.editReply({
        embeds: [createServerEmbed('success', { title: '🔄 Reset', description: `All command permission roles cleared.${syncNote}` }, interaction.guild)],
      });
    }

    // mod-role / admin-role toggle
    const role    = interaction.options.getRole('role');
    const isAdmin = sub === 'admin-role';
    const list    = isAdmin ? setup.adminRoles : setup.modRoles;
    const idx     = list.indexOf(role.id);
    let action;

    if (idx === -1) { list.push(role.id);    action = 'added to'; }
    else            { list.splice(idx, 1);   action = 'removed from'; }

    if (isAdmin) setup.adminRoles = list;
    else         setup.modRoles   = list;

    writeJson('config.json', config);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const synced = await syncGuildCommandPerms(interaction, isAdmin, list);

    const syncNote = synced
      ? `\n✅ Discord command visibility updated — ${list.length === 0 ? 'commands restored to default visibility' : `only <@&${role.id}> and other configured roles will see the commands`}.`
      : '\nThe bot already refuses these commands to anyone without a configured role. To also hide them from the slash menu, use **Server Settings → Integrations → QuantLab**.';

    const category = isAdmin ? 'admin' : 'moderation';
    return interaction.editReply({
      embeds: [serverAction({
        guild: interaction.guild,
        title: `${role.name} ${action} the ${category} roles`,
        note: `**Now:** ${list.length ? list.map(id => `<@&${id}>`).join(', ') : 'none — default visibility'}${syncNote}`,
        color: 0x2ECC71,
      })],
    });
  },
};
