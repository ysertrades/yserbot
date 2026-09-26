'use strict';

/**
 * /rank — member-pad style embed (no pixel PNG).
 * Hero line: **name** · rank · level · two stat cards · badges if economy on.
 * Progress bar always uses the *current* curve (base + multiplier).
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

function levelBar(into, need, cells = 10) {
  const n = Math.max(1, Number(need) || 1);
  const i = Math.max(0, Number(into) || 0);
  const pct = Math.max(0, Math.min(1, i / n));
  const filled = Math.round(pct * cells);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, cells - filled));
}

function levelPct(into, need) {
  const n = Math.max(1, Number(need) || 1);
  const i = Math.max(0, Number(into) || 0);
  return Math.round(Math.max(0, Math.min(1, i / n)) * 100);
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

    // Live from engine — into/need track the current curve base + multiplier
    const snap = levelingEngine.getUserRank(interaction.guild.id, user.id);
    const u = snap.user;
    const into = u.xp ?? 0;
    const need = u.neededXp ?? 1;
    const pct = levelPct(into, need);

    const avatar =
      user.displayAvatarURL({ extension: 'png', size: 128 }) || undefined;

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
        value: '**' + fmt(into) + '** / **' + fmt(need) + '** XP\n`' + levelBar(into, need, 10) + '` · ' + pct + '%',
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
