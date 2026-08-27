'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// /coinsgiveaway — a casino-flavored sibling of /giveaway, specifically for
// giving away in-economy coins. Unlike /giveaway (a free-text prize the host
// hands out manually), this auto-credits every winner's balance the instant
// it ends or gets rerolled, and every image is a generated jackpot banner
// (utils/giveawayVisual.js) built from the actual amount/winner data instead
// of an uploaded picture.
// ─────────────────────────────────────────────────────────────────────────────

const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  RoleSelectMenuBuilder, ChannelSelectMenuBuilder,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  MessageFlags,
} = require('discord.js');
const { readJson, writeJson } = require('../../utils/jsonStorage');
const { addCoins } = require('../../utils/economyManager');
const { fetchAvatarPng } = require('../../utils/avatarUtil');
const { generateGiveawayBannerImage, generateGiveawayResultImage } = require('../../utils/giveawayVisual');
const { randomInt } = require('node:crypto');
const { parseDuration } = require('../../utils/duration');
const { replaceFiles } = require('../../utils/embedAttachments');

const GOLD          = 0xFFD700;
const SETUP_EXPIRY  = 10 * 60 * 1000; // 10 min
const MAX_WINNERS   = 10;
const ENDED_LIST_MAX = 10;
const MAX_AMOUNT    = 1_000_000;

const timers      = new Map();
const ID_CHARS    = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ACTIVE_FILE = 'coinsgiveaways_active.json';
const ENDED_FILE  = 'coinsgiveaways_ended.json';

// ── Active-giveaway persistence (survives bot restarts) ───────────────────────

function saveActive(msgId, data) {
  const all = readJson(ACTIVE_FILE, {});
  all[msgId] = data;
  writeJson(ACTIVE_FILE, all);
}

function removeActive(msgId) {
  const all = readJson(ACTIVE_FILE, {});
  if (!all[msgId]) return;
  delete all[msgId];
  writeJson(ACTIVE_FILE, all);
}

function getActive(msgId) {
  return readJson(ACTIVE_FILE, {})[msgId] ?? null;
}

/**
 * Takes ownership so a coins giveaway can only pay out once.
 *
 * More important here than for a prize giveaway: this one credits the winners
 * itself, so two concurrent endings would pay twice out of nothing. Removing
 * the active record is the claim, and it happens before any await.
 */
function claimActive(msgId) {
  const all = readJson(ACTIVE_FILE, {});
  if (!all[msgId]) return false;
  delete all[msgId];
  writeJson(ACTIVE_FILE, all);
  return true;
}

function persistEntry(msgId, entrants) {
  const all = readJson(ACTIVE_FILE, {});
  if (!all[msgId]) return;
  all[msgId].entrants = Array.from(entrants);
  writeJson(ACTIVE_FILE, all);
}

