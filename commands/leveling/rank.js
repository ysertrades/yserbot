'use strict';

/**
 * /rank — member-pad style embed (no pixel PNG).
 * Hero line: **name** · rank · level · two stat cards · badges if economy on.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');
const { getEquipped } = require('../../utils/badgeManager');
const { BADGE_DEFS } = require('../../utils/badges');
const { BRAND_PURPLE } = require('../../utils/dropFormat');

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function badgeLabels(userId, guildId) {
  const ids = getEquipped(userId, guildId) || [];
  if (!ids.length) return [];
  return ids.map((id) => {
    const def = BADGE_DEFS[id];
    if (!def) return String(id);
    return (def.emoji ? def.emoji + ' ' : '') + (def.label || id);
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Your Quantlab rank — level and XP')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Member to view').setRequired(false),
    ),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({
        content: 'Leveling is turned off on this server.',
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser('user') || interaction.user;
    const member =
      interaction.options.getMember('user') ||
      (user.id === interaction.user.id ? interaction.member : null);

    let displayName = user.globalName || user.username;
    try {
      if (member?.displayName) displayName = member.displayName;
      else if (!member) {
        const m = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (m?.displayName) displayName = m.displayName;
      }
    } catch { /* keep username */ }

    const snap = levelingEngine.getUserRank(interaction.guild.id, user.id);
    const u = snap.user;
    const into = u.xp ?? 0;
    const need = u.neededXp ?? 1;

    const avatar =
      user.displayAvatarURL({ extension: 'png', size: 128 }) || undefined;

    // Single hero line first — bold name (was author), no @handle, no top author row
    const hero = ['**' + displayName + '**'];
    if (snap.rank) {
      hero.push('**#' + snap.rank + '** of ' + snap.tracked + ' ranked');
    } else {
      hero.push('Not ranked yet — chat to earn XP');
    }
    hero.push('**Level ' + u.level + '**');

    const embed = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setThumbnail(avatar || null)
      .setDescription(hero.join('  ·  '));

    embed.addFields(
      {
        name: 'Into next level',
        value: '**' + fmt(into) + '** / **' + fmt(need) + '** XP',
        inline: true,
      },
      {
        name: 'Total XP',
        value: '**' + fmt(u.totalXp || 0) + '**',
        inline: true,
      },
    );

    if (isFeatureEnabled(interaction.guild.id, 'economy')) {
      const labels = badgeLabels(user.id, interaction.guild.id);
      if (labels.length) {
        embed.addFields({
          name: 'Badges',
          value: labels.map((l) => '`' + l + '`').join('  '),
          inline: false,
        });
      }
    }

    return interaction.reply({ embeds: [embed] });
  },
};
