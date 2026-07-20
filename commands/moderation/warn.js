'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { sendModLog, dmUser } = require('../../utils/modLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn').setDescription('Warn a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false)),

  async execute(interaction) {
    const user   = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = interaction.guild.members.cache.get(user.id);

    if (!member) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'User not found in this server.' }, interaction.guild)], ephemeral: true });
    if (member.roles.highest.position >= interaction.member.roles.highest.position)
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'You cannot warn this user.' }, interaction.guild)], ephemeral: true });

    // Record case
    const cases     = readJson('cases.json', {});
    const guildCases = cases[interaction.guild.id] || [];
    const caseId    = guildCases.length + 1;
    guildCases.push({ id: caseId, type: 'warn', userId: user.id, userTag: user.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, timestamp: Date.now() });
    cases[interaction.guild.id] = guildCases;
    writeJson('cases.json', cases);

    // Count active warns
    const warnCount = guildCases.filter(c => c.type === 'warn' && c.userId === user.id).length;

    // DM + log
    await dmUser(user, 'warn', interaction.guild, reason, { caseId });
    await sendModLog(interaction.guild, 'warn', user, interaction.user, reason, { caseId });

    // Public reply
    await interaction.reply({
      embeds: [createServerEmbed('success', {
        title: '⚠️ Warning Issued',
        description: `<@${user.id}> has been warned.`,
        fields: [
          { name: '📋 Reason',       value: reason,            inline: false },
          { name: '🗂️ Case',         value: `#${caseId}`,      inline: true  },
          { name: '📊 Total Warns',  value: `${warnCount}`,    inline: true  },
        ],
      }, interaction.guild)],
    });

    // Auto-punish
    const config      = readJson('config.json', {});
    const warnSettings = config[interaction.guild.id]?.warnSettings;
    if (warnSettings?.threshold && warnCount >= warnSettings.threshold) {
      const action = warnSettings.action || 'kick';
      try {
        if (action === 'kick') {
          await member.kick(`Auto-punish: reached ${warnSettings.threshold} warnings`);
        } else if (action === 'ban') {
          await interaction.guild.members.ban(user.id, { reason: `Auto-punish: reached ${warnSettings.threshold} warnings` });
        } else if (action === 'mute') {
          const duration = warnSettings.muteDuration || 3600000;
          await member.timeout(duration, `Auto-punish: reached ${warnSettings.threshold} warnings`);
        }
        await interaction.followUp({
          embeds: [createServerEmbed('info', {
            title: `🤖 Auto-Punishment: ${action.toUpperCase()}`,
            description: `<@${user.id}> was automatically ${action}ed after reaching **${warnSettings.threshold}** warnings.`,
          }, interaction.guild)],
        });
      } catch {}
    }
  },
};
