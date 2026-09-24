'use strict';

/**
 * /leaderboard — pure Discord embed (no PNG).
 * Server icon thumbnail · giveaway-style • separators · proportional XP bars.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');

const BRAND_PURPLE = 0x9397EE;
const RULE = '•  •  •  •  •  •  •  •  •  •  •  •';

/** Proportional bar vs leader XP — share of the ladder, not a spinner. */
function xpBar(xp, maxXp, cells = 12) {
  const pct = maxXp > 0 ? Math.max(0, Math.min(1, Number(xp) / maxXp)) : 0;
  const filled = Math.round(pct * cells);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, cells - filled));
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function serverIcon(guild) {
  try {
    return guild?.iconURL({ extension: 'png', size: 128 }) || null;
  } catch {
    return null;
  }
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
    const icon = serverIcon(interaction.guild);

    if (!ranked.length) {
      const empty = new EmbedBuilder()
        .setColor(BRAND_PURPLE)
        .setAuthor({ name: 'QuantLab  •  Ranks', iconURL: icon || undefined })
        .setTitle('XP ladder')
        .setDescription('No ranks yet — chat in allowed channels to earn **15–25 XP** per message.')
        .setFooter({ text: '15–25 XP / msg  •  60s cooldown  •  QuantLab' });
      if (icon) empty.setThumbnail(icon);
      return interaction.reply({ embeds: [empty] });
    }

    const maxXp = ranked[0].totalXp || 1;
    const top = ranked.slice(0, 3);
    const rest = ranked.slice(3, 10);

    const embed = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setAuthor({ name: 'QuantLab  •  Ranks', iconURL: icon || undefined })
      .setTitle('All-time XP ladder')
      .setDescription(RULE);

    const podiumMeta = [
      { idx: 1, label: '➁  Silver' },
      { idx: 0, label: '➀  Gold' },
      { idx: 2, label: '➂  Bronze' },
    ];

    for (const p of podiumMeta) {
      const u = top[p.idx];
      if (!u) {
        embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
        continue;
      }
      const share = maxXp > 0 ? Math.round((u.totalXp / maxXp) * 100) : 0;
      embed.addFields({
        name: p.label,
        value: [
          `<@${u.id}>`,
          `**${fmt(u.totalXp)}** XP`,
          `Level **${u.level}**`,
          `\`${xpBar(u.totalXp, maxXp, 10)}\` · ${share}%`,
        ].join('\n'),
        inline: true,
      });
    }

    embed.addFields({ name: '\u200b', value: RULE, inline: false });

    if (rest.length) {
      const body = rest.map((u, i) => {
        const rank = String(i + 4).padStart(2, '0');
        const share = maxXp > 0 ? Math.round((u.totalXp / maxXp) * 100) : 0;
        return (
          `\`${rank}\`  <@${u.id}>\n` +
          `  Lv **${u.level}** · **${fmt(u.totalXp)}** XP · \`${xpBar(u.totalXp, maxXp, 12)}\` ${share}%`
        );
      }).join('\n\n');

      embed.addFields({
        name: 'Ranks  4 – 10',
        value: body.slice(0, 1020),
        inline: false,
      });
    }

    if (icon) embed.setThumbnail(icon);

    embed.setFooter({
      text: `Top ${ranked.length}  •  15–25 XP / msg  •  60s cooldown  •  QuantLab`,
    });
    embed.setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