async function restoreCoinsGiveaways(client) {
  const active = readJson(ACTIVE_FILE, {});
  const now    = Date.now();
  if (!global.coinsGiveawayEntrants) global.coinsGiveawayEntrants = new Map();
  if (!global.coinsGiveawayMeta)     global.coinsGiveawayMeta     = new Map();

  for (const [msgId, data] of Object.entries(active)) {
    global.coinsGiveawayEntrants.set(msgId, new Set(data.entrants || []));
    global.coinsGiveawayMeta.set(msgId, {
      amount: data.amount, winners: data.winnersCount,
      hostId: data.hostId, endTime: data.endTime, guildId: data.guildId,
      requiredRoleId: data.requiredRoleId || null,
      bonusRoleId: data.bonusRoleId || null,
      minAccountAgeDays: data.minAccountAgeDays || 0,
    });

    let msg;
    try {
      const ch = await client.channels.fetch(data.channelId);
      msg = await ch.messages.fetch(msgId);
    } catch {
      removeActive(msgId);
      global.coinsGiveawayEntrants.delete(msgId);
      global.coinsGiveawayMeta.delete(msgId);
      continue;
    }

    const remaining = Math.max(data.endTime - now, 0);
    if (timers.has(msgId)) clearTimeout(timers.get(msgId));
    timers.set(msgId, setTimeout(
      () => endCoinsGiveaway(msg, {
        amount: data.amount, winnersCount: data.winnersCount,
        hostId: data.hostId, guildId: data.guildId, bonusRoleId: data.bonusRoleId,
        createdAt: data.createdAt,
      }).catch(err => console.error(`[COINS GIVEAWAY ${msgId}] ending failed:`, err)),
      remaining,
    ));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(guildId) {
  const existing = Object.keys(readJson(ENDED_FILE, {})[guildId] || {});
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
  if (!global.coinsGiveawaySessions) global.coinsGiveawaySessions = new Map();
}

function newSession(interaction) {
  ensureSessions();
  const sessionId = `${interaction.user.id}-${Date.now()}`;
  global.coinsGiveawaySessions.set(sessionId, {
    amount: null, duration: null, durationMs: null,
    winners: 1, mention: null,
    requiredRoleId: null, bonusRoleId: null, minAccountAgeDays: 0,
    channelId: interaction.channelId,
    guildId: interaction.guild.id,
    userId: interaction.user.id,
  });
  setTimeout(() => global.coinsGiveawaySessions?.delete(sessionId), SETUP_EXPIRY);
  return sessionId;
}

// ── Setup panel UI ────────────────────────────────────────────────────────────

function fieldVal(val, display, required) {
  if (val) return `> \`${display || val}\``;
  return required ? '> ⚠️  *Not set — required*' : '> —';
}

function buildSetupEmbed(data, guild) {
  const ready = !!(data.amount && data.durationMs);

  const lines = [
    `**🪙  Coins Per Winner**\n${fieldVal(data.amount, data.amount ? data.amount.toLocaleString() : null, true)}`,
    `**⏱️  Duration**\n${fieldVal(data.duration, data.duration, true)}`,
    `**👥  Winners**\n> \`${data.winners}\``,
    `**📢  Channel**\n> <#${data.channelId}>`,
    `**📣  Mention**\n${fieldVal(data.mention, data.mention, false)}`,
    `**🔐  Required Role**\n${fieldVal(data.requiredRoleId, data.requiredRoleId ? `<@&${data.requiredRoleId}>` : null, false)}`,
    `**⭐  Bonus Role (2× entries)**\n${fieldVal(data.bonusRoleId, data.bonusRoleId ? `<@&${data.bonusRoleId}>` : null, false)}`,
    `**🕰️  Min. Account Age**\n${data.minAccountAgeDays > 0 ? `> \`${data.minAccountAgeDays} days\`` : '> —'}`,
  ];

  return new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: 'QuantLab Casino  •  Coins Giveaway Setup', iconURL: guild.iconURL({ dynamic: true }) || undefined })
    .setTitle('🎰  New Coins Giveaway')
    .setDescription(
      '```\nConfigure each field below, then launch when ready.\nThe banner image is generated automatically from these fields.\n```\n' +
      lines.join('\n\n'),
    )
    .setFooter({
      text: ready
        ? '✅  All required fields set — ready to launch!'
        : '⚠️  Coins Per Winner and Duration are required before launching',
    })
    .setTimestamp();
}

function buildSetupRows(sessionId, data) {
  const ready = !!(data.amount && data.durationMs);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cg_setup:amount:${sessionId}`)
        .setLabel('Coins Per Winner').setEmoji('🪙')
        .setStyle(data.amount ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cg_setup:duration:${sessionId}`)
        .setLabel('Duration').setEmoji('⏱️')
        .setStyle(data.duration ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cg_setup:winners:${sessionId}`)
        .setLabel(`Winners: ${data.winners}`).setEmoji('👥')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cg_setup:channel:${sessionId}`)
        .setLabel('Channel').setEmoji('📢')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cg_setup:mention:${sessionId}`)
        .setLabel('Mention').setEmoji('📣')
        .setStyle(data.mention ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cg_setup:requiredrole:${sessionId}`)
        .setLabel('Required Role').setEmoji('🔐')
        .setStyle(data.requiredRoleId ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cg_setup:bonusrole:${sessionId}`)
        .setLabel('Bonus Role').setEmoji('⭐')
        .setStyle(data.bonusRoleId ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`cg_setup:minage:${sessionId}`)
        .setLabel('Min. Account Age').setEmoji('🕰️')
        .setStyle(data.minAccountAgeDays > 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cg_setup:launch:${sessionId}`)
        .setLabel('Launch').setEmoji('🚀')
        .setStyle(ready ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!ready),
      new ButtonBuilder()
        .setCustomId(`cg_setup:cancel:${sessionId}`)
        .setLabel('Cancel').setEmoji('✖️')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildRolePickerView(sessionId, field, currentRoleId) {
  const label = field === 'requiredrole' ? '🔐  Pick the Required Role' : '⭐  Pick the Bonus Role (2× entries)';
  const desc = field === 'requiredrole'
    ? 'Only members with this role will be able to enter the giveaway.'
    : 'Members with this role get **double** entries in the draw.';
  const embed = new EmbedBuilder().setColor(GOLD).setTitle(label).setDescription(desc);
  const rows = [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`cg_role_select:${field}:${sessionId}`)
        .setPlaceholder('Select a role…')
        .setMinValues(1).setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cg_setup:${field}clear:${sessionId}`).setLabel('Clear').setEmoji('🧹').setStyle(ButtonStyle.Danger).setDisabled(!currentRoleId),
      new ButtonBuilder().setCustomId(`cg_setup:panel:${sessionId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components: rows };
}

function buildChannelPickerView(sessionId) {
  const embed = new EmbedBuilder().setColor(GOLD).setTitle('📢  Pick the Announcement Channel').setDescription('Choose which channel the giveaway will be posted in.');
  const rows = [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`cg_channel_select:${sessionId}`)
        .setPlaceholder('Select a channel…')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1).setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cg_setup:panel:${sessionId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components: rows };
}

// ── Launch ────────────────────────────────────────────────────────────────────

/**
 * The giveaway's banner, drawn fresh.
 *
 * Exported because the entry-count edit re-uploads it rather than pointing the
 * embed at the file already on the message — a signed CDN link copied out of a
 * live embed is not something Discord matches back to its attachment, and the
 * banner ended up drawn twice. One definition, so the picture on the edit is
 * the picture that was posted.
 */
function buildBanner({ amount, winners }) {
  return new AttachmentBuilder(generateGiveawayBannerImage({
    amountLabel: `${Number(amount).toLocaleString()} COINS EACH`,
    subLabel: `${winners} WINNER${winners !== 1 ? 'S' : ''} • HIT ENTER BELOW`,
  }), { name: `coinsgiveaway_${Date.now()}.png` });
}

/**
 * Posts a coins giveaway and registers it.
 *
 * Split out from launchGiveaway so the web control panel can start one through
 * exactly this path rather than rebuilding the embed, the entry button and the
 * end timer itself. Two implementations of "what a giveaway looks like" would
 * drift, and the drift would show up as a giveaway that never ends or never
 * pays out.
 */
async function postGiveaway(guild, hostId, data) {
  const {
    amount, durationMs, winners, mention, channelId, guildId,
    requiredRoleId, bonusRoleId, minAccountAgeDays,
  } = data;

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

  const createdAt   = Date.now();
  const endTime      = createdAt + durationMs;
  const endTimestamp = Math.floor(endTime / 1000);
  const reqLines    = requirementsLines(data);

  const attachment = buildBanner({ amount, winners });

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setImage(`attachment://${attachment.name}`)
    .setDescription(
      `✨ Click **Enter** below for a shot at **${amount.toLocaleString()} coins**!\n\n` +
      `👤 **Hosted by:** <@${hostId}>\n` +
      `⏰ **Ends:** <t:${endTimestamp}:R>\n` +
      `📊 **Entries:** 0 participants` +
      (reqLines.length ? `\n\n${reqLines.join('\n')}` : ''),
    )
    .setFooter({ text: `Ends at | ${dateStr(endTime)}` })
    .setTimestamp(endTime);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('coinsgaw_enter').setLabel('Enter').setStyle(ButtonStyle.Secondary).setEmoji('🎟️'),
    new ButtonBuilder().setCustomId('coinsgaw_participants').setLabel('Participants').setStyle(ButtonStyle.Secondary).setEmoji('🏅'),
  );

  const msg = await channel.send({ content, embeds: [embed], files: [attachment], components: [row], allowedMentions: mentionOpts });

  if (!global.coinsGiveawayEntrants) global.coinsGiveawayEntrants = new Map();
  if (!global.coinsGiveawayMeta)     global.coinsGiveawayMeta     = new Map();

  global.coinsGiveawayEntrants.set(msg.id, new Set());
  global.coinsGiveawayMeta.set(msg.id, {
    amount, winners, hostId, endTime, guildId,
    requiredRoleId, bonusRoleId, minAccountAgeDays,
  });

  saveActive(msg.id, {
    amount, winnersCount: winners,
    hostId, endTime, guildId, channelId: msg.channelId, entrants: [],
    requiredRoleId: requiredRoleId || null, bonusRoleId: bonusRoleId || null,
    minAccountAgeDays: minAccountAgeDays || 0, createdAt,
  });

  if (timers.has(msg.id)) clearTimeout(timers.get(msg.id));
  timers.set(msg.id, setTimeout(
    () => endCoinsGiveaway(msg, { amount, winnersCount: winners, hostId, guildId, bonusRoleId, createdAt })
      .catch(err => console.error(`[COINS GIVEAWAY ${msg.id}] ending failed:`, err)),
    durationMs,
  ));

  return { message: msg, channel, endTime };
}

