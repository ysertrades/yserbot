'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  RoleSelectMenuBuilder, ChannelSelectMenuBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  MessageFlags,
} = require('discord.js');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { randomInt } = require('node:crypto');
const { parseDuration } = require('../../utils/duration');
const { applyEmbedImage, replaceFiles } = require('../../utils/embedAttachments');

const GOLD         = 0xFFD700;
const SETUP_EXPIRY = 10 * 60 * 1000; // 10 min
const MAX_WINNERS  = 10;
const ENDED_LIST_MAX = 10;

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
      () => endGiveaway(msg, {
        prize: data.prize, winnersCount: data.winnersCount, imageUrl: data.imageUrl,
        hostId: data.hostId, guildId: data.guildId, bonusRoleId: data.bonusRoleId,
        createdAt: data.createdAt,
      }),
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

function dateStr(ts) { return new Date(ts).toISOString().slice(0, 10); }

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

// A role/channel picker screen shown in place of the main setup panel — built
// from Discord's own native select menus, so it lists every role/channel in
// the server (searchable, scrollable) instead of asking the host to type one.
function buildRolePickerView(sessionId, field, currentRoleId) {
  const label = field === 'requiredrole' ? '🔐  Pick the Required Role' : '⭐  Pick the Bonus Role (2× entries)';
  const desc = field === 'requiredrole'
    ? 'Only members with this role will be able to enter the giveaway.'
    : 'Members with this role get **double** entries in the draw.';
  const embed = new EmbedBuilder().setColor(GOLD).setTitle(label).setDescription(desc);
  const rows = [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`gaw_role_select:${field}:${sessionId}`)
        .setPlaceholder('Select a role…')
        .setMinValues(1).setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gaw_setup:${field}clear:${sessionId}`).setLabel('Clear').setEmoji('🧹').setStyle(ButtonStyle.Danger).setDisabled(!currentRoleId),
      new ButtonBuilder().setCustomId(`gaw_setup:panel:${sessionId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components: rows };
}

function buildChannelPickerView(sessionId) {
  const embed = new EmbedBuilder().setColor(GOLD).setTitle('📢  Pick the Announcement Channel').setDescription('Choose which channel the giveaway will be posted in.');
  const rows = [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`gaw_channel_select:${sessionId}`)
        .setPlaceholder('Select a channel…')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1).setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gaw_setup:panel:${sessionId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components: rows };
}

// ── Launch ────────────────────────────────────────────────────────────────────

/**
 * Posts a prize giveaway and registers it.
 *
 * Split out of launchGiveaway for the same reason as the coins version: the
 * web panel drives this exact path rather than rebuilding the embed, the entry
 * button and the end timer, so the two entry points cannot produce different
 * giveaways.
 */
async function postGiveaway(guild, hostId, hostAvatarUrl, data) {
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

  const channel = guild.channels.cache.get(channelId);
  if (!channel) throw new Error('channel-missing');

  const createdAt     = Date.now();
  const endTime        = createdAt + durationMs;
  const endTimestamp   = Math.floor(endTime / 1000);
  const reqLines      = requirementsLines(data);

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`🎟️  ${prize}`)
    .setDescription(
      `✨ Click **Enter** below to participate!\n\n` +
      `🏆 **Winners:** ${winners}\n` +
      `👤 **Hosted by:** <@${hostId}>\n` +
      `⏰ **Ends:** <t:${endTimestamp}:R>\n` +
      `📊 **Entries:** 0 participants` +
      (reqLines.length ? `\n\n${reqLines.join('\n')}` : ''),
    )
    .setFooter({ text: `Ends at | ${dateStr(endTime)}` })
    .setTimestamp(endTime);

  // A generated banner is not a URL — it has to be drawn, attached, and then
  // referenced as attachment://. Anything else is treated as an ordinary link.
  // The same helper the end and reroll paths use, so a banner that posts is a
  // banner that can be put back on the result.
  const files = applyEmbedImage(embed, imageUrl, guildId);
  const thumb = guild.iconURL({ dynamic: true }) || hostAvatarUrl;
  if (thumb) embed.setThumbnail(thumb);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_enter').setLabel('Enter').setStyle(ButtonStyle.Secondary).setEmoji('🎟️'),
    new ButtonBuilder().setCustomId('giveaway_participants').setLabel('Participants').setStyle(ButtonStyle.Secondary).setEmoji('🏅'),
  );

  const msg = await channel.send({ content, embeds: [embed], components: [row], files, allowedMentions: mentionOpts });

  if (!global.giveawayEntrants) global.giveawayEntrants = new Map();
  if (!global.giveawayMeta)     global.giveawayMeta     = new Map();

  global.giveawayEntrants.set(msg.id, new Set());
  global.giveawayMeta.set(msg.id, {
    prize, winners, imageUrl, hostId, endTime, guildId,
    requiredRoleId, bonusRoleId, minAccountAgeDays,
  });

  // Persist so entries and the timer survive a bot restart
  saveActiveGiveaway(msg.id, {
    prize, winnersCount: winners, imageUrl: imageUrl || null,
    hostId, endTime, guildId, channelId: msg.channelId, entrants: [],
    requiredRoleId: requiredRoleId || null, bonusRoleId: bonusRoleId || null,
    minAccountAgeDays: minAccountAgeDays || 0, createdAt,
  });

  if (giveawayTimers.has(msg.id)) clearTimeout(giveawayTimers.get(msg.id));
  giveawayTimers.set(msg.id, setTimeout(
    () => endGiveaway(msg, { prize, winnersCount: winners, imageUrl, hostId, guildId, bonusRoleId, createdAt }),
    durationMs,
  ));

  return { message: msg, channel, endTime };
}

