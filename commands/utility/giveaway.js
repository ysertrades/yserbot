'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { randomInt } = require('node:crypto');

const GOLD         = 0xFFD700;
const SETUP_EXPIRY = 10 * 60 * 1000; // 10 min
const MAX_WINNERS  = 10;

const giveawayTimers = new Map();
const ID_CHARS       = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ACTIVE_FILE    = 'giveaways_active.json';

// ── Active-giveaway persistence (survives bot restarts) ───────────────────────

function saveActiveGiveaway(msgId, data) {
  const all = readJson(ACTIVE_FILE, {});
  all[msgId] = data;
  writeJson(ACTIVE_FILE, all);
}

function removeActiveGiveaway(msgId) {
  const all = readJson(ACTIVE_FILE, {});
  if (!all[msgId]) return;
  delete all[msgId];
  writeJson(ACTIVE_FILE, all);
}

function getActiveGiveaway(msgId) {
  return readJson(ACTIVE_FILE, {})[msgId] ?? null;
}

function persistGiveawayEntry(msgId, entrants) {
  const all = readJson(ACTIVE_FILE, {});
  if (!all[msgId]) return;
  all[msgId].entrants = Array.from(entrants);
  writeJson(ACTIVE_FILE, all);
}

async function restoreGiveaways(client) {
  const active = readJson(ACTIVE_FILE, {});
  const now    = Date.now();
  if (!global.giveawayEntrants) global.giveawayEntrants = new Map();
  if (!global.giveawayMeta)     global.giveawayMeta     = new Map();

  for (const [msgId, data] of Object.entries(active)) {
    global.giveawayEntrants.set(msgId, new Set(data.entrants || []));
    global.giveawayMeta.set(msgId, {
      prize: data.prize, winners: data.winnersCount, imageUrl: data.imageUrl,
      hostId: data.hostId, endTime: data.endTime, guildId: data.guildId,
      requiredRoleId: data.requiredRoleId || null,
      bonusRoleId: data.bonusRoleId || null,
      minAccountAgeDays: data.minAccountAgeDays || 0,
    });

    // Re-fetch the message so the end-timer can edit it
    let msg;
    try {
      const ch = await client.channels.fetch(data.channelId);
      msg = await ch.messages.fetch(msgId);
    } catch {
      // Channel or message deleted while bot was offline — clean up
      removeActiveGiveaway(msgId);
      global.giveawayEntrants.delete(msgId);
      global.giveawayMeta.delete(msgId);
      continue;
    }

    const remaining = Math.max(data.endTime - now, 0);
    if (giveawayTimers.has(msgId)) clearTimeout(giveawayTimers.get(msgId));
    giveawayTimers.set(msgId, setTimeout(
      () => endGiveaway(msg, data.prize, data.winnersCount, data.imageUrl, data.hostId, data.guildId, data.bonusRoleId),
      remaining,
    ));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(guildId) {
  const existing = Object.keys(readJson('giveaways_ended.json', {})[guildId] || {});
  let id;
  do {
    id = Array.from({ length: 5 }, () => ID_CHARS[randomInt(ID_CHARS.length)]).join('');
  } while (existing.includes(id));
  return id;
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  return parseInt(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
}

function dateStr(ts) { return new Date(ts).toISOString().slice(0, 10); }

// Accepts "<@&123>", a raw role ID, or "clear"/"none" to unset. Returns
// { roleId } on success, { error } on failure, or {} to clear.
function parseRoleInput(value, guild) {
  if (!value) return {};
  const trimmed = value.trim();
  if (/^(clear|none|-)$/i.test(trimmed)) return {};
  const match = trimmed.match(/^<@&(\d+)>$/) || trimmed.match(/^(\d+)$/);
  if (!match) return { error: 'Couldn\'t parse that as a role. Use `@RoleName` (paste the mention), a role ID, or `clear`.' };
  const role = guild.roles.cache.get(match[1]);
  if (!role) return { error: 'That role wasn\'t found in this server.' };
  return { roleId: role.id, roleName: role.name };
}

function requirementsLines(data) {
  const lines = [];
  if (data.requiredRoleId) lines.push(`🔐 Requires <@&${data.requiredRoleId}>`);
  if (data.bonusRoleId) lines.push(`⭐ <@&${data.bonusRoleId}> gets **2×** entries`);
  if (data.minAccountAgeDays > 0) lines.push(`🕰️ Account must be **${data.minAccountAgeDays}+ days** old`);
  return lines;
}

// ── Setup session ─────────────────────────────────────────────────────────────

function ensureSessions() {
  if (!global.giveawaySessions) global.giveawaySessions = new Map();
}

function newSession(interaction) {
  ensureSessions();
  const sessionId = `${interaction.user.id}-${Date.now()}`;
  global.giveawaySessions.set(sessionId, {
    prize: null, duration: null, durationMs: null,
    winners: 1, imageUrl: null, mention: null,
    requiredRoleId: null, bonusRoleId: null, minAccountAgeDays: 0,
    channelId: interaction.channelId,
    guildId: interaction.guild.id,
    userId: interaction.user.id,
  });
  setTimeout(() => global.giveawaySessions?.delete(sessionId), SETUP_EXPIRY);
  return sessionId;
}

// ── Setup panel UI ────────────────────────────────────────────────────────────

function fieldVal(val, display, required) {
  if (val) return `> \`${display || val}\``;
  return required ? '> ⚠️  *Not set — required*' : '> —';
}

function buildSetupEmbed(data, guild) {
  const ready = !!(data.prize && data.durationMs);

  const lines = [
    `**🏆  Prize**\n${fieldVal(data.prize, data.prize, true)}`,
    `**⏱️  Duration**\n${fieldVal(data.duration, data.duration, true)}`,
    `**👥  Winners**\n> \`${data.winners}\``,
    `**📢  Channel**\n> <#${data.channelId}>`,
    `**🖼️  Image**\n${fieldVal(data.imageUrl, 'Attached', false)}`,
    `**📣  Mention**\n${fieldVal(data.mention, data.mention, false)}`,
    `**🔐  Required Role**\n${fieldVal(data.requiredRoleId, data.requiredRoleId ? `<@&${data.requiredRoleId}>` : null, false)}`,
    `**⭐  Bonus Role (2× entries)**\n${fieldVal(data.bonusRoleId, data.bonusRoleId ? `<@&${data.bonusRoleId}>` : null, false)}`,
    `**🕰️  Min. Account Age**\n${data.minAccountAgeDays > 0 ? `> \`${data.minAccountAgeDays} days\`` : '> —'}`,
  ];

  return new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: 'YSER Flow  •  Giveaway Setup', iconURL: guild.iconURL({ dynamic: true }) || undefined })
    .setTitle('🎟️  New Giveaway')
    .setDescription(
      '```\nConfigure each field below, then launch when ready.\n```\n' +
      lines.join('\n\n'),
    )
    .setFooter({
      text: ready
        ? '✅  All required fields set — ready to launch!'
        : '⚠️  Prize and Duration are required before launching',
    })
    .setTimestamp();
}

function buildSetupRows(sessionId, data) {
  const ready = !!(data.prize && data.durationMs);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`gaw_setup:prize:${sessionId}`)
        .setLabel('Prize').setEmoji('🏆')
        .setStyle(data.prize ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`gaw_setup:duration:${sessionId}`)
        .setLabel('Duration').setEmoji('⏱️')
        .setStyle(data.duration ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`gaw_setup:winners:${sessionId}`)
        .setLabel(`Winners: ${data.winners}`).setEmoji('👥')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`gaw_setup:channel:${sessionId}`)
        .setLabel('Channel').setEmoji('📢')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`gaw_setup:image:${sessionId}`)
        .setLabel('Image').setEmoji('🖼️')
        .setStyle(data.imageUrl ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`gaw_setup:mention:${sessionId}`)
        .setLabel('Mention').setEmoji('📣')
        .setStyle(data.mention ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`gaw_setup:requiredrole:${sessionId}`)
        .setLabel('Required Role').setEmoji('🔐')
        .setStyle(data.requiredRoleId ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`gaw_setup:bonusrole:${sessionId}`)
        .setLabel('Bonus Role').setEmoji('⭐')
        .setStyle(data.bonusRoleId ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`gaw_setup:minage:${sessionId}`)
        .setLabel('Min. Account Age').setEmoji('🕰️')
        .setStyle(data.minAccountAgeDays > 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`gaw_setup:launch:${sessionId}`)
        .setLabel('Launch').setEmoji('🚀')
        .setStyle(ready ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!ready),
      new ButtonBuilder()
        .setCustomId(`gaw_setup:cancel:${sessionId}`)
        .setLabel('Cancel').setEmoji('✖️')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ── Launch ────────────────────────────────────────────────────────────────────

async function launchGiveaway(interaction, data, sessionId) {
  const {
    prize, durationMs, winners, imageUrl, mention, channelId, guildId,
    requiredRoleId, bonusRoleId, minAccountAgeDays,
  } = data;

  // Resolve mention
  let content, mentionOpts;
  if (mention) {
    if (mention === '@everyone') {
      content = '@everyone'; mentionOpts = { parse: ['everyone'] };
    } else if (mention === '@here') {
      content = '@here'; mentionOpts = { parse: ['here'] };
    } else {
      const roleMatch = mention.match(/^<@&(\d+)>$/) || mention.match(/^(\d+)$/);
      const userMatch = mention.match(/^<@!?(\d+)>$/);
      if (roleMatch) {
        content = `<@&${roleMatch[1]}>`; mentionOpts = { roles: [roleMatch[1]] };
      } else if (userMatch) {
        content = `<@${userMatch[1]}>`; mentionOpts = { users: [userMatch[1]] };
      } else {
        content = mention; mentionOpts = { parse: [] };
      }
    }
  }

  const channel = interaction.guild.channels.cache.get(channelId);
  if (!channel) return interaction.reply({ content: '❌ Target channel not found.', ephemeral: true });

  const endTime      = Date.now() + durationMs;
  const endTimestamp = Math.floor(endTime / 1000);
  const reqLines      = requirementsLines(data);

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`🎟️  ${prize}`)
    .setDescription(
      `✨ Click **Enter** below to participate!\n\n` +
      `🏆 **Winners:** ${winners}\n` +
      `👤 **Hosted by:** <@${interaction.user.id}>\n` +
      `⏰ **Ends:** <t:${endTimestamp}:R>\n` +
      `📊 **Entries:** 0 participants` +
      (reqLines.length ? `\n\n${reqLines.join('\n')}` : ''),
    )
    .setFooter({ text: `Ends at | ${dateStr(endTime)}` })
    .setTimestamp(endTime);

  if (imageUrl) embed.setImage(imageUrl);
  embed.setThumbnail(interaction.guild.iconURL({ dynamic: true }) || interaction.user.displayAvatarURL());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_enter').setLabel('Enter').setStyle(ButtonStyle.Secondary).setEmoji('🎟️'),
    new ButtonBuilder().setCustomId('giveaway_participants').setLabel('Participants').setStyle(ButtonStyle.Secondary).setEmoji('🏅'),
  );

  const msg = await channel.send({ content, embeds: [embed], components: [row], allowedMentions: mentionOpts });

  global.giveawaySessions?.delete(sessionId);

  if (!global.giveawayEntrants) global.giveawayEntrants = new Map();
  if (!global.giveawayMeta)     global.giveawayMeta     = new Map();

  global.giveawayEntrants.set(msg.id, new Set());
  global.giveawayMeta.set(msg.id, {
    prize, winners, imageUrl, hostId: interaction.user.id, endTime, guildId,
    requiredRoleId, bonusRoleId, minAccountAgeDays,
  });

  // Persist so entries and the timer survive a bot restart
  saveActiveGiveaway(msg.id, {
    prize, winnersCount: winners, imageUrl: imageUrl || null,
    hostId: interaction.user.id, endTime, guildId, channelId: msg.channelId, entrants: [],
    requiredRoleId: requiredRoleId || null, bonusRoleId: bonusRoleId || null,
    minAccountAgeDays: minAccountAgeDays || 0,
  });

  if (giveawayTimers.has(msg.id)) clearTimeout(giveawayTimers.get(msg.id));
  giveawayTimers.set(msg.id, setTimeout(
    () => endGiveaway(msg, prize, winners, imageUrl, interaction.user.id, guildId, bonusRoleId),
    durationMs,
  ));

  await interaction.update({
    content: `🎉  Giveaway launched in ${channel}!`,
    embeds: [],
    components: [],
  });
}

// ── Pick winners (secure, weighted, deduped) ───────────────────────────────────
// `pool` may contain duplicate userIds (bonus entries) — the shuffle is
// weighted toward users with more entries, but each winner is still unique.

function pickWinners(pool, count) {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const winners = [];
  const seen = new Set();
  for (const id of shuffled) {
    if (seen.has(id)) continue;
    seen.add(id);
    winners.push(id);
    if (winners.length >= count) break;
  }
  return winners;
}

// Expands entrantIds into a weighted pool: bonus-role holders appear twice.
// Falls back to an unweighted (but still perfectly fair, 1-entry-each) pool
// if the bonus role isn't set or the member fetch fails for any reason.
async function buildWeightedPool(entrantIds, guild, bonusRoleId) {
  if (!bonusRoleId || entrantIds.length === 0) return entrantIds;
  let members;
  try { members = await guild.members.fetch({ user: entrantIds }); }
  catch { return entrantIds; }
  const pool = [];
  for (const id of entrantIds) {
    pool.push(id);
    if (members.get(id)?.roles.cache.has(bonusRoleId)) pool.push(id);
  }
  return pool;
}

// ── End giveaway ──────────────────────────────────────────────────────────────

async function endGiveaway(message, prize, winnersCount, imageUrl, hostId, guildId, bonusRoleId) {
  if (!global.giveawayEntrants) global.giveawayEntrants = new Map();
  const entrants = global.giveawayEntrants.get(message.id);

  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_ended').setLabel('Ended').setStyle(ButtonStyle.Secondary).setDisabled(true).setEmoji('🎟️'),
    new ButtonBuilder().setCustomId('giveaway_participants').setLabel('Participants').setStyle(ButtonStyle.Secondary).setEmoji('🏅'),
  );

  if (giveawayTimers.has(message.id)) { clearTimeout(giveawayTimers.get(message.id)); giveawayTimers.delete(message.id); }

  if (!entrants || entrants.size === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`🎟️  ${prize} — Ended`)
      .setDescription('No participants entered the giveaway.')
      .setFooter({ text: 'Better luck next time!' })
      .setTimestamp();
    if (imageUrl) embed.setImage(imageUrl);
    await message.edit({ embeds: [embed], components: [disabledRow] });
    removeActiveGiveaway(message.id);
    global.giveawayEntrants.delete(message.id);
    global.giveawayMeta?.delete(message.id);
    return;
  }

  const entrantIds     = Array.from(entrants);
  const pool           = await buildWeightedPool(entrantIds, message.guild, bonusRoleId);
  const winnerIds      = pickWinners(pool, winnersCount);
  const winnerMentions = winnerIds.map(id => `<@${id}>`).join(', ');

  const shortId  = genId(guildId);
  const allEnded = readJson('giveaways_ended.json', {});
  if (!allEnded[guildId]) allEnded[guildId] = {};
  allEnded[guildId][shortId] = {
    prize, hostId, winnersCount,
    imageUrl: imageUrl || null,
    messageId: message.id,
    channelId: message.channelId,
    entrants:  entrantIds,
    bonusRoleId: bonusRoleId || null,
    currentWinners: winnerIds,
  };
  writeJson('giveaways_ended.json', allEnded);

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`🎟️  ${prize} — Ended`)
    .setDescription(
      `🏆 **Winner${winnerIds.length > 1 ? 's' : ''}:** ${winnerMentions}\n\n` +
      `👤 **Hosted by:** <@${hostId}>\n` +
      `📊 **Total entries:** ${entrants.size}\n\n` +
      `🔁 To reroll, use \`/giveaway reroll\` or \`g.reroll ${shortId}\``,
    )
    .setFooter({ text: `Congratulations! 🎉 • ID: ${shortId}` })
    .setTimestamp();
  if (imageUrl) embed.setImage(imageUrl);

  await message.edit({ embeds: [embed], components: [disabledRow] });
  removeActiveGiveaway(message.id);
  global.giveawayEntrants.delete(message.id);
  global.giveawayMeta?.delete(message.id);

  // DM the winners — a small polish touch most giveaway bots skip.
  for (const id of winnerIds) {
    try {
      const user = await message.client.users.fetch(id);
      await user.send({ embeds: [new EmbedBuilder()
        .setColor(GOLD)
        .setTitle('🎉 You Won a Giveaway!')
        .setDescription(`You won **${prize}** in **${message.guild.name}**!\nContact the host, <@${hostId}>, to claim your prize.`)
        .setTimestamp()] });
    } catch { /* DMs closed — not fatal */ }
  }
}

async function earlyEndGiveaway(interaction, msgId) {
  const record = getActiveGiveaway(msgId);
  if (!record || record.guildId !== interaction.guild.id) {
    return interaction.reply({ content: '❌ No active giveaway found with that selection.', ephemeral: true });
  }
  let msg;
  try {
    const ch = await interaction.guild.channels.fetch(record.channelId);
    msg = await ch.messages.fetch(msgId);
  } catch {
    return interaction.reply({ content: '❌ Couldn\'t find the original giveaway message (it may have been deleted).', ephemeral: true });
  }
  await interaction.reply({ content: `✅ Ending **${record.prize}** now…`, ephemeral: true });
  await endGiveaway(msg, record.prize, record.winnersCount, record.imageUrl, record.hostId, record.guildId, record.bonusRoleId);
}

// ── Reroll (shared by the slash subcommand and the g.reroll text command) ─────

async function performReroll(guild, shortId) {
  const allEnded = readJson('giveaways_ended.json', {});
  const guildId  = guild.id;
  const data     = allEnded[guildId]?.[shortId.toLowerCase()];
  if (!data) return { error: `No ended giveaway found with ID \`${shortId}\`.` };
  if (!data.entrants || data.entrants.length === 0) return { error: 'This giveaway had no participants, cannot reroll.' };

  const pool       = await buildWeightedPool(data.entrants, guild, data.bonusRoleId);
  const newWinners = pickWinners(pool, data.winnersCount);

  data.currentWinners = newWinners;
  allEnded[guildId][shortId.toLowerCase()] = data;
  writeJson('giveaways_ended.json', allEnded);

  try {
    const channel = await guild.client.channels.fetch(data.channelId);
    const origMsg = await channel.messages.fetch(data.messageId);
    const updEmbed = new EmbedBuilder()
      .setColor(GOLD)
      .setTitle(`🎟️  ${data.prize} — Ended`)
      .setDescription(
        `🏆 **Winner${newWinners.length > 1 ? 's' : ''}:** ${newWinners.map(id => `<@${id}>`).join(', ')}\n\n` +
        `👤 **Hosted by:** <@${data.hostId}>\n` +
        `📊 **Total entries:** ${data.entrants.length}\n\n` +
        `🔁 To reroll, use \`/giveaway reroll\` or \`g.reroll ${shortId}\``,
      )
      .setFooter({ text: `Rerolled 🎲 • ID: ${shortId}` })
      .setTimestamp();
    if (data.imageUrl) updEmbed.setImage(data.imageUrl);
    await origMsg.edit({ embeds: [updEmbed] }).catch(() => {});
  } catch { /* original message may be gone — the reroll itself still succeeded */ }

  return { data, newWinners };
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway').setDescription('Create, end, reroll & list giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('create').setDescription('Open the giveaway setup panel'))
    .addSubcommand(s => s.setName('end').setDescription('End an active giveaway early and draw winners now')
      .addStringOption(o => o.setName('giveaway').setDescription('Which giveaway to end').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('reroll').setDescription('Pick new winner(s) for an ended giveaway')
      .addStringOption(o => o.setName('giveaway').setDescription('Which ended giveaway to reroll').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('list').setDescription('List all currently active giveaways in this server')),

  async autocomplete(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const q       = String(interaction.options.getFocused() || '').toLowerCase();
    let choices = [];

    if (sub === 'end') {
      const active = readJson(ACTIVE_FILE, {});
      choices = Object.entries(active)
        .filter(([, d]) => d.guildId === guildId)
        .map(([msgId, d]) => ({ name: `${d.prize} — ends <t:${Math.floor(d.endTime / 1000)}:R>`.slice(0, 100), value: msgId }));
    } else if (sub === 'reroll') {
      const ended = readJson('giveaways_ended.json', {})[guildId] || {};
      choices = Object.entries(ended)
        .map(([id, d]) => ({ name: `${d.prize} (${id})`.slice(0, 100), value: id }));
    }

    await interaction.respond(
      choices.filter(c => c.name.toLowerCase().includes(q)).slice(0, 25),
    ).catch(() => {});
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const sessionId = newSession(interaction);
      const data      = global.giveawaySessions.get(sessionId);
      return interaction.reply({
        embeds: [buildSetupEmbed(data, interaction.guild)],
        components: buildSetupRows(sessionId, data),
        ephemeral: true,
      });
    }

    if (sub === 'end') {
      const msgId = interaction.options.getString('giveaway');
      return earlyEndGiveaway(interaction, msgId);
    }

    if (sub === 'reroll') {
      const shortId = interaction.options.getString('giveaway');
      const result = await performReroll(interaction.guild, shortId);
      if (result.error) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(GOLD)
          .setTitle('🎲 Giveaway Rerolled')
          .setDescription(`New winner${result.newWinners.length > 1 ? 's' : ''} for **${result.data.prize}**: ${result.newWinners.map(id => `<@${id}>`).join(', ')}`)
          .setFooter({ text: `ID: ${shortId}` })],
      });
    }

    if (sub === 'list') {
      const active = readJson(ACTIVE_FILE, {});
      const guildGiveaways = Object.entries(active).filter(([, d]) => d.guildId === interaction.guild.id);
      if (guildGiveaways.length === 0) {
        return interaction.reply({ content: '📭 No active giveaways right now. Start one with `/giveaway create`.', ephemeral: true });
      }
      const desc = guildGiveaways.map(([msgId, d]) =>
        `🎟️ **${d.prize}** — <#${d.channelId}> · ${d.entrants?.length || 0} entries · ends <t:${Math.floor(d.endTime / 1000)}:R>`,
      ).join('\n');
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(GOLD).setTitle('🎟️ Active Giveaways').setDescription(desc).setTimestamp()],
        ephemeral: true,
      });
    }
  },

  // ── Button handler ──────────────────────────────────────────────────────────
  async handleSetupButton(interaction) {
    ensureSessions();
    const [, action, sessionId] = interaction.customId.split(':');
    const data = global.giveawaySessions.get(sessionId);

    if (!data)
      return interaction.reply({ content: '⌛ This setup session has expired. Run `/giveaway create` again.', ephemeral: true });
    if (data.userId !== interaction.user.id)
      return interaction.reply({ content: '❌ This setup panel belongs to someone else.', ephemeral: true });

    if (action === 'cancel') {
      global.giveawaySessions.delete(sessionId);
      return interaction.update({ content: '✖️  Giveaway setup cancelled.', embeds: [], components: [] });
    }

    if (action === 'launch') return launchGiveaway(interaction, data, sessionId);

    // Open a modal for the chosen field
    const defs = {
      prize:        { title: '🏆  Set Prize',          label: 'Prize',                              ph: 'e.g. Nitro Classic, $10 Gift Card', max: 100, req: true  },
      duration:     { title: '⏱️  Set Duration',       label: 'Duration',                           ph: '1h  |  30m  |  2d',                 max: 10,  req: true  },
      winners:      { title: '👥  Set Winners',         label: `Number of winners (1–${MAX_WINNERS})`, ph: '1',                                max: 2,   req: true  },
      image:        { title: '🖼️  Set Image URL',      label: 'Image URL',                          ph: 'https://example.com/image.png',     max: 500, req: false },
      mention:      { title: '📣  Set Mention',         label: '@everyone, @here, or a role ID',     ph: '@everyone',                         max: 100, req: false },
      channel:      { title: '📢  Set Channel',         label: 'Channel ID or <#id>',                ph: 'Paste the channel ID',              max: 50,  req: true  },
      requiredrole: { title: '🔐  Required Role',       label: 'Role mention/ID, or "clear"',        ph: '@Members or 123456789012345678',    max: 100, req: false },
      bonusrole:    { title: '⭐  Bonus Role (2× entries)', label: 'Role mention/ID, or "clear"',     ph: '@Booster or 123456789012345678',    max: 100, req: false },
      minage:       { title: '🕰️  Min. Account Age',   label: 'Minimum account age in days (0 = off)', ph: '7',                                max: 5,   req: false },
    };

    const def = defs[action];
    if (!def) return;

    const current = {
      prize: data.prize, duration: data.duration,
      winners: String(data.winners),
      image: data.imageUrl, mention: data.mention,
      channel: data.channelId,
      requiredrole: data.requiredRoleId ? `<@&${data.requiredRoleId}>` : '',
      bonusrole: data.bonusRoleId ? `<@&${data.bonusRoleId}>` : '',
      minage: data.minAccountAgeDays > 0 ? String(data.minAccountAgeDays) : '',
    }[action] || '';

    const modal = new ModalBuilder()
      .setCustomId(`gaw_modal:${action}:${sessionId}`)
      .setTitle(def.title)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel(def.label)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(def.ph)
            .setMaxLength(def.max)
            .setRequired(def.req)
            .setValue(current),
        ),
      );

    return interaction.showModal(modal);
  },

  // ── Modal handler ───────────────────────────────────────────────────────────
  async handleSetupModal(interaction) {
    ensureSessions();
    const [, action, sessionId] = interaction.customId.split(':');
    const data = global.giveawaySessions.get(sessionId);

    if (!data)
      return interaction.reply({ content: '⌛ Session expired. Run `/giveaway create` again.', ephemeral: true });

    const value = interaction.fields.getTextInputValue('value').trim();

    switch (action) {
      case 'prize':
        data.prize = value || null;
        break;

      case 'duration': {
        const ms = parseDuration(value);
        if (!ms) return interaction.reply({ content: '❌ Invalid duration. Use formats like `1h`, `30m`, `2d`.', ephemeral: true });
        data.duration = value;
        data.durationMs = ms;
        break;
      }

      case 'winners': {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1 || n > MAX_WINNERS)
          return interaction.reply({ content: `❌ Winners must be a number between **1** and **${MAX_WINNERS}**.`, ephemeral: true });
        data.winners = n;
        break;
      }

      case 'image':
        data.imageUrl = value || null;
        break;

      case 'mention':
        data.mention = value || null;
        break;

      case 'channel': {
        const chMatch = value.match(/^<#(\d+)>$/) || value.match(/^(\d+)$/);
        if (!chMatch)
          return interaction.reply({ content: '❌ Couldn\'t resolve that channel. Use a channel ID or `<#id>`.', ephemeral: true });
        const ch = interaction.guild.channels.cache.get(chMatch[1]);
        if (!ch)
          return interaction.reply({ content: '❌ Channel not found in this server.', ephemeral: true });
        data.channelId = ch.id;
        break;
      }

      case 'requiredrole': {
        const parsed = parseRoleInput(value, interaction.guild);
        if (parsed.error) return interaction.reply({ content: `❌ ${parsed.error}`, ephemeral: true });
        data.requiredRoleId = parsed.roleId || null;
        break;
      }

      case 'bonusrole': {
        const parsed = parseRoleInput(value, interaction.guild);
        if (parsed.error) return interaction.reply({ content: `❌ ${parsed.error}`, ephemeral: true });
        data.bonusRoleId = parsed.roleId || null;
        break;
      }

      case 'minage': {
        if (!value) { data.minAccountAgeDays = 0; break; }
        const days = parseInt(value, 10);
        if (isNaN(days) || days < 0 || days > 3650)
          return interaction.reply({ content: '❌ Enter a whole number of days (0–3650), or leave blank for none.', ephemeral: true });
        data.minAccountAgeDays = days;
        break;
      }
    }

    await interaction.update({
      embeds: [buildSetupEmbed(data, interaction.guild)],
      components: buildSetupRows(sessionId, data),
    });
  },
};

