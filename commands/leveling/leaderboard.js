'use strict';

/**
 * /leaderboard — Components V2 card (same separators as giveaways).
 * Separators: utils/dropCardV2 pattern — type 14, divider: true.
 * Progress = XP into next level; mentions resolved when in guild.
 */

const { SlashCommandBuilder } = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');

/** Same flag + separator primitive as utils/dropCardV2.js (giveaways). */
const IS_COMPONENTS_V2 = 1 << 15;
const ACCENT = 0x9397EE;

function text(content) {
  return { type: 10, content: String(content).slice(0, 4000) };
}
function separator(divider = true) {
  return { type: 14, divider: !!divider, spacing: 1 };
}
function sectionWithThumb(content, iconUrl) {
  if (!iconUrl) return text(content);
  return {
    type: 9,
    components: [text(content)],
    accessory: { type: 11, media: { url: iconUrl } },
  };
}
function container(children, accent = ACCENT) {
  return { type: 17, accent_color: accent, components: children.filter(Boolean) };
}

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
  } catch { /* per-id below */ }

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

function podiumBlock(u, label, resolved) {
  if (!u) return null;
  const into = u.into ?? 0;
  const need = u.need ?? 1;
  const pct = levelPct(into, need);
  return (
    '**' + label + '** — ' + who(resolved, u.id) + '\n' +
    '**' + fmt(u.totalXp) + '** XP · Level **' + u.level + '**\n' +
    '`' + levelBar(into, need, 10) + '` · ' + pct + '%'
  );
}

function rankLine(u, rank, resolved) {
  const into = u.into ?? 0;
  const need = u.need ?? 1;
  const pct = levelPct(into, need);
  const r = String(rank).padStart(2, '0');
  return (
    '`' + r + '`  ' + who(resolved, u.id) + '\n' +
    'Lv **' + u.level + '** · **' + fmt(u.totalXp) + '** XP · `' +
    levelBar(into, need, 12) + '` ' + pct + '%'
  );
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
      const kids = [
        sectionWithThumb('# QuantLab · Ranks\n\nNo ranks yet — chat in allowed channels to earn **15–25 XP** per message.', icon),
        separator(true),
        text('-# 15–25 XP / msg  ·  60s cooldown  ·  QuantLab'),
      ];
      return interaction.reply({
        flags: IS_COMPONENTS_V2,
        components: [container(kids)],
      });
    }

    const resolved = await resolveMentions(
      interaction.guild,
      ranked.map((r) => r.id),
    );

    const top = ranked.slice(0, 3);
    const rest = ranked.slice(3, 10);

    const podiumParts = [
      podiumBlock(top[1], '➁ Silver', resolved),
      podiumBlock(top[0], '➀ Gold', resolved),
      podiumBlock(top[2], '➂ Bronze', resolved),
    ].filter(Boolean);

    const kids = [];

    kids.push(sectionWithThumb('# QuantLab · Ranks\nAll-time XP ladder', icon));
    kids.push(separator(true));
    kids.push(text(podiumParts.join('\n\n')));
    kids.push(separator(true));

    if (rest.length) {
      const body = rest.map((u, i) => rankLine(u, i + 4, resolved)).join('\n\n');
      kids.push(text('**Ranks 4 – 10**\n\n' + body.slice(0, 3800)));
    }

    kids.push(separator(true));
    kids.push(text(
      '-# Top ' + ranked.length + '  ·  progress = XP into next level  ·  QuantLab',
    ));

    const mentionIds = ranked.filter((r) => resolved.get(r.id)?.inGuild).map((r) => r.id);

    return interaction.reply({
      flags: IS_COMPONENTS_V2,
      components: [container(kids)],
      allowedMentions: { parse: [], users: mentionIds },
    });
  },
};
