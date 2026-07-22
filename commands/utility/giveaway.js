'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { readJson, writeJson } = require('../../utils/jsonStorage');

const GOLD         = 0xFFD700;
const SETUP_EXPIRY = 10 * 60 * 1000; // 10 min

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
      () => endGiveaway(msg, data.prize, data.winnersCount, data.imageUrl, data.hostId, data.guildId),
      remaining,
    ));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(guildId) {
  const existing = Object.keys(readJson('giveaways_ended.json', {})[guildId] || {});
  let id;
  do {
    id = Array.from({ length: 5 }, () => ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]).join('');
  } while (existing.includes(id));
  return id;
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  return parseInt(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
}

function dateStr(ts) { return new Date(ts).toISOString().slice(0, 10); }

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
  ];

  // Split into two columns via inline fields
  const fields = lines.map((l, i) => ({
    name: '\u200b',
    value: l,
    inline: true,
    // add zero-width spacer every 3rd to force 2-col layout
  }));

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
  const { prize, durationMs, winners, imageUrl, mention, channelId, guildId } = data;

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

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`🎟️  ${prize}`)
    .setDescription(
      `✨ Click **Enter** below to participate!\n\n` +
      `🏆 **Winners:** ${winners}\n` +
      `👤 **Hosted by:** <@${interaction.user.id}>\n` +
      `⏰ **Ends:** <t:${endTimestamp}:R>\n` +
      `📊 **Entries:** 0 participants`,
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
  global.giveawayMeta.set(msg.id, { prize, winners, imageUrl, hostId: interaction.user.id, endTime, guildId });

  // Persist so entries and the timer survive a bot restart
  saveActiveGiveaway(msg.id, {
    prize, winnersCount: winners, imageUrl: imageUrl || null,
    hostId: interaction.user.id, endTime, guildId, channelId: msg.channelId, entrants: [],
  });

  if (giveawayTimers.has(msg.id)) clearTimeout(giveawayTimers.get(msg.id));
  giveawayTimers.set(msg.id, setTimeout(() => endGiveaway(msg, prize, winners, imageUrl, interaction.user.id, guildId), durationMs));

  await interaction.update({
    content: `🎉  Giveaway launched in ${channel}!`,
    embeds: [],
    components: [],
  });
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway').setDescription('Start a giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sessionId = newSession(interaction);
    const data      = global.giveawaySessions.get(sessionId);
    await interaction.reply({
      embeds: [buildSetupEmbed(data, interaction.guild)],
      components: buildSetupRows(sessionId, data),
      ephemeral: true,
    });
  },

  // ── Button handler ──────────────────────────────────────────────────────────
  async handleSetupButton(interaction) {
    ensureSessions();
    const [, action, sessionId] = interaction.customId.split(':');
    const data = global.giveawaySessions.get(sessionId);

    if (!data)
      return interaction.reply({ content: '⌛ This setup session has expired. Run `/giveaway` again.', ephemeral: true });
    if (data.userId !== interaction.user.id)
      return interaction.reply({ content: '❌ This setup panel belongs to someone else.', ephemeral: true });

    if (action === 'cancel') {
      global.giveawaySessions.delete(sessionId);
      return interaction.update({ content: '✖️  Giveaway setup cancelled.', embeds: [], components: [] });
    }

    if (action === 'launch') return launchGiveaway(interaction, data, sessionId);

    // Open a modal for the chosen field
    const defs = {
      prize:    { title: '🏆  Set Prize',         label: 'Prize',                          ph: 'e.g. Nitro Classic, $10 Gift Card', max: 100, req: true  },
      duration: { title: '⏱️  Set Duration',      label: 'Duration',                       ph: '1h  |  30m  |  2d',                 max: 10,  req: true  },
      winners:  { title: '👥  Set Winners',        label: 'Number of winners (1–10)',       ph: '1',                                 max: 2,   req: true  },
      image:    { title: '🖼️  Set Image URL',     label: 'Image URL',                      ph: 'https://example.com/image.png',     max: 500, req: false },
      mention:  { title: '📣  Set Mention',        label: '@everyone, @here, or a role ID', ph: '@everyone',                         max: 100, req: false },
      channel:  { title: '📢  Set Channel',        label: 'Channel ID or <#id>',            ph: 'Paste the channel ID',              max: 50,  req: true  },
    };

    const def = defs[action];
    if (!def) return;

    const current = {
      prize: data.prize, duration: data.duration,
      winners: String(data.winners),
      image: data.imageUrl, mention: data.mention,
      channel: data.channelId,
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
      return interaction.reply({ content: '⌛ Session expired. Run `/giveaway` again.', ephemeral: true });

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
        if (isNaN(n) || n < 1 || n > 10)
          return interaction.reply({ content: '❌ Winners must be a number between **1** and **10**.', ephemeral: true });
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
    }

    await interaction.update({
      embeds: [buildSetupEmbed(data, interaction.guild)],
      components: buildSetupRows(sessionId, data),
    });
  },
};