/** The slash-command path: post it, then close the setup panel. */
async function launchGiveaway(interaction, data, sessionId) {
  let out;
  try {
    out = await postGiveaway(interaction.guild, interaction.user.id, data);
  } catch (err) {
    if (err.message === 'channel-missing') {
      return interaction.reply({ content: '❌ Target channel not found.', flags: MessageFlags.Ephemeral });
    }
    throw err;
  }
  global.coinsGiveawaySessions?.delete(sessionId);
  await interaction.update({
    content: `🎉  Coins giveaway launched in ${out.channel}!`,
    embeds: [], components: [],
  });
}

// ── Pick winners (secure, weighted, deduped) ───────────────────────────────────

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

async function dmWinners(client, guild, winnerIds, amount, { rerolled = false } = {}) {
  for (const id of winnerIds) {
    try {
      const user = await client.users.fetch(id);
      await user.send({ embeds: [new EmbedBuilder()
        .setColor(GOLD)
        .setTitle(rerolled ? '🎉 You Won a Rerolled Coins Giveaway!' : '🎉 You Won a Coins Giveaway!')
        .setDescription(`**${amount.toLocaleString()} coins** have been credited to your balance in **${guild.name}**! 🪙`)
        .setTimestamp()] });
    } catch { /* DMs closed — not fatal */ }
  }
}

