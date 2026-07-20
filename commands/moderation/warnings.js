'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { readJson } = require('../../utils/jsonStorage');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warnings').setDescription('View warnings for a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(true)),

  async execute(interaction) {
    const user       = interaction.options.getUser('user');
    const cases      = readJson('cases.json', {});
    const guildCases = cases[interaction.guild.id] || [];
    const warns      = guildCases.filter(c => c.type === 'warn' && c.userId === user.id);

    const embed = new EmbedBuilder()
      .setColor(warns.length === 0 ? 0x2ecc71 : warns.length < 3 ? 0xf1c40f : 0xe74c3c)
      .setTitle(`⚠️ Warnings — ${user.tag}`)
      .setThumbnail(user.displayAvatarURL({ dynamic: true }))
      .setDescription(warns.length === 0
        ? '✅ This user has no warnings.'
        : warns.map((w, i) =>
            `**#${i + 1}** — <t:${Math.floor(w.timestamp / 1000)}:R>\n> ${w.reason}\n> *by <@${w.moderatorId}>* (Case #${w.id})`
          ).join('\n\n'))
      .setFooter({ text: `${warns.length} warning${warns.length !== 1 ? 's' : ''} total` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