/** The slash-command path: post it, then close the setup panel. */
async function launchGiveaway(interaction, data, sessionId) {
  let out;
  try {
    out = await postGiveaway(interaction.guild, interaction.user.id, interaction.user.displayAvatarURL(), data);
  } catch (err) {
    if (err.message === 'channel-missing') {
      return interaction.reply({ content: '❌ Target channel not found.', flags: MessageFlags.Ephemeral });
    }
    throw err;
  }
  global.giveawaySessions?.delete(sessionId);
  await interaction.update({
    content: `🎉  Giveaway launched in ${out.channel}!`,
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

async function dmWinners(client, guild, winnerIds, prize, hostId, { rerolled = false } = {}) {
  for (const id of winnerIds) {
    try {
      const user = await client.users.fetch(id);
      await user.send({ embeds: [new EmbedBuilder()
        .setColor(GOLD)
        .setTitle(rerolled ? '🎉 You Won a Rerolled Giveaway!' : '🎉 You Won a Giveaway!')
        .setDescription(`You won **${prize}** in **${guild.name}**!\nContact the host, <@${hostId}>, to claim your prize.`)
        .setTimestamp()] });
    } catch { /* DMs closed — not fatal */ }
  }
}

// ── End giveaway ──────────────────────────────────────────────────────────────

async function endGiveaway(message, meta) {
  const { prize, winnersCount, imageUrl, hostId, guildId, bonusRoleId, createdAt } = meta;
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
    const endFiles = applyEmbedImage(embed, imageUrl, guildId);
    try {
      await message.edit({ embeds: [embed], components: [disabledRow], ...replaceFiles(endFiles) });
    } catch (err) {
      console.error('[GIVEAWAY END] Could not update the giveaway message:', err.message ?? err);
    }
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
    createdAt: createdAt || null,
    endedAt: Date.now(),
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
  const endFiles = applyEmbedImage(embed, imageUrl, guildId);

  // The edit is the only part of ending that can fail — a deleted message, a
  // lost permission, an image Discord will not take. The draw has already
  // happened and is already written down, so a failure here must not stop the
  // giveaway from being marked finished: leaving it active meant it showed as
  // running forever and every fresh attempt to end it drew a new set of
  // winners and wrote another finished record.
  try {
    await message.edit({ embeds: [embed], components: [disabledRow], ...replaceFiles(endFiles) });
  } catch (err) {
    console.error('[GIVEAWAY END] Could not update the giveaway message:', err.message ?? err);
  }
  removeActiveGiveaway(message.id);
  global.giveawayEntrants.delete(message.id);
  global.giveawayMeta?.delete(message.id);

  // DM the winners — a small polish touch most giveaway bots skip.
  await dmWinners(message.client, message.guild, winnerIds, prize, hostId);
}

async function earlyEndGiveaway(interaction, msgId) {
  const record = getActiveGiveaway(msgId);
  if (!record || record.guildId !== interaction.guild.id) {
    return interaction.reply({ content: '❌ No active giveaway found with that selection.', flags: MessageFlags.Ephemeral });
  }
  let msg;
  try {
    const ch = await interaction.guild.channels.fetch(record.channelId);
    msg = await ch.messages.fetch(msgId);
  } catch {
    return interaction.reply({ content: '❌ Couldn\'t find the original giveaway message (it may have been deleted).', flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({ content: `✅ Ending **${record.prize}** now…`, flags: MessageFlags.Ephemeral });
  await endGiveaway(msg, {
    prize: record.prize, winnersCount: record.winnersCount, imageUrl: record.imageUrl,
    hostId: record.hostId, guildId: record.guildId, bonusRoleId: record.bonusRoleId,
    createdAt: record.createdAt,
  });
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
    // guildId, not data.guildId — the ended record never stored one, so the
    // banner was being drawn with the factory wording rather than whatever
    // this server typed into Studio.
    const rerollFiles = applyEmbedImage(updEmbed, data.imageUrl, guildId);
    await origMsg.edit({ embeds: [updEmbed], ...replaceFiles(rerollFiles) }).catch(() => {});
  } catch { /* original message may be gone — the reroll itself still succeeded */ }

  // DM the NEW winner(s) — every reroll notifies whoever actually won this time.
  await dmWinners(guild.client, guild, newWinners, data.prize, data.hostId, { rerolled: true });

  return { data, newWinners };
}

// ── List view (active + recently ended, with delete-in-place for ended) ───────

function buildListPayload(guildId, guild) {
  const active = readJson(ACTIVE_FILE, {});
  const activeList = Object.entries(active).filter(([, d]) => d.guildId === guildId);

  const endedAll = readJson('giveaways_ended.json', {})[guildId] || {};
  const endedList = Object.entries(endedAll)
    .sort(([, a], [, b]) => (b.endedAt || 0) - (a.endedAt || 0))
    .slice(0, ENDED_LIST_MAX);

  const lines = ['**🟢 Active**'];
  if (activeList.length === 0) lines.push('_None right now._');
  else lines.push(...activeList.map(([, d]) =>
    `🎟️ **${d.prize}** — <#${d.channelId}> · ${d.entrants?.length || 0} entries · ends <t:${Math.floor(d.endTime / 1000)}:R>` +
    (d.createdAt ? ` · created <t:${Math.floor(d.createdAt / 1000)}:f>` : ''),
  ));

  lines.push('', `**🏁 Recently Ended** ${endedList.length ? `(latest ${endedList.length})` : ''}`);
  if (endedList.length === 0) lines.push('_None yet._');
  else lines.push(...endedList.map(([id, d]) =>
    `🎟️ **${d.prize}** \`(${id})\` — ${d.winnersCount} winner${d.winnersCount !== 1 ? 's' : ''}` +
    (d.createdAt ? ` · created <t:${Math.floor(d.createdAt / 1000)}:f>` : '') +
    (d.endedAt ? ` · ended <t:${Math.floor(d.endedAt / 1000)}:f>` : ''),
  ));

  const embed = new EmbedBuilder().setColor(GOLD).setTitle('🎟️ Giveaways').setDescription(lines.join('\n')).setTimestamp();

  const components = [];
  if (endedList.length > 0) {
    const options = endedList.map(([id, d]) =>
      new StringSelectMenuOptionBuilder().setLabel(`${d.prize}`.slice(0, 100)).setDescription(`ID: ${id}`).setValue(id));
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('gaw_list_delsel').setPlaceholder('🗑️ Delete an ended giveaway…').addOptions(options),
    ));
  }
  return { embeds: [embed], components };
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
    .addSubcommand(s => s.setName('list').setDescription('List active & recently ended giveaways in this server')),

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
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'end') {
      const msgId = interaction.options.getString('giveaway');
      return earlyEndGiveaway(interaction, msgId);
    }

    if (sub === 'reroll') {
      const shortId = interaction.options.getString('giveaway');
      const result = await performReroll(interaction.guild, shortId);
      if (result.error) return interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(GOLD)
          .setTitle('🎲 Giveaway Rerolled')
          .setDescription(`New winner${result.newWinners.length > 1 ? 's' : ''} for **${result.data.prize}**: ${result.newWinners.map(id => `<@${id}>`).join(', ')}`)
          .setFooter({ text: `ID: ${shortId}` })],
      });
    }

    if (sub === 'list') {
      const payload = buildListPayload(interaction.guild.id, interaction.guild);
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
  },

  // ── Button handler ──────────────────────────────────────────────────────────
  async handleSetupButton(interaction) {
    ensureSessions();
    const [, action, sessionId] = interaction.customId.split(':');
    const data = global.giveawaySessions.get(sessionId);

    if (!data)
      return interaction.reply({ content: '⌛ This setup session has expired. Run `/giveaway create` again.', flags: MessageFlags.Ephemeral });
    if (data.userId !== interaction.user.id)
      return interaction.reply({ content: '❌ This setup panel belongs to someone else.', flags: MessageFlags.Ephemeral });

    if (action === 'cancel') {
      global.giveawaySessions.delete(sessionId);
      return interaction.update({ content: '✖️  Giveaway setup cancelled.', embeds: [], components: [] });
    }

    if (action === 'launch') return launchGiveaway(interaction, data, sessionId);

    // "Back" from a role/channel picker screen — just redraw the normal panel.
    if (action === 'panel') {
      return interaction.update({ embeds: [buildSetupEmbed(data, interaction.guild)], components: buildSetupRows(sessionId, data) });
    }

    if (action === 'requiredroleclear' || action === 'bonusroleclear') {
      if (action === 'requiredroleclear') data.requiredRoleId = null;
      else data.bonusRoleId = null;
      return interaction.update({ embeds: [buildSetupEmbed(data, interaction.guild)], components: buildSetupRows(sessionId, data) });
    }

    // Required Role / Bonus Role / Channel now use Discord's own native
    // select menus (every role/channel in the server, searchable) instead
    // of asking the host to type an ID.
    if (action === 'requiredrole' || action === 'bonusrole') {
      return interaction.update(buildRolePickerView(sessionId, action, action === 'requiredrole' ? data.requiredRoleId : data.bonusRoleId));
    }
    if (action === 'channel') {
      return interaction.update(buildChannelPickerView(sessionId));
    }

    // Everything else still opens a modal
    const defs = {
      prize:    { title: '🏆  Set Prize',    label: 'Prize',                            ph: 'e.g. Nitro Classic, $10 Gift Card', max: 100, req: true },
      duration: { title: '⏱️  Set Duration', label: 'Duration',                         ph: '1h  |  30m  |  2d',                 max: 10,  req: true },
      winners:  { title: '👥  Set Winners',   label: `Number of winners (1–${MAX_WINNERS})`, ph: '1',                            max: 2,   req: true },
      image:    { title: '🖼️  Set Image URL', label: 'Image URL',                       ph: 'https://example.com/image.png',     max: 500, req: false },
      mention:  { title: '📣  Set Mention',   label: '@everyone, @here, or a role ID',   ph: '@everyone',                         max: 100, req: false },
      minage:   { title: '🕰️  Min. Account Age', label: 'Minimum account age in days (0 = off)', ph: '7',                        max: 5,   req: false },
    };

    const def = defs[action];
    if (!def) return;

    const current = {
      prize: data.prize, duration: data.duration,
      winners: String(data.winners),
      image: data.imageUrl, mention: data.mention,
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
      return interaction.reply({ content: '⌛ Session expired. Run `/giveaway create` again.', flags: MessageFlags.Ephemeral });

    const value = interaction.fields.getTextInputValue('value').trim();

    switch (action) {
      case 'prize':
        data.prize = value || null;
        break;

      case 'duration': {
        const ms = parseDuration(value);
        if (!ms) return interaction.reply({ content: '❌ Invalid duration. Use formats like `1h`, `30m`, `2d`.', flags: MessageFlags.Ephemeral });
        data.duration = value;
        data.durationMs = ms;
        break;
      }

      case 'winners': {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1 || n > MAX_WINNERS)
          return interaction.reply({ content: `❌ Winners must be a number between **1** and **${MAX_WINNERS}**.`, flags: MessageFlags.Ephemeral });
        data.winners = n;
        break;
      }

      case 'image':
        data.imageUrl = value || null;
        break;

      case 'mention':
        data.mention = value || null;
        break;

      case 'minage': {
        if (!value) { data.minAccountAgeDays = 0; break; }
        const days = parseInt(value, 10);
        if (isNaN(days) || days < 0 || days > 3650)
          return interaction.reply({ content: '❌ Enter a whole number of days (0–3650), or leave blank for none.', flags: MessageFlags.Ephemeral });
        data.minAccountAgeDays = days;
        break;
      }
    }

    await interaction.update({
      embeds: [buildSetupEmbed(data, interaction.guild)],
      components: buildSetupRows(sessionId, data),
    });
  },

  // ── Native role/channel select handlers ───────────────────────────────────
  async handleRoleSelect(interaction) {
    ensureSessions();
    const [, field, sessionId] = interaction.customId.split(':');
    const data = global.giveawaySessions.get(sessionId);
    if (!data) return interaction.update({ content: '⌛ Session expired. Run `/giveaway create` again.', embeds: [], components: [] });
    if (data.userId !== interaction.user.id) return interaction.reply({ content: '❌ This setup panel belongs to someone else.', flags: MessageFlags.Ephemeral });

    const roleId = interaction.values[0];
    if (field === 'requiredrole') data.requiredRoleId = roleId;
    else if (field === 'bonusrole') data.bonusRoleId = roleId;

    return interaction.update({ embeds: [buildSetupEmbed(data, interaction.guild)], components: buildSetupRows(sessionId, data) });
  },

  async handleChannelSelect(interaction) {
    ensureSessions();
    const [, sessionId] = interaction.customId.split(':');
    const data = global.giveawaySessions.get(sessionId);
    if (!data) return interaction.update({ content: '⌛ Session expired. Run `/giveaway create` again.', embeds: [], components: [] });
    if (data.userId !== interaction.user.id) return interaction.reply({ content: '❌ This setup panel belongs to someone else.', flags: MessageFlags.Ephemeral });

    data.channelId = interaction.values[0];
    return interaction.update({ embeds: [buildSetupEmbed(data, interaction.guild)], components: buildSetupRows(sessionId, data) });
  },

  // ── /giveaway list — delete-ended-giveaway select + confirm, in-place ────────
  async handleListSelect(interaction) {
    if (interaction.customId !== 'gaw_list_delsel') return;
    const shortId = interaction.values[0];
    const ended   = readJson('giveaways_ended.json', {})[interaction.guild.id]?.[shortId];
    const label   = ended ? ended.prize : shortId;
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚠️ Confirm Deletion')
      .setDescription(`Delete the record for **${label}** \`(${shortId})\`?\nThis only removes the saved record — it does not un-announce past winners.\n**This cannot be undone.**`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gaw_list_delyes:${shortId}`).setLabel('🗑️ Yes, Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('gaw_list_delno').setLabel('← Back').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [embed], components: [row] });
  },

  async handleListButton(interaction) {
    const id = interaction.customId;
    if (id.startsWith('gaw_list_delyes:')) {
      const shortId = id.slice('gaw_list_delyes:'.length);
      const allEnded = readJson('giveaways_ended.json', {});
      if (allEnded[interaction.guild.id]?.[shortId]) {
        delete allEnded[interaction.guild.id][shortId];
        writeJson('giveaways_ended.json', allEnded);
      }
      return interaction.update(buildListPayload(interaction.guild.id, interaction.guild));
    }
    if (id === 'gaw_list_delno') {
      return interaction.update(buildListPayload(interaction.guild.id, interaction.guild));
    }
  },
};

module.exports.getActiveGiveaway    = getActiveGiveaway;
module.exports.persistGiveawayEntry = persistGiveawayEntry;
module.exports.restoreGiveaways     = restoreGiveaways;

// Legacy text-command reroll (`g.reroll <id>`), kept working for anyone used
// to it — shares the exact same draw logic (including winner DMs) as `/giveaway reroll`.
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

// Exposed for the web control panel — same reason as coinsgiveaway.js: the
// panel drives the real end path, it does not reimplement drawing winners.
module.exports.postGiveaway = postGiveaway;
module.exports.performReroll = performReroll;
module.exports.endGiveaway = endGiveaway;
module.exports.ACTIVE_FILE = ACTIVE_FILE;