// ── End giveaway ──────────────────────────────────────────────────────────────

// `message` may point at a message that no longer exists (deleted manually,
// channel purged, etc). The draw, payout, and persisted-record cleanup must
// all happen regardless — displaying the result in-channel is best-effort
// on top of that, never a precondition for it. Returns a small summary
// object so callers (e.g. earlyEndGiveaway) can report back when the
// in-channel edit couldn't happen.
async function endCoinsGiveaway(message, meta) {
  if (!claimActive(message.id)) return { displayed: false, winnerIds: [], totalPaid: 0, shortId: null, alreadyEnded: true };
  const { amount, winnersCount, hostId, guildId, bonusRoleId, createdAt } = meta;
  if (!global.coinsGiveawayEntrants) global.coinsGiveawayEntrants = new Map();
  const entrants = global.coinsGiveawayEntrants.get(message.id);

  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('coinsgaw_ended').setLabel('Ended').setStyle(ButtonStyle.Secondary).setDisabled(true).setEmoji('🎟️'),
    new ButtonBuilder().setCustomId('coinsgaw_participants').setLabel('Participants').setStyle(ButtonStyle.Secondary).setEmoji('🏅'),
  );

  if (timers.has(message.id)) { clearTimeout(timers.get(message.id)); timers.delete(message.id); }

  if (!entrants || entrants.size === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`🪙  ${amount.toLocaleString()} Coins Giveaway — Ended`)
      .setDescription('No participants entered the giveaway. No coins were paid out.')
      .setFooter({ text: 'Better luck next time!' })
      .setTimestamp();
    const displayed = await message.edit({ embeds: [embed], files: [], components: [disabledRow] }).then(() => true).catch(() => false);
    removeActive(message.id);
    global.coinsGiveawayEntrants.delete(message.id);
    global.coinsGiveawayMeta?.delete(message.id);
    return { displayed, winnerIds: [], totalPaid: 0, shortId: null };
  }

  const entrantIds = Array.from(entrants);
  const pool       = await buildWeightedPool(entrantIds, message.guild, bonusRoleId);
  const winnerIds  = pickWinners(pool, winnersCount);

  // Auto-credit — the defining difference from /giveaway: winners don't wait
  // on the host, coins land the moment the draw happens. This (and the
  // persisted ended-record below) must survive even if the announcement
  // message is gone, so it happens before any message.edit is attempted.
  for (const id of winnerIds) addCoins(id, amount);
  const totalPaid = amount * winnerIds.length;

  const shortId  = genId(guildId);
  const allEnded = readJson(ENDED_FILE, {});
  if (!allEnded[guildId]) allEnded[guildId] = {};
  allEnded[guildId][shortId] = {
    amount, hostId, winnersCount,
    messageId: message.id,
    channelId: message.channelId,
    entrants:  entrantIds,
    bonusRoleId: bonusRoleId || null,
    currentWinners: winnerIds,
    createdAt: createdAt || null,
    endedAt: Date.now(),
  };
  writeJson(ENDED_FILE, allEnded);

  removeActive(message.id);
  global.coinsGiveawayEntrants.delete(message.id);
  global.coinsGiveawayMeta?.delete(message.id);

  let displayed = false;
  try {
    const winnerProfiles = [];
    for (const id of winnerIds) {
      try {
        const user = await message.client.users.fetch(id);
        winnerProfiles.push({
          avatarPng: await fetchAvatarPng(user.displayAvatarURL({ extension: 'png', size: 128 })),
          username: user.username,
        });
      } catch {
        winnerProfiles.push({ avatarPng: null, username: 'Unknown' });
      }
    }

    const imageName  = `coinsgiveaway_result_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateGiveawayResultImage({
      winners: winnerProfiles, amountEach: amount, totalPaid,
    }), { name: imageName });

    const embed = new EmbedBuilder()
      .setColor(GOLD)
      .setImage(`attachment://${imageName}`)
      .setDescription(
        `👤 **Hosted by:** <@${hostId}>\n` +
        `📊 **Total entries:** ${entrants.size}\n\n` +
        `🔁 To reroll, use \`/coinsgiveaway reroll\``,
      )
      .setFooter({ text: `Congratulations! 🎉 • ID: ${shortId}` })
      .setTimestamp();

    await message.edit({ embeds: [embed], components: [disabledRow], ...replaceFiles([attachment]) });
    displayed = true;
  } catch (err) {
    console.error('[COINS GIVEAWAY END] Could not display result (message likely deleted):', err.message ?? err);
  }

  await dmWinners(message.client, message.guild, winnerIds, amount);
  return { displayed, winnerIds, totalPaid, shortId };
}