module.exports.getActiveGiveaway    = getActiveGiveaway;
module.exports.persistGiveawayEntry = persistGiveawayEntry;
module.exports.restoreGiveaways     = restoreGiveaways;

// Legacy text-command reroll (`g.reroll <id>`), kept working for anyone used
// to it — shares the exact same draw logic as `/giveaway reroll`.
module.exports.reroll = async function(message, shortId) {
  if (!shortId)
    return message.reply({ embeds: [{ color: 0xe74c3c, title: '❌ Usage', description: 'Use `g.reroll <id>` or `/giveaway reroll` — the ID is shown in the ended giveaway embed.' }] });

  const member   = message.member;
  const hasPerms = member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator);
  if (!hasPerms)
    return message.reply({ embeds: [{ color: 0xe74c3c, title: '❌ No Permission', description: 'You need **Manage Messages** to reroll giveaways.' }] });

  const result = await performReroll(message.guild, shortId);
  if (result.error) return message.reply({ embeds: [{ color: 0xe74c3c, title: '❌ Reroll Failed', description: result.error }] });

  await message.reply({
    embeds: [new EmbedBuilder()
      .setColor(GOLD)
      .setTitle('🎲 Giveaway Rerolled')
      .setDescription(`New winner${result.newWinners.length > 1 ? 's' : ''} for **${result.data.prize}**: ${result.newWinners.map(id => `<@${id}>`).join(', ')}`)
      .setFooter({ text: `ID: ${shortId}` })],
  });
};
