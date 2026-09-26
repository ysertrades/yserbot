'use strict';

/**
 * /leaderboard — QuantLab Ladder Desk (top 10).
 * Full desk layout: header + gold / silver / bronze cards + field 4–10.
 * Progress bars always use the *current* curve (base + multiplier).
 * Short brand dividers only — no long rules that wrap on phones.
 * Buttons: Refresh (edit in place), Me (ephemeral rank card).
 * Does not touch the XP engine, role sync, or panel paths.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');
const { BRAND_PURPLE } = require('../../utils/dropFormat');

/** Short brand divider — stays on one phone line. */
const DIV = '✧ · · · · · · ✧';

const COLOR_GOLD = 0xc9a227;
const COLOR_SILVER = 0xa8b0c0;
const COLOR_BRONZE = 0xb87333;

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
        avatar: m.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null,
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
        avatar: m.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null,
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
        avatar: u.displayAvatarURL?.({ extension: 'png', size: 128 }) || null,
      });
    } catch {
      out.set(id, { label: '`' + id + '`', name: null, inGuild: false, avatar: null });
    }
  }
  return out;
}

function who(resolved, id) {
  const r = resolved.get(id);
  if (r?.label) return r.label;
  return '<@' + id + '>';
}

function medalCard(rank, u, resolved, color, title) {
  const into = u.into ?? 0;
  const need = u.need ?? 1;
  const pct = levelPct(into, need);
  const bar = levelBar(into, need, 12);
  const avatar = resolved.get(u.id)?.avatar || null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      [
        who(resolved, u.id),
        '**' + fmt(u.totalXp) + '** XP  ·  Level **' + u.level + '**',
        '`' + bar + '`  **' + pct + '%** into next',
      ].join('\n'),
    );

  if (avatar) embed.setThumbnail(avatar);
  return embed;
}

function buildDeskPayload(guild, ranked, resolved) {
  const icon = serverIcon(guild);
  const embeds = [];

  const header = new EmbedBuilder()
    .setColor(BRAND_PURPLE)
    .setAuthor({ name: 'QuantLab  ·  Ladder Desk', iconURL: icon || undefined })
    .setTitle('TOP 10  ·  All-time XP')
    .setDescription(
      'Progress bars use the **current** curve  ·  into next level\n' + DIV,
    )
    .setFooter({
      text: 'Top ' + ranked.length + '  ·  curve live  ·  QuantLab',
    })
    .setTimestamp();
  if (icon) header.setThumbnail(icon);
  embeds.push(header);

  const medals = [
    { idx: 0, color: COLOR_GOLD, title: '➀  Gold' },
    { idx: 1, color: COLOR_SILVER, title: '➁  Silver' },
    { idx: 2, color: COLOR_BRONZE, title: '➂  Bronze' },
  ];

  for (const m of medals) {
    const u = ranked[m.idx];
    if (!u) continue;
    embeds.push(medalCard(m.idx + 1, u, resolved, m.color, m.title));
  }

  const rest = ranked.slice(3, 10);
  if (rest.length) {
    const lines = rest.map((u, i) => {
      const rank = String(i + 4).padStart(2, '0');
      const into = u.into ?? 0;
      const need = u.need ?? 1;
      const pct = levelPct(into, need);
      return (
        '`' + rank + '`  ' + who(resolved, u.id) +
        '  ·  Lv **' + u.level + '**  ·  **' + fmt(u.totalXp) + '** XP\n' +
        ' `' + levelBar(into, need, 10) + '`  ' + pct + '%'
      );
    });

    const field = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setTitle(DIV + '  4 – 10  ' + DIV)
      .setDescription(lines.join('\n\n').slice(0, 3900));
    embeds.push(field);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lb:refresh')
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lb:me')
      .setLabel('Me')
      .setEmoji('📍')
      .setStyle(ButtonStyle.Primary),
  );

  const mentionIds = ranked
    .filter((r) => resolved.get(r.id)?.inGuild)
    .map((r) => r.id);

  return {
    embeds,
    components: [row],
    allowedMentions: { parse: [], users: mentionIds },
  };
}

async function buildLiveDesk(guild) {
  const ranked = levelingEngine.getLeaderboard(guild.id, 10);
  if (!ranked.length) {
    const icon = serverIcon(guild);
    const empty = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setAuthor({ name: 'QuantLab  ·  Ladder Desk', iconURL: icon || undefined })
      .setTitle('TOP 10  ·  All-time XP')
      .setDescription('No ranks yet — chat in allowed channels to earn XP.')
      .setFooter({ text: 'QuantLab ranks' });
    if (icon) empty.setThumbnail(icon);
    return {
      embeds: [empty],
      components: [],
      allowedMentions: { parse: [] },
    };
  }

  const resolved = await resolveMentions(
    guild,
    ranked.map((r) => r.id),
  );
  return buildDeskPayload(guild, ranked, resolved);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top 10 members by Quantlab XP — Ladder Desk'),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({
        content: 'Leveling is turned off on this server.',
        ephemeral: true,
      });
    }

    const payload = await buildLiveDesk(interaction.guild);
    return interaction.reply(payload);
  },

  /** Button handler — routed from interactionCreate for customId lb:* */
  async handleButton(interaction) {
    const id = interaction.customId;

    if (!interaction.guild || !isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({
        content: 'Leveling is turned off on this server.',
        ephemeral: true,
      }).catch(() => {});
    }

    if (id === 'lb:refresh') {
      const payload = await buildLiveDesk(interaction.guild);
      try {
        return await interaction.update(payload);
      } catch {
        return interaction.reply({
          content: 'Could not refresh — run `/leaderboard` again.',
          ephemeral: true,
        }).catch(() => {});
      }
    }

    if (id === 'lb:me') {
      const snap = levelingEngine.getUserRank(
        interaction.guild.id,
        interaction.user.id,
      );
      const u = snap.user;
      const into = u.xp ?? 0;
      const need = u.neededXp ?? 1;
      const pct = levelPct(into, need);
      const bar = levelBar(into, need, 12);

      const lines = [
        snap.rank
          ? '**#' + snap.rank + '** of **' + snap.tracked + '** ranked'
          : 'Not ranked yet — chat to earn XP',
        'Level **' + u.level + '**  ·  **' + fmt(u.totalXp || 0) + '** XP',
        '`' + bar + '`  **' + pct + '%** into next',
        DIV,
        'Bars follow the **current** curve.',
      ];

      const embed = new EmbedBuilder()
        .setColor(BRAND_PURPLE)
        .setAuthor({
          name: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
          iconURL: interaction.user.displayAvatarURL({ extension: 'png', size: 64 }),
        })
        .setTitle('Your ladder position')
        .setDescription(lines.join('\n'));

      return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
    }

    return interaction.deferUpdate().catch(() => {});
  },
};