// ── Pick winners ──────────────────────────────────────────────────────────────

function pickWinners(entrantIds, count) {
  const shuffled = [...entrantIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

// ── End giveaway ──────────────────────────────────────────────────────────────

async function endGiveaway(message, prize, winnersCount, imageUrl, hostId, guildId) {
  if (!global.giveawayEntrants) global.giveawayEntrants = new Map();
  const entrants = global.giveawayEntrants.get(message.id);

  const disabledRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_ended').setLabel('Ended').setStyle(ButtonStyle.Secondary).setDisabled(true).setEmoji('🎟️'),
    new ButtonBuilder().setCustomId('giveaway_participants').setLabel('Participants').setStyle(ButtonStyle.Secondary).setEmoji('🏅'),
  );

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
    giveawayTimers.delete(message.id);
    return;
  }

  const entrantIds     = Array.from(entrants);
  const winnerIds      = pickWinners(entrantIds, winnersCount);
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
      `🔁 To reroll, use \`g.reroll ${shortId}\``,
    )
    .setFooter({ text: `Congratulations! 🎉 • ID: ${shortId}` })
    .setTimestamp();
  if (imageUrl) embed.setImage(imageUrl);

  await message.edit({ embeds: [embed], components: [disabledRow] });
  removeActiveGiveaway(message.id);
  global.giveawayEntrants.delete(message.id);
  global.giveawayMeta?.delete(message.id);
  giveawayTimers.delete(message.id);
}

// ── Reroll ────────────────────────────────────────────────────────────────────

module.exports.getActiveGiveaway    = getActiveGiveaway;
module.exports.persistGiveawayEntry = persistGiveawayEntry;
module.exports.restoreGiveaways     = restoreGiveaways;

module.exports.reroll = async function(message, shortId) {
  if (!shortId)
    return message.reply({ embeds: [{ color: 0xe74c3c, title: '❌ Usage', description: 'Use `g.reroll <id>` — the ID is shown in the ended giveaway embed.' }] });

  const allEnded = readJson('giveaways_ended.json', {});
  const guildId  = message.guild.id;
  const data     = allEnded[guildId]?.[shortId.toLowerCase()];

  if (!data)
    return message.reply({ embeds: [{ color: 0xe74c3c, title: '❌ Not Found', description: `No ended giveaway found with ID \`${shortId}\`.` }] });

  const member   = message.member;
  const hasPerms = member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator);
  if (!hasPerms)
    return message.reply({ embeds: [{ color: 0xe74c3c, title: '❌ No Permission', description: 'You need **Manage Messages** to reroll giveaways.' }] });

  if (!data.entrants || data.entrants.length === 0)
    return message.reply({ embeds: [{ color: 0xe74c3c, title: '❌ No Entrants', description: 'This giveaway had no participants, cannot reroll.' }] });

  const newWinners     = pickWinners(data.entrants, data.winnersCount);
  const winnerMentions = newWinners.map(id => `<@${id}>`).join(', ');

  data.currentWinners = newWinners;
  allEnded[guildId][shortId.toLowerCase()] = data;
  writeJson('giveaways_ended.json', allEnded);

  try {
    const channel = await message.client.channels.fetch(data.channelId);
    const origMsg = await channel.messages.fetch(data.messageId);
    const updEmbed = new EmbedBuilder()
      .setColor(GOLD)
      .setTitle(`🎟️  ${data.prize} — Ended`)
      .setDescription(
        `🏆 **Winner${newWinners.length > 1 ? 's' : ''}:** ${winnerMentions}\n\n` +
        `👤 **Hosted by:** <@${data.hostId}>\n` +
        `📊 **Total entries:** ${data.entrants.length}\n\n` +
        `🔁 To reroll, use \`g.reroll ${shortId}\``,
      )
      .setFooter({ text: `Rerolled 🎲 • ID: ${shortId}` })
      .setTimestamp();
    if (data.imageUrl) updEmbed.setImage(data.imageUrl);
    await origMsg.edit({ embeds: [updEmbed] }).catch(() => {});
  } catch {}

  await message.reply({
    embeds: [new EmbedBuilder()
      .setColor(GOLD)
      .setTitle('🎲 Giveaway Rerolled')
      .setDescription(`New winner${newWinners.length > 1 ? 's' : ''} for **${data.prize}**: ${winnerMentions}`)
      .setFooter({ text: `ID: ${shortId}` })],
  });
};
