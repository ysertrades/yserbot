'use strict';

/**
 * /leaderboard — QuantLab Ladder Desk (top 10) · one embed.
 *
 * Layout:
 *  - Generated podium image: top 3 faces in a row + ranks 4–10 below
 *  - Inline Gold / Silver / Bronze fields with live progress bars
 *  - Field list 4–10 with bars
 *  - Hard separator line above the action zone
 *  - Action rows (select + buttons) — only valid Discord emojis
 *
 * Progress bars always use the *current* curve (base + multiplier).
 * Image generation failures never kill the command (text board still sends).
 * Does not touch the XP engine, role sync, or panel paths.
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  AttachmentBuilder,
} = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');
const { BRAND_PURPLE } = require('../../utils/dropFormat');

let generateLeaderboardImage = null;
let fetchAvatarPng = null;
try {
  generateLeaderboardImage = require('../../utils/leaderboardVisual').generateLeaderboardImage;
  fetchAvatarPng = require('../../utils/avatarUtil').fetchAvatarPng;
} catch (err) {
  console.warn('[leaderboard] visual modules unavailable:', err.message || err);
}

/** Short brand divider — stays on one phone line. */
const DIV = '✧ · · · · · · ✧';
/** Hard straight rule above the action zone. */
const HARD_LINE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

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
        avatar: m.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null,
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
        avatar: m.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null,
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
        avatar: u.displayAvatarURL?.({ extension: 'png', size: 256 }) || null,
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

function medalField(label, u, resolved) {
  const into = u.into ?? 0;
  const need = u.need ?? 1;
  const pct = levelPct(into, need);
  return {
    name: label,
    value: [
      who(resolved, u.id),
      '**' + fmt(u.totalXp) + '** XP · Lv **' + u.level + '**',
      '`' + levelBar(into, need, 10) + '` **' + pct + '%**',
    ].join('\n'),
    inline: true,
  };
}

/** Only Unicode emojis Discord accepts on buttons/selects (no block glyphs). */
function buildActionRows() {
  const mode = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('lb:mode')
      .setPlaceholder('Board · All-time XP')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('All-time XP')
          .setDescription('Top 10 by total QuantLab XP')
          .setValue('alltime')
          .setEmoji('🏆')
          .setDefault(true),
        new StringSelectMenuOptionBuilder()
          .setLabel('Curve live')
          .setDescription('Bars follow current base × mult')
          .setValue('curve')
          .setEmoji('📈'),
      ),
  );

  const rowPrimary = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lb:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('lb:me').setLabel('Me').setEmoji('📍').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('lb:climb').setLabel('Climb').setEmoji('📈').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('lb:podium').setLabel('Podium').setEmoji('🥇').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('lb:field').setLabel('4-10').setEmoji('📋').setStyle(ButtonStyle.Secondary),
  );

  const rowSecondary = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lb:curve').setLabel('Curve').setEmoji('📉').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('lb:bars').setLabel('How bars work').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('lb:top1').setLabel('#1').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('lb:top2').setLabel('#2').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('lb:top3').setLabel('#3').setStyle(ButtonStyle.Secondary),
  );

  const rowTertiary = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lb:xp').setLabel('My XP').setEmoji('✨').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('lb:tracked').setLabel('Tracked').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('lb:help').setLabel('Help').setEmoji('❓').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('lb:refresh2').setLabel('Hard refresh').setEmoji('♻️').setStyle(ButtonStyle.Danger),
  );

  return [mode, rowPrimary, rowSecondary, rowTertiary];
}