async function earlyEndGiveaway(interaction, msgId) {
  const record = getActive(msgId);
  if (!record || record.guildId !== interaction.guild.id) {
    return interaction.reply({ content: '❌ No active giveaway found with that selection.', flags: MessageFlags.Ephemeral });
  }

  let msg, messageGone = false;
  try {
    const ch = await interaction.guild.channels.fetch(record.channelId);
    msg = await ch.messages.fetch(msgId);
  } catch {
    // The announcement message is gone (deleted, channel purged, etc). The
    // draw and payout still need to happen — coins shouldn't get stuck
    // because a message disappeared — so continue with a stub the rest of
    // endCoinsGiveaway can use for guild/client access; its own message.edit
    // attempt will fail harmlessly and get reported below instead.
    messageGone = true;
    msg = {
      id: msgId,
      channelId: record.channelId,
      guild: interaction.guild,
      client: interaction.client,
      edit: async () => { throw new Error('Giveaway message no longer exists'); },
    };
  }

  // Normally already populated from launch/entries — this only kicks in if
  // the bot never loaded this giveaway into memory (e.g. entries only ever
  // reached the persisted file), so the draw still has a pool to pick from.
  if (!global.coinsGiveawayEntrants) global.coinsGiveawayEntrants = new Map();
  if (!global.coinsGiveawayEntrants.has(msgId)) {
    global.coinsGiveawayEntrants.set(msgId, new Set(record.entrants || []));
  }

  await interaction.reply({ content: `✅ Ending **${record.amount.toLocaleString()} coins** giveaway now…`, flags: MessageFlags.Ephemeral });
  const result = await endCoinsGiveaway(msg, {
    amount: record.amount, winnersCount: record.winnersCount,
    hostId: record.hostId, guildId: record.guildId, bonusRoleId: record.bonusRoleId,
    createdAt: record.createdAt,
  });

  if (messageGone) {
    const summary = result.winnerIds.length
      ? `🪙 The original message was gone, so here's the result: **${result.winnerIds.length}** winner${result.winnerIds.length !== 1 ? 's' : ''} — ${result.winnerIds.map(id => `<@${id}>`).join(', ')} — each credited **${record.amount.toLocaleString()} coins** (ID: \`${result.shortId}\`).`
      : `The original message was gone. No one had entered, so nothing was paid out.`;
    await interaction.followUp({ content: summary, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

// ── Reroll ────────────────────────────────────────────────────────────────────

async function performReroll(guild, shortId) {
  const allEnded = readJson(ENDED_FILE, {});
  const guildId  = guild.id;
  const data     = allEnded[guildId]?.[shortId.toLowerCase()];
  if (!data) return { error: `No ended giveaway found with ID \`${shortId}\`.` };
  if (!data.entrants || data.entrants.length === 0) return { error: 'This giveaway had no participants, cannot reroll.' };

  const pool       = await buildWeightedPool(data.entrants, guild, data.bonusRoleId);
  const newWinners = pickWinners(pool, data.winnersCount);

  // Reroll pays out fresh — the previous winners already keep what they got.
  for (const id of newWinners) addCoins(id, data.amount);

  data.currentWinners = newWinners;
  allEnded[guildId][shortId.toLowerCase()] = data;
  writeJson(ENDED_FILE, allEnded);

  try {
    const channel = await guild.client.channels.fetch(data.channelId);
    const origMsg = await channel.messages.fetch(data.messageId);

    const winnerProfiles = [];
    for (const id of newWinners) {
      try {
        const user = await guild.client.users.fetch(id);
        winnerProfiles.push({
          avatarPng: await fetchAvatarPng(user.displayAvatarURL({ extension: 'png', size: 128 })),
          username: user.username,
        });
      } catch {
        winnerProfiles.push({ avatarPng: null, username: 'Unknown' });
      }
    }

    const imageName  = `coinsgiveaway_reroll_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateGiveawayResultImage({
      winners: winnerProfiles, amountEach: data.amount, totalPaid: data.amount * newWinners.length,
    }), { name: imageName });

    const updEmbed = new EmbedBuilder()
      .setColor(GOLD)
      .setImage(`attachment://${imageName}`)
      .setDescription(
        `👤 **Hosted by:** <@${data.hostId}>\n` +
        `📊 **Total entries:** ${data.entrants.length}\n\n` +
        `🔁 To reroll, use \`/coinsgiveaway reroll\``,
      )
      .setFooter({ text: `Rerolled 🎲 • ID: ${shortId}` })
      .setTimestamp();
    await origMsg.edit({ embeds: [updEmbed], ...replaceFiles([attachment]) }).catch(() => {});
  } catch { /* original message may be gone — the reroll itself still succeeded */ }

  await dmWinners(guild.client, guild, newWinners, data.amount, { rerolled: true });

  return { data, newWinners };
}

// ── List view ─────────────────────────────────────────────────────────────────

function buildListPayload(guildId, guild) {
  const active = readJson(ACTIVE_FILE, {});
  const activeList = Object.entries(active).filter(([, d]) => d.guildId === guildId);

  const endedAll = readJson(ENDED_FILE, {})[guildId] || {};
  const endedList = Object.entries(endedAll)
    .sort(([, a], [, b]) => (b.endedAt || 0) - (a.endedAt || 0))
    .slice(0, ENDED_LIST_MAX);

  const lines = ['**🟢 Active**'];
  if (activeList.length === 0) lines.push('_None right now._');
  else lines.push(...activeList.map(([, d]) =>
    `🪙 **${d.amount.toLocaleString()} coins each** — <#${d.channelId}> · ${d.entrants?.length || 0} entries · ends <t:${Math.floor(d.endTime / 1000)}:R>` +
    (d.createdAt ? ` · created <t:${Math.floor(d.createdAt / 1000)}:f>` : ''),
  ));

  lines.push('', `**🏁 Recently Ended** ${endedList.length ? `(latest ${endedList.length})` : ''}`);
  if (endedList.length === 0) lines.push('_None yet._');
  else lines.push(...endedList.map(([id, d]) =>
    `🪙 **${d.amount.toLocaleString()} coins each** \`(${id})\` — ${d.winnersCount} winner${d.winnersCount !== 1 ? 's' : ''}` +
    (d.createdAt ? ` · created <t:${Math.floor(d.createdAt / 1000)}:f>` : '') +
    (d.endedAt ? ` · ended <t:${Math.floor(d.endedAt / 1000)}:f>` : ''),
  ));

  const embed = new EmbedBuilder().setColor(GOLD).setTitle('🎰 Coins Giveaways').setDescription(lines.join('\n')).setTimestamp();

  const components = [];
  if (endedList.length > 0) {
    const options = endedList.map(([id, d]) =>
      new StringSelectMenuOptionBuilder().setLabel(`${d.amount.toLocaleString()} coins each`.slice(0, 100)).setDescription(`ID: ${id}`).setValue(id));
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('cg_list_delsel').setPlaceholder('🗑️ Delete an ended giveaway…').addOptions(options),
    ));
  }
  return { embeds: [embed], components };
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinsgiveaway').setDescription('Create, end, reroll & list casino coins giveaways (auto-credited to winners)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('create').setDescription('Open the coins giveaway setup panel'))
    .addSubcommand(s => s.setName('end').setDescription('End an active giveaway early and draw winners now')
      .addStringOption(o => o.setName('giveaway').setDescription('Which giveaway to end').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('reroll').setDescription('Pick new winner(s) for an ended giveaway (pays them again)')
      .addStringOption(o => o.setName('giveaway').setDescription('Which ended giveaway to reroll').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('list').setDescription('List active & recently ended coins giveaways in this server')),

  async autocomplete(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const q       = String(interaction.options.getFocused() || '').toLowerCase();
    let choices = [];

    if (sub === 'end') {
      const active = readJson(ACTIVE_FILE, {});
      choices = Object.entries(active)
        .filter(([, d]) => d.guildId === guildId)
        .map(([msgId, d]) => ({ name: `${d.amount.toLocaleString()} coins each — ends <t:${Math.floor(d.endTime / 1000)}:R>`.slice(0, 100), value: msgId }));
    } else if (sub === 'reroll') {
      const ended = readJson(ENDED_FILE, {})[guildId] || {};
      choices = Object.entries(ended)
        .map(([id, d]) => ({ name: `${d.amount.toLocaleString()} coins each (${id})`.slice(0, 100), value: id }));
    }

    await interaction.respond(
      choices.filter(c => c.name.toLowerCase().includes(q)).slice(0, 25),
    ).catch(() => {});
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const sessionId = newSession(interaction);
      const data      = global.coinsGiveawaySessions.get(sessionId);
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
          .setTitle('🎲 Coins Giveaway Rerolled')
          .setDescription(`New winner${result.newWinners.length > 1 ? 's' : ''} for **${result.data.amount.toLocaleString()} coins each**: ${result.newWinners.map(id => `<@${id}>`).join(', ')}`)
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
    const data = global.coinsGiveawaySessions.get(sessionId);

    if (!data)
      return interaction.reply({ content: '⌛ This setup session has expired. Run `/coinsgiveaway create` again.', flags: MessageFlags.Ephemeral });
    if (data.userId !== interaction.user.id)
      return interaction.reply({ content: '❌ This setup panel belongs to someone else.', flags: MessageFlags.Ephemeral });

    if (action === 'cancel') {
      global.coinsGiveawaySessions.delete(sessionId);
      return interaction.update({ content: '✖️  Coins giveaway setup cancelled.', embeds: [], components: [] });
    }

    if (action === 'launch') return launchGiveaway(interaction, data, sessionId);

    if (action === 'panel') {
      return interaction.update({ embeds: [buildSetupEmbed(data, interaction.guild)], components: buildSetupRows(sessionId, data) });
    }

    if (action === 'requiredroleclear' || action === 'bonusroleclear') {
      if (action === 'requiredroleclear') data.requiredRoleId = null;
      else data.bonusRoleId = null;
      return interaction.update({ embeds: [buildSetupEmbed(data, interaction.guild)], components: buildSetupRows(sessionId, data) });
    }

    if (action === 'requiredrole' || action === 'bonusrole') {
      return interaction.update(buildRolePickerView(sessionId, action, action === 'requiredrole' ? data.requiredRoleId : data.bonusRoleId));
    }
    if (action === 'channel') {
      return interaction.update(buildChannelPickerView(sessionId));
    }

    const defs = {
      amount:   { title: '🪙  Set Coins Per Winner', label: `Amount (1–${MAX_AMOUNT.toLocaleString()})`, ph: '5000', max: 9, req: true },
      duration: { title: '⏱️  Set Duration', label: 'Duration', ph: '1h  |  30m  |  2d', max: 10, req: true },
      winners:  { title: '👥  Set Winners', label: `Number of winners (1–${MAX_WINNERS})`, ph: '1', max: 2, req: true },
      mention:  { title: '📣  Set Mention', label: '@everyone, @here, or a role ID', ph: '@everyone', max: 100, req: false },
      minage:   { title: '🕰️  Min. Account Age', label: 'Minimum account age in days (0 = off)', ph: '7', max: 5, req: false },
    };

    const def = defs[action];
    if (!def) return;

    const current = {
      amount: data.amount ? String(data.amount) : '',
      duration: data.duration,
      winners: String(data.winners),
      mention: data.mention,
      minage: data.minAccountAgeDays > 0 ? String(data.minAccountAgeDays) : '',
    }[action] || '';

    const modal = new ModalBuilder()
      .setCustomId(`cg_modal:${action}:${sessionId}`)
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
    const data = global.coinsGiveawaySessions.get(sessionId);

    if (!data)
      return interaction.reply({ content: '⌛ Session expired. Run `/coinsgiveaway create` again.', flags: MessageFlags.Ephemeral });

    const value = interaction.fields.getTextInputValue('value').trim();

    switch (action) {
      case 'amount': {
        const n = parseInt(value.replace(/,/g, ''), 10);
        if (isNaN(n) || n < 1 || n > MAX_AMOUNT)
          return interaction.reply({ content: `❌ Amount must be a number between **1** and **${MAX_AMOUNT.toLocaleString()}**.`, flags: MessageFlags.Ephemeral });
        data.amount = n;
        break;
      }

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
    const data = global.coinsGiveawaySessions.get(sessionId);
    if (!data) return interaction.update({ content: '⌛ Session expired. Run `/coinsgiveaway create` again.', embeds: [], components: [] });
    if (data.userId !== interaction.user.id) return interaction.reply({ content: '❌ This setup panel belongs to someone else.', flags: MessageFlags.Ephemeral });

    const roleId = interaction.values[0];
    if (field === 'requiredrole') data.requiredRoleId = roleId;
    else if (field === 'bonusrole') data.bonusRoleId = roleId;

    return interaction.update({ embeds: [buildSetupEmbed(data, interaction.guild)], components: buildSetupRows(sessionId, data) });
  },

  async handleChannelSelect(interaction) {
    ensureSessions();
    const [, sessionId] = interaction.customId.split(':');
    const data = global.coinsGiveawaySessions.get(sessionId);
    if (!data) return interaction.update({ content: '⌛ Session expired. Run `/coinsgiveaway create` again.', embeds: [], components: [] });
    if (data.userId !== interaction.user.id) return interaction.reply({ content: '❌ This setup panel belongs to someone else.', flags: MessageFlags.Ephemeral });

    data.channelId = interaction.values[0];
    return interaction.update({ embeds: [buildSetupEmbed(data, interaction.guild)], components: buildSetupRows(sessionId, data) });
  },

  // ── /coinsgiveaway list — delete-ended-giveaway select + confirm, in-place ──
  async handleListSelect(interaction) {
    if (interaction.customId !== 'cg_list_delsel') return;
    const shortId = interaction.values[0];
    const ended   = readJson(ENDED_FILE, {})[interaction.guild.id]?.[shortId];
    const label   = ended ? `${ended.amount.toLocaleString()} coins each` : shortId;
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('⚠️ Confirm Deletion')
      .setDescription(`Delete the record for **${label}** \`(${shortId})\`?\nThis only removes the saved record — it does not reclaim coins already paid out.\n**This cannot be undone.**`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cg_list_delyes:${shortId}`).setLabel('🗑️ Yes, Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cg_list_delno').setLabel('← Back').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [embed], components: [row] });
  },

  async handleListButton(interaction) {
    const id = interaction.customId;
    if (id.startsWith('cg_list_delyes:')) {
      const shortId = id.slice('cg_list_delyes:'.length);
      const allEnded = readJson(ENDED_FILE, {});
      if (allEnded[interaction.guild.id]?.[shortId]) {
        delete allEnded[interaction.guild.id][shortId];
        writeJson(ENDED_FILE, allEnded);
      }
      return interaction.update(buildListPayload(interaction.guild.id, interaction.guild));
    }
    if (id === 'cg_list_delno') {
      return interaction.update(buildListPayload(interaction.guild.id, interaction.guild));
    }
  },

  getActive,
  persistEntry,
  restoreCoinsGiveaways,
};

// Exposed for the web control panel, which ends and rerolls giveaways through
// exactly the same code path the slash command uses rather than a parallel one.
module.exports.postGiveaway     = postGiveaway;
module.exports.buildBanner      = buildBanner;
module.exports.endCoinsGiveaway = endCoinsGiveaway;
module.exports.performReroll    = performReroll;
module.exports.getActive        = getActive;
module.exports.ACTIVE_FILE      = ACTIVE_FILE;
module.exports.ENDED_FILE       = ENDED_FILE;
