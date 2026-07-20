'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson }           = require('../../utils/jsonStorage');
const { MOD_COMMANDS, ADMIN_COMMANDS } = require('./cmd');

// ── Command catalogue ──────────────────────────────────────────────────────────
// Each entry: [name, short description]
const FUTURES_CMDS = [
  ['risk', 'Calculate position size & risk for futures contracts'],
];

const ECONOMY_CMDS = [
  ['balance',    'Check your coin balance'],
  ['work',       'Earn coins by working'],
  ['jobs',       'Work multiple jobs with separate cooldowns'],
  ['daily',      'Claim your daily coins'],
  ['bank',       'Deposit coins and earn 2% interest every 12h'],
  ['transfer',   'Send coins to another member'],
  ['rob',        'Attempt to steal coins from another user'],
  ['shop',       'Browse and buy items from the server shop'],
  ['casino',     'Play casino games (slots, crash, BJ, roulette, wheel…)'],
];

const COMMUNITY_CMDS = [
  ['giveaway',   'Enter or view active giveaways'],
  ['cards',      'Collect, view & sell trading cards that drop in chat'],
  ['poll',       'Create a vote poll'],
  ['rank',       'View your XP rank card'],
  ['leaderboard','Server XP leaderboard'],
  ['userinfo',   'View info about a member'],
  ['report',     'Report a member to staff'],
  ['ticket',     'Open a support ticket'],
];

const GENERAL_CMDS = [
  ['help',       'Show this command list'],
];

const MOD_CATALOGUE = [
  ['warn',         'Issue a warning to a member'],
  ['warnings',     'View warnings for a member'],
  ['clearwarnings','Clear all warnings for a member'],
  ['mute',         'Timeout a member'],
  ['unmute',       'Remove a timeout'],
  ['kick',         'Kick a member from the server'],
  ['ban',          'Ban a member'],
  ['unban',        'Unban a user by ID'],
  ['purge',        'Bulk-delete messages'],
  ['warn-settings','Configure warning thresholds & punishments'],
];

const ADMIN_CATALOGUE = [
  ['config',         'Server-wide settings (prefix, channels, roles…)'],
  ['cmd',            'Set which roles can use mod/admin commands'],
  ['embed',          'Create & manage embed templates'],
  ['button',         'Create & manage button link panels'],
  ['autoreply',      'Set automatic keyword replies'],
  ['schedule',       'Schedule embed templates to send automatically'],
  ['levelsettings',  'Configure XP & leveling system'],
  ['casino-settings','Set bet limits & cooldowns for casino'],
  ['give-coins',     'Grant coins to a member'],
  ['ticket',         'Configure the support ticket system'],
  ['shop manage',    'Add / remove items from the server shop'],
  ['cards config',   'Set how many messages between card drops (server-wide)'],
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtCmds(list) {
  return list.map(([name, desc]) => `\`/${name}\` — ${desc}`).join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show commands available to you'),

  async execute(interaction) {
    const member  = interaction.member;
    const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

    const config = readJson('config.json', {});
    const setup  = config[interaction.guild.id]?.cmdSetup || { modRoles: [], adminRoles: [] };

    // Mirror the exact logic from interactionCreate.js checkCmdPermission
    const canUseMod   = isAdmin
      || setup.modRoles.length === 0
      || setup.modRoles.some(id => member.roles.cache.has(id));

    const canUseAdmin = isAdmin
      || (setup.adminRoles.length > 0 && setup.adminRoles.some(id => member.roles.cache.has(id)));

    // ── Build field list ───────────────────────────────────────────────────────
    const fields = [
      { name: '📈 Futures',   value: fmtCmds(FUTURES_CMDS),   inline: false },
      { name: '💰 Economy',   value: fmtCmds(ECONOMY_CMDS),   inline: false },
      { name: '🎉 Community', value: fmtCmds(COMMUNITY_CMDS), inline: false },
      { name: 'ℹ️ General',   value: fmtCmds(GENERAL_CMDS),   inline: false },
    ];

    if (canUseMod) {
      fields.push({ name: '🛡️ Moderation', value: fmtCmds(MOD_CATALOGUE), inline: false });
    }

    if (canUseAdmin) {
      fields.push({ name: '⚙️ Admin & Setup', value: fmtCmds(ADMIN_CATALOGUE), inline: false });
    }

    // ── Tier badge for footer ──────────────────────────────────────────────────
    const tier = isAdmin ? '👑 Administrator'
      : canUseAdmin      ? '🔑 Admin Role'
      : canUseMod        ? '🛡️ Moderator Role'
      :                    '🌐 Member';

    const embed = createServerEmbed('info', {
      title: '📖 YSER Flow — Commands',
      description: `Showing commands available to your role. Use \`/cmd view\` to see the permission setup.\n\u200b`,
      fields,
      footer: `Viewing as: ${tier}`,
    }, interaction.guild);

    await interaction.reply({ embeds: [embed], flags: 64 }); // ephemeral — personal view
  },
};