async function buildImageAttachment(ranked, resolved) {
  if (typeof generateLeaderboardImage !== 'function' || typeof fetchAvatarPng !== 'function') {
    return null;
  }

  const entries = [];
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const meta = resolved.get(r.id) || {};
    let avatarPng = null;
    if (meta.avatar) {
      try {
        avatarPng = await fetchAvatarPng(meta.avatar);
      } catch {
        avatarPng = null;
      }
    }
    entries.push({
      rank: i + 1,
      name: meta.name || 'Unknown',
      level: r.level,
      totalXp: r.totalXp,
      avatarPng,
    });
  }

  try {
    const buf = generateLeaderboardImage({
      entries,
      title: 'QUANTLAB LADDER',
      subtitle: 'TOP 10 · CURVE LIVE',
    });
    if (!buf || !Buffer.isBuffer(buf)) return null;
    return new AttachmentBuilder(buf, { name: 'ladder-desk.png' });
  } catch (err) {
    console.warn('[leaderboard] image gen failed:', err.message || err);
    return null;
  }
}

async function buildLiveDesk(guild) {
  const ranked = levelingEngine.getLeaderboard(guild.id, 10);
  const icon = serverIcon(guild);

  if (!ranked.length) {
    const empty = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setAuthor({ name: 'QuantLab  ·  Ladder Desk', iconURL: icon || undefined })
      .setTitle('TOP 10  ·  All-time XP')
      .setDescription('No ranks yet — chat in allowed channels to earn XP.\n\n' + HARD_LINE)
      .setFooter({ text: 'QuantLab ranks  ·  actions below' });
    if (icon) empty.setThumbnail(icon);
    return {
      embeds: [empty],
      components: buildActionRows(),
      files: [],
      allowedMentions: { parse: [] },
    };
  }

  const resolved = await resolveMentions(
    guild,
    ranked.map((r) => r.id),
  );

  let file = null;
  try {
    file = await buildImageAttachment(ranked, resolved);
  } catch (err) {
    console.warn('[leaderboard] attachment build failed:', err.message || err);
    file = null;
  }

  const embed = new EmbedBuilder()
    .setColor(BRAND_PURPLE)
    .setAuthor({ name: 'QuantLab  ·  Ladder Desk', iconURL: icon || undefined })
    .setTitle('TOP 10  ·  All-time XP')
    .setDescription(
      [
        'Podium faces in a **row** · ranks **4–10** under them',
        'Progress bars use the **current** curve · into next level',
        DIV,
      ].join('\n'),
    );

  const medals = [
    { idx: 0, label: '➀ Gold' },
    { idx: 1, label: '➁ Silver' },
    { idx: 2, label: '➂ Bronze' },
  ];
  for (const m of medals) {
    const u = ranked[m.idx];
    if (u) embed.addFields(medalField(m.label, u, resolved));
  }

  const rest = ranked.slice(3, 10);
  if (rest.length) {
    const lines = rest.map((u, i) => {
      const rank = String(i + 4).padStart(2, '0');
      const into = u.into ?? 0;
      const need = u.need ?? 1;
      const pct = levelPct(into, need);
      return (
        '`' + rank + '` ' + who(resolved, u.id) +
        ' · Lv **' + u.level + '** · **' + fmt(u.totalXp) + '** XP\n' +
        ' `' + levelBar(into, need, 10) + '` ' + pct + '%'
      );
    });
    embed.addFields({
      name: DIV + '  4 – 10  ' + DIV,
      value: lines.join('\n\n').slice(0, 1020),
      inline: false,
    });
  }

  embed.addFields({
    name: '\u200b',
    value: HARD_LINE + '\n**Actions** · board controls below this line',
    inline: false,
  });

  embed.setFooter({
    text: 'Top ' + ranked.length + '  ·  curve live  ·  QuantLab',
  });
  embed.setTimestamp();

  if (file) {
    embed.setImage('attachment://ladder-desk.png');
  } else if (icon) {
    embed.setThumbnail(icon);
  }

  const mentionIds = ranked
    .filter((r) => resolved.get(r.id)?.inGuild)
    .map((r) => r.id);

  return {
    embeds: [embed],
    components: buildActionRows(),
    files: file ? [file] : [],
    allowedMentions: { parse: [], users: mentionIds },
  };
}

