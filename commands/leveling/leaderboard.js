'use strict';

/**
 * /leaderboard — pure Discord embed (no PNG, no component bank).
 * Matches the classic QuantLab · Ranks layout:
 *   podium (Silver · Gold · Bronze inline) + ranks 4–10 + live progress bars.
 * Progress bars always use the *current* curve (base + multiplier).
 * Short dividers only — no long rules that wrap on phones.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');
const { BRAND_PURPLE } = require('../../utils/dropFormat');

/** Short brand divider — stays on one phone line. */
const DIV = '✧ · · · · · · ✧';

function levelBar(into, need, cells = 8) {
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

async function resolveMentions(guild, ids) {
  const out = new Map();
  if (!guild || !ids?.length) return out;

  try {
    const fetched = await guild.members.fetch({ user: ids.slice(0, 25) });
    for (const [id, m] of fetched) {
      out.set(id, {
        label: '<@' + id + '>',
        name: m.displayName || m.user?.globalName || m.user?.username || null,
        inGuild: true,
      });
    }
  } catch { /* fall through */ }

  for (const id of ids) {
    if (out.has(id)) continue;
    try {
      const m = await guild.members.fetch(id);
      out.set(id, {
        label: '<@' + id + '>',
        name: m.displayName || m.user?.globalName || m.user?.username || null,
        inGuild: true,
      });
      continue;
    } catch { /* not in guild */ }
    try {
      const u = await guild.client.users.fetch(id);
      const name = u.globalName || u.username || null;
      out.set(id, {
        label: name ? '**' + name + '**' : '`' + id + '`',
        name,
        inGuild: false,
      });
    } catch {
      out.set(id, { label: '`' + id + '`', name: null, inGuild: false });
    }
  }
  return out;
}

function who(resolved, id) {
  const r = resolved.get(id);
  if (r?.label) return r.label;
  return '<@' + id + '>';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top members by Quantlab XP'),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({
        content: 'Leveling is turned off on this server.',
        ephemeral: true,
      });
    }

    // Always live from engine — into/need follow the current curve base + multiplier
    const ranked = levelingEngine.getLeaderboard(interaction.guild.id, 10);
    const icon = serverIcon(interaction.guild);

    if (!ranked.length) {
      const empty = new EmbedBuilder()
        .setColor(BRAND_PURPLE)
        .setAuthor({ name: 'QuantLab  ·  Ranks', iconURL: icon || undefined })
        .setTitle('All-time XP ladder')
        .setDescription('No ranks yet — chat in allowed channels to earn XP.')
        .setFooter({ text: 'QuantLab ranks' });
      if (icon) empty.setThumbnail(icon);
      return interaction.reply({ embeds: [empty] });
    }

    const resolved = await resolveMentions(
      interaction.guild,
      ranked.map((r) => r.id),
    );

    const top = ranked.slice(0, 3);
    const rest = ranked.slice(3, 10);

    const embed = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setAuthor({ name: 'QuantLab  ·  Ranks', iconURL: icon || undefined })
      .setTitle('All-time XP ladder')
      .setDescription(DIV);

    // Display order matches classic podium: Silver · Gold · Bronze (left to right)
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
          who(resolved, u.id),
          '**' + fmt(u.totalXp) + '** XP',
          'Level **' + u.level + '**',
          '`' + levelBar(into, need, 8) + '`',
          pct + '%',
        ].join('\n'),
        inline: true,
      });
    }

    if (rest.length) {
      const body = rest
        .map((u, i) => {
          const rank = String(i + 4).padStart(2, '0');
          const into = u.into ?? 0;
          const need = u.need ?? 1;
          const pct = levelPct(into, need);
          return (
            '`' +
            rank +
            '` ' +
            who(resolved, u.id) +
            '\nLv **' +
            u.level +
            '** · **' +
            fmt(u.totalXp) +
            '** XP · `' +
            levelBar(into, need, 8) +
            '` ' +
            pct +
            '%'
          );
        })
        .join('\n\n');

      embed.addFields({
        name: 'Ranks 4 – 10',
        value: body.slice(0, 1020),
        inline: false,
      });
    }

    if (icon) embed.setThumbnail(icon);

    embed.setFooter({
      text:
        'Top ' +
        ranked.length +
        ' · progress = XP into next level · QuantLab',
    });
    embed.setTimestamp();

    const mentionIds = ranked
      .filter((r) => resolved.get(r.id)?.inGuild)
      .map((r) => r.id);

    return interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [], users: mentionIds },
    });
  },
};
