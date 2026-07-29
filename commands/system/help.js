'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson }           = require('../../utils/jsonStorage');
const { MOD_COMMANDS, ADMIN_COMMANDS } = require('./cmd');

// ── Command catalogue ──────────────────────────────────────────────────────────
// Each entry: [name, short description]. Categories are declared here and
// added to `fields` below in A-Z order by category name, with commands
// inside each category also sorted A-Z.

const ADMIN_CATALOGUE = [
  ['automod',        'Toggle bad-word & link-approval auto-mod filters'],
  ['autoreply',      'Set automatic keyword replies'],
  ['button',         'Create & manage button link panels'],
  ['cardsettings',   'Set how many messages between card drops (server-wide)'],
  ['casino-settings','Set bet limits & cooldowns for casino'],
  ['cmd',            'Set which roles can use mod/admin commands'],
  ['config',         'Server-wide settings (prefix, channels, roles…)'],
  ['econcal',        'Weekly economic calendar with release reminders (ForexFactory data)'],
  ['embed',          'Create & manage embed templates'],
  ['give-coins',     'Grant coins to a member'],
  ['giveaway',       'Create, end, reroll & list giveaways'],
  ['levelsettings',  'Configure XP & leveling system'],
  ['modlog',         'Toggle which events get logged to the mod-log channel'],
  ['newsfeed',       'Post live Financial Juice market news headlines to a channel'],
  ['schedule',       'Schedule embed templates to send automatically'],
  ['shopsettings',   'Add / remove items from the server shop'],
  ['ticket',         'Configure the support ticket system'],
  ['verify',         'Set up member verification (memory challenge + role)'],
];

const COMMUNITY_CMDS = [
  ['cards',      'Collect, view & sell trading cards that drop in chat'],
  ['leaderboard','Server XP leaderboard'],
  ['poll',       'Create a vote poll'],
  ['rank',       'View your XP rank card'],
  ['report',     'Report a member to staff'],
  ['ticket',     'Open a support ticket'],
  ['userinfo',   'View info about a member'],
];

const ECONOMY_CMDS = [
  ['balance',    'Check your coin balance'],
  ['bank',       'Deposit coins and earn 2% interest every 12h'],
  ['casino',     'Play casino games (slots, crash, BJ, roulette, wheel…)'],
  ['daily',      'Claim your daily coins'],
  ['fish',       'Cast a line and see what you reel in'],
  ['jobs',       'Work multiple jobs with separate cooldowns'],
  ['lottery',    'Buy tickets for the daily lottery draw'],
  ['mine',       'Swing your pickaxe and see what you dig up'],
  ['rob',        'Attempt to steal coins from another user'],
  ['shop',       'Browse and buy items from the server shop'],
  ['transfer',   'Send coins to another member'],
  ['trivia',     'Answer a trivia question for coins'],
  ['work',       'Earn coins by working'],
];

const FUTURES_CMDS = [
  ['risk', 'Calculate position size & risk for futures contracts'],
];

const GENERAL_CMDS = [
  ['help',       'Show this command list'],
];

const MOD_CATALOGUE = [
  ['ban',          'Ban a member'],
  ['clearwarnings','Clear all warnings for a member'],
  ['kick',         'Kick a member from the server'],
  ['lock',         'Lock a channel to moderators/admins only'],
  ['mute',         'Timeout a member'],
  ['purge',        'Bulk-delete messages'],
  ['unban',        'Unban a user by ID'],
  ['unlock',       'Unlock a previously locked channel'],
  ['unmute',       'Remove a timeout'],
  ['warn',         'Issue a warning to a member'],
  ['warn-settings','Configure warning thresholds & punishments'],
  ['warnings',     'View warnings for a member'],
];

// ── Helpers ────────────────────────────────────────────────────────────────────
// Discord caps an embed field's value at 1024 chars — split into multiple
// fields (numbered) rather than assuming any one category stays under that.
function categoryFields(name, list, maxLen = 1024) {
  const lines = list.map(([cmdName, desc]) => `\`/${cmdName}\` — ${desc}`);
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((value, i) => ({
    name: chunks.length > 1 ? `${name} (${i + 1}/${chunks.length})` : name,
    value,
    inline: false,
  }));
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

    // ── Build field list — categories in A-Z order by name ────────────────────
    const fields = [];

    if (canUseAdmin) fields.push(...categoryFields('⚙️ Admin & Setup', ADMIN_CATALOGUE));
    fields.push(...categoryFields('🎉 Community', COMMUNITY_CMDS));
    fields.push(...categoryFields('💰 Economy',   ECONOMY_CMDS));
    fields.push(...categoryFields('📈 Futures',   FUTURES_CMDS));
    fields.push(...categoryFields('ℹ️ General',   GENERAL_CMDS));
    if (canUseMod) fields.push(...categoryFields('🛡️ Moderation', MOD_CATALOGUE));

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