function ephemeralCard(interaction, title, lines) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_PURPLE)
    .setAuthor({
      name: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
      iconURL: interaction.user.displayAvatarURL({ extension: 'png', size: 64 }),
    })
    .setTitle(title)
    .setDescription(lines.join('\n'));
  return interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
}

async function replyMyRank(interaction) {
  const snap = levelingEngine.getUserRank(interaction.guild.id, interaction.user.id);
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
    'Bars follow the **current** curve (base × multiplier).',
  ];
  return ephemeralCard(interaction, 'Your ladder position', lines);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top 10 QuantLab XP — Ladder Desk (podium + bars)'),

  async execute(interaction) {
    try {
      if (!interaction.guild) {
        return interaction.reply({ content: 'Use this in a server.', ephemeral: true });
      }
      if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
        return interaction.reply({
          content: 'Leveling is turned off on this server.',
          ephemeral: true,
        });
      }

      await interaction.deferReply();
      const payload = await buildLiveDesk(interaction.guild);
      return await interaction.editReply(payload);
    } catch (err) {
      console.error('[leaderboard] execute failed:', err);
      const msg = {
        content: 'Could not build the ladder right now. Try again in a moment.',
        ephemeral: true,
      };
      try {
        if (interaction.deferred || interaction.replied) {
          return await interaction.editReply({
            content: 'Could not build the ladder right now. Try again in a moment.',
            embeds: [],
            components: [],
            files: [],
          });
        }
        return await interaction.reply(msg);
      } catch {
        return null;
      }
    }
  },

  async handleButton(interaction) {
    const id = interaction.customId;

    try {
      if (!interaction.guild || !isFeatureEnabled(interaction.guild.id, 'leveling')) {
        return interaction.reply({
          content: 'Leveling is turned off on this server.',
          ephemeral: true,
        }).catch(() => {});
      }

      if (id === 'lb:mode') {
        const value = interaction.values?.[0] || 'alltime';
        if (value === 'curve') {
          return ephemeralCard(interaction, 'Curve live', [
            'Every progress bar is computed from the **current** XP curve.',
            'Change **base** or **multiplier** in the panel → bars update on next Refresh.',
            DIV,
            '`into / need` · percent into the next level.',
          ]);
        }
        await interaction.deferUpdate();
        const payload = await buildLiveDesk(interaction.guild);
        return interaction.editReply(payload).catch(() => {});
      }

      if (id === 'lb:refresh' || id === 'lb:refresh2' || id === 'lb:desk') {
        await interaction.deferUpdate();
        const payload = await buildLiveDesk(interaction.guild);
        return interaction.editReply(payload).catch(() => {});
      }

      if (id === 'lb:me' || id === 'lb:me2' || id === 'lb:xp' || id === 'lb:next') {
        return replyMyRank(interaction);
      }

      if (id === 'lb:climb') {
        const snap = levelingEngine.getUserRank(interaction.guild.id, interaction.user.id);
        const lines = [
          snap.rank
            ? 'You are **#' + snap.rank + '** on the all-time ladder.'
            : 'You are not on the ladder yet — earn XP to appear.',
          'Climb the board by posting in tracked channels (and journals when enabled).',
          DIV,
          'Hit **Refresh** after you gain XP to see moves.',
        ];
        return ephemeralCard(interaction, 'Climb', lines);
      }

      if (id === 'lb:podium') {
        const ranked = levelingEngine.getLeaderboard(interaction.guild.id, 3);
        if (!ranked.length) {
          return ephemeralCard(interaction, 'Podium', ['No ranks yet.']);
        }
        const resolved = await resolveMentions(interaction.guild, ranked.map((r) => r.id));
        const lines = ranked.map((u, i) => {
          const medal = ['➀ Gold', '➁ Silver', '➂ Bronze'][i] || '#' + (i + 1);
          const pct = levelPct(u.into, u.need);
          return (
            '**' + medal + '**  ' + who(resolved, u.id) +
            '\nLv **' + u.level + '** · **' + fmt(u.totalXp) + '** XP'
            + '\n`' + levelBar(u.into, u.need, 10) + '` ' + pct + '%'
          );
        });
        return ephemeralCard(interaction, 'Podium · Top 3', lines);
      }

      if (id === 'lb:field') {
        const ranked = levelingEngine.getLeaderboard(interaction.guild.id, 10).slice(3);
        if (!ranked.length) {
          return ephemeralCard(interaction, 'Ranks 4–10', ['Fewer than 4 members ranked.']);
        }
        const resolved = await resolveMentions(interaction.guild, ranked.map((r) => r.id));
        const lines = ranked.map((u, i) => {
          const rank = String(i + 4).padStart(2, '0');
          const pct = levelPct(u.into, u.need);
          return (
            '`' + rank + '` ' + who(resolved, u.id) +
            ' · Lv **' + u.level + '** · **' + fmt(u.totalXp) + '** XP'
            + '\n `' + levelBar(u.into, u.need, 10) + '` ' + pct + '%'
          );
        });
        return ephemeralCard(interaction, 'Field · 4–10', lines);
      }

      if (id === 'lb:curve' || id === 'lb:bars') {
        return ephemeralCard(interaction, 'How bars work', [
          'Each bar is **into next level ÷ XP needed for that level**.',
          'Needed XP comes from the guild **curve** (quadratic or exponential).',
          'Panel **base** / **multiplier** changes recompute bars on the next Refresh.',
          DIV,
          'Image podium + text bars both use the same live engine numbers.',
        ]);
      }

      if (id === 'lb:top1' || id === 'lb:top2' || id === 'lb:top3') {
        const idx = id === 'lb:top1' ? 0 : id === 'lb:top2' ? 1 : 2;
        const ranked = levelingEngine.getLeaderboard(interaction.guild.id, 3);
        const u = ranked[idx];
        if (!u) {
          return ephemeralCard(interaction, 'Podium slot', ['That podium seat is empty.']);
        }
        const resolved = await resolveMentions(interaction.guild, [u.id]);
        const pct = levelPct(u.into, u.need);
        const title = ['#1 Gold', '#2 Silver', '#3 Bronze'][idx];
        return ephemeralCard(interaction, title, [
          who(resolved, u.id),
          'Level **' + u.level + '** · **' + fmt(u.totalXp) + '** XP',
          '`' + levelBar(u.into, u.need, 12) + '` **' + pct + '%** into next',
        ]);
      }

      if (id === 'lb:tracked') {
        const ranked = levelingEngine.getLeaderboard(interaction.guild.id, 10);
        const snap = levelingEngine.getUserRank(interaction.guild.id, interaction.user.id);
        return ephemeralCard(interaction, 'Tracked members', [
          'Showing **top ' + ranked.length + '** on this board.',
          'Server tracked (with XP): **' + (snap.tracked || 0) + '**.',
          DIV,
          'Only members with XP appear on the ladder.',
        ]);
      }

      if (id === 'lb:help') {
        return ephemeralCard(interaction, 'Ladder Desk help', [
          '**Refresh** — rebuild podium image + bars from live XP',
          '**Me / My XP** — your rank and progress bar',
          '**Podium / 4–10** — quick slices of the board',
          '**Curve / How bars work** — how progress is calculated',
          DIV,
          'Buttons sit **below** the hard line — Discord places components under the embed.',
        ]);
      }

      return interaction.deferUpdate().catch(() => {});
    } catch (err) {
      console.error('[leaderboard] handleButton failed:', id, err);
      return interaction.reply({
        content: 'That action failed. Try **Refresh** or run `/leaderboard` again.',
        ephemeral: true,
      }).catch(() => {});
    }
  },

  async handleSelect(interaction) {
    return this.handleButton(interaction);
  },
};
