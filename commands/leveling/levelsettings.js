'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
} = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('levelsettings')
    .setDescription('Admin tools for Quantlab leveling')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName('view').setDescription('View XP rates and role rewards'))
    .addSubcommand(sub => sub
      .setName('addxp')
      .setDescription('Add XP to a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('XP to add').setMinValue(1).setMaxValue(100000).setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Optional reason')))
    .addSubcommand(sub => sub
      .setName('removexp')
      .setDescription('Remove XP from a member')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('XP to remove').setMinValue(1).setMaxValue(100000).setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Optional reason')))
    .addSubcommand(sub => sub
      .setName('setlevel')
      .setDescription('Set a member to a specific level')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption(o => o.setName('level').setDescription('Level 0–500').setMinValue(0).setMaxValue(500).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('resetuser')
      .setDescription('Clear one member from the leaderboard')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand(sub => sub.setName('resetall').setDescription('Wipe every member XP (danger)')),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({ content: 'Leveling is turned off on this server.', ephemeral: true });
    }

    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const snap = levelingEngine.panelSnapshot(guildId, interaction.guild);
      const rewards = (snap.roleRewards || [])
        .map(r => `Lv **${r.level}** → ${r.roleName || r.label} (${(r.totalXp || 0).toLocaleString()} XP)`)
        .join('\n') || 'None configured';
      const embed = new EmbedBuilder()
        .setColor(0x34D399)
        .setTitle('Leveling settings')
        .setDescription([
          `Engine: **${snap.enabled ? 'on' : 'off'}**`,
          `XP / message: **${snap.xpMin}–${snap.xpMax}** · cooldown **${snap.cooldownSec}s**`,
          `Min length: **${snap.minMessageLength}** · emoji-only: **${snap.ignoreEmojiOnly ? 'ignored' : 'allowed'}**`,
          `Weekend boost: **×${snap.weekendBoost}**`,
          `Tracked: **${snap.userCount}** members`,
          '',
          '**Role rewards**',
          rewards,
          '',
          '`' + snap.formula + '`',
        ].join('\n'));
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'addxp' || sub === 'removexp') {
      const user = interaction.options.getUser('user', true);
      const amount = interaction.options.getInteger('amount', true);
      const reason = interaction.options.getString('reason') || sub;
      const delta = sub === 'addxp' ? amount : -amount;
      const r = levelingEngine.manualXp(guildId, {
        userId: user.id,
        amount: delta,
        reason,
        staffId: interaction.user.id,
      });
      if (r.error) {
        return interaction.reply({ content: `Could not adjust XP (\`${r.error}\`).`, ephemeral: true });
      }
      return interaction.reply({
        content: `${sub === 'addxp' ? 'Added' : 'Removed'} **${amount}** XP ${sub === 'addxp' ? 'to' : 'from'} <@${user.id}> → Lv **${r.level}** · **${r.xp.toLocaleString()}** total.`,
        ephemeral: true,
      });
    }

    if (sub === 'setlevel') {
      const user = interaction.options.getUser('user', true);
      const level = interaction.options.getInteger('level', true);
      const r = levelingEngine.setUserLevel(guildId, user.id, level);
      return interaction.reply({
        content: `Set <@${user.id}> to level **${r.level}** (${r.xp.toLocaleString()} XP).`,
        ephemeral: true,
      });
    }

    if (sub === 'resetuser') {
      const user = interaction.options.getUser('user', true);
      levelingEngine.resetUser(guildId, user.id);
      return interaction.reply({ content: `Cleared XP for <@${user.id}>.`, ephemeral: true });
    }

    if (sub === 'resetall') {
      levelingEngine.resetAllXp(guildId, interaction.user.id);
      return interaction.reply({ content: 'All member XP wiped. Leaderboard starts fresh.', ephemeral: true });
    }

    return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  },
};
