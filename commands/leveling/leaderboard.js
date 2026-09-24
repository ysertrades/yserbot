'use strict';

/**
 * /leaderboard — pure Discord embed (no PNG).
 * Top 3 as side-by-side podium fields; 4–10 with unicode XP bars.
 * Designed to stay fully readable in chat without opening attachments.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');

const BRAND_PURPLE = 0x9397EE;

/** Block-character bar relative to the leader's XP (10 cells). */
function xpBar(xp, maxXp, cells = 10) {
  const pct = maxXp > 0 ? Math.max(0, Math.min(1, xp / maxXp)) : 0;
  const filled = Math.round(pct * cells);
  return '▓'.repeat(filled) + '░'.repeat(cells - filled);
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top members by Quantlab XP'),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({ content: 'Leveling is turned off on this server.', ephemeral: true });
    }

    const ranked = levelingEngine.getLeaderboard(interaction.guild.id, 10);

    if (!ranked.length) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(BRAND_PURPLE)
          .setTitle('QuantLab · Ranks')
          .setDescription(
            '```\n' +
            '  no ranks yet\n' +
            '  chat to earn 15–25 XP / msg\n' +
            '```',
          )],
      });
    }

    const maxXp = ranked[0].totalXp || 1;
    const top = ranked.slice(0, 3);
    const rest = ranked.slice(3, 10);

    const header = [
      '**All-time XP ladder**',
      '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄',
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setTitle('QuantLab · Ranks')
      .setDescription(header);

    // Top 3 podium: #2 · #1 · #3 (inline → three columns)
    const podiumMeta = [
      { idx: 1, badge: '◇  SILVER', mark: '➁' },
      { idx: 0, badge: '◆  GOLD',   mark: '➀' },
      { idx: 2, badge: '◇  BRONZE', mark: '➂' },
    ];

    for (const p of podiumMeta) {
      const u = top[p.idx];
      if (!u) {
        embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
        continue;
      }
      const bar = xpBar(u.totalXp, maxXp, 8);
      embed.addFields({
        name: `${p.mark}  ${p.badge}`,
        value: [
          `<@${u.id}>`,
          `**${fmt(u.totalXp)}** XP`,
          `Lv **${u.level}**`,
          `\`${bar}\``,
        ].join('\n'),
        inline: true,
      });
    }

    embed.addFields({
      name: '\u200b',
      value: '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄',
      inline: false,
    });

    if (rest.length) {
      const body = rest.map((u, i) => {
        const rank = String(i + 4).padStart(2, '0');
        const bar = xpBar(u.totalXp, maxXp, 10);
        return `\`${rank}\`  <@${u.id}>\n  Lv **${u.level}** · **${fmt(u.totalXp)}** XP  ·  \`${bar}\``;
      }).join('\n\n');

      embed.addFields({
        name: 'ranks  4 – 10',
        value: body.slice(0, 1020),
        inline: false,
      });
    }

    try {
      const leader = ranked[0];
      let member = interaction.guild.members.cache.get(leader.id);
      if (!member) member = await interaction.guild.members.fetch(leader.id).catch(() => null);
      const avatarUrl = member
        ? member.displayAvatarURL({ extension: 'png', size: 128 })
        : null;
      if (avatarUrl) embed.setThumbnail(avatarUrl);
    } catch {}

    embed.setFooter({
      text: `Top ${ranked.length}  ·  15–25 XP / msg  ·  60s cooldown  ·  QuantLab`,
    });
    embed.setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
