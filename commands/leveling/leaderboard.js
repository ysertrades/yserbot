'use strict';

/**
 * /leaderboard — pure Discord embed (no PNG).
 * Server icon · giveaway solidRule (─) separators · progress = XP into next level.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');
const { solidRule, BRAND_PURPLE } = require('../../utils/dropFormat');

/** Progress toward next level (into / need), not share of #1. */
function levelBar(into, need, cells = 12) {
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

/** Prefetch members so <@id> stays resolvable as profile mentions. */
async function prefetchMembers(guild, ids) {
  if (!guild?.members?.fetch || !ids?.length) return;
  try {
    await guild.members.fetch({ user: ids.slice(0, 25) });
  } catch {
    try {
      await Promise.all(
        ids.slice(0, 15).map((id) => guild.members.fetch(id).catch(() => null))
      );
    } catch {}
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
        .setAuthor({ name: 'QuantLab  ·  Ranks', iconURL: icon || undefined })
        .setTitle('XP ladder')
        .setDescription('No ranks yet — chat in allowed channels to earn **15–25 XP** per message.')
        .setFooter({ text: '15–25 XP / msg  ·  60s cooldown  ·  QuantLab' });
      if (icon) empty.setThumbnail(icon);
      return interaction.reply({ embeds: [empty] });
    }

    await prefetchMembers(interaction.guild, ranked.map((r) => r.id));

    const top = ranked.slice(0, 3);
    const rest = ranked.slice(3, 10);

    // Same solid ─ rule as giveaway embeds (utils/dropFormat.solidRule)
    const rule = solidRule(
      'All-time XP ladder',
      ...top.map((u) => (u ? `${fmt(u.totalXp)} XP Level ${u.level}` : '')),
      ...rest.map((u) => `Lv ${u.level} · ${fmt(u.totalXp)} XP`),
      'Ranks 4 – 10',
      'Top 10 · progress = XP into next level · QuantLab',
    );

    const embed = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setAuthor({ name: 'QuantLab  ·  Ranks', iconURL: icon || undefined })
      .setTitle('All-time XP ladder')
      .setDescription(rule);

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
      const into = u.into ?? 0;
      const need = u.need ?? 1;
      const pct = levelPct(into, need);
      embed.addFields({
        name: p.label,
        value: [
          `<@${u.id}>`,
          `**${fmt(u.totalXp)}** XP`,
          `Level **${u.level}**`,
          '`' + levelBar(into, need, 10) + '` · ' + pct + '%',
        ].join('\n'),
        inline: true,
      });
    }

    // Rule between podium and ranks 4–10
    embed.addFields({ name: '\u200b', value: rule, inline: false });

    if (rest.length) {
      const body = rest.map((u, i) => {
        const rank = String(i + 4).padStart(2, '0');
        const into = u.into ?? 0;
        const need = u.need ?? 1;
        const pct = levelPct(into, need);
        return (
          '`' + rank + '`  <@' + u.id + '>\n' +
          '  Lv **' + u.level + '** · **' + fmt(u.totalXp) + '** XP · `' + levelBar(into, need, 12) + '` ' + pct + '%'
        );
      }).join('\n\n');

      embed.addFields({
        name: 'Ranks  4 – 10',
        value: body.slice(0, 1020),
        inline: false,
      });
    }

    // Rule directly above the footer (same solid ─ as giveaways)
    embed.addFields({ name: '\u200b', value: rule, inline: false });

    if (icon) embed.setThumbnail(icon);

    embed.setFooter({
      text: 'Top ' + ranked.length + '  ·  progress = XP into next level  ·  QuantLab',
    });
    embed.setTimestamp();

    return interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [], users: [] },
    });
  },
};
