'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { getAutoModSettings, setAutoModSettings, isAutoModExempt, getModLogChannel } = require('../../utils/modConfig');
const { findBadWord } = require('../../utils/badWords');
const { issueWarning } = require('../../utils/warnUtil');
const { postCustomLog, suppressDeleteLog } = require('../../utils/modLog');
const { createRequest, getRequest, updateRequest, findActiveRequest, LINK_REGEX } = require('../../utils/linkRequests');
const { evaluate, consumeAllowed, lockAfterViolation, grantPermit, getRecord, clearRecord, getAllPermits } = require('../../utils/linkPermits');

const FEATURES = [
  { key: 'badWords',   label: '🤬 Bad Word / Harassment Filter', desc: 'Deletes messages containing filtered words and warns the sender in-channel.' },
  { key: 'linkFilter',  label: '🔗 Link Posting Approval',        desc: 'Non-moderators need admin approval before a posted link goes through.' },
];

function buildPanelEmbed(guild, settings) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🛡️ Auto-Mod Control Panel')
    .setDescription(
      'Click a button below to toggle that filter on or off for this server.\n' +
      'Members with a role set via `/cmd mod-role` (or Administrators) are always exempt.',
    )
    .addFields(FEATURES.map(f => ({
      name: `${f.label} — ${settings[f.key] ? '🟢 ON' : '🔴 OFF'}`,
      value: f.desc,
      inline: false,
    })))
    .setFooter({ text: `${settings.customWords.length} custom word(s) added • Admins only` });
}

function buildPanelRow(settings) {
  return new ActionRowBuilder().addComponents(
    FEATURES.map(f => new ButtonBuilder()
      .setCustomId(`automod_toggle:${f.key}`)
      .setLabel(`${settings[f.key] ? 'Turn Off' : 'Turn On'}: ${f.label.replace(/^\S+\s/, '')}`)
      .setStyle(settings[f.key] ? ButtonStyle.Danger : ButtonStyle.Success),
    ),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod').setDescription('Configure automatic message moderation')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('panel').setDescription('Open the toggle panel for auto-mod filters'))
    .addSubcommand(s => s.setName('addword').setDescription('Add a custom word/phrase to this server\'s filter')
      .addStringOption(o => o.setName('word').setDescription('Word or phrase to filter').setRequired(true)))
    .addSubcommand(s => s.setName('removeword').setDescription('Remove a custom word/phrase from this server\'s filter')
      .addStringOption(o => o.setName('word').setDescription('Word or phrase to remove').setRequired(true)))
    .addSubcommand(s => s.setName('wordlist').setDescription('View this server\'s custom-added filter words'))
    .addSubcommand(s => s.setName('cooldowns').setDescription('List every active link cooldown, and adjust or delete one')),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'panel') {
      const settings = getAutoModSettings(guildId);
      return interaction.reply({ embeds: [buildPanelEmbed(interaction.guild, settings)], components: [buildPanelRow(settings)], ephemeral: true });
    }

    if (sub === 'addword') {
      const word = interaction.options.getString('word').trim().toLowerCase();
      if (!word) return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Invalid', description: 'Word cannot be empty.' }, interaction.guild)], ephemeral: true });
      const settings = getAutoModSettings(guildId);
      if (settings.customWords.includes(word)) {
        return interaction.reply({ embeds: [createServerEmbed('info', { title: 'Already Added', description: `\`${word}\` is already in this server's filter.` }, interaction.guild)], ephemeral: true });
      }
      settings.customWords.push(word);
      setAutoModSettings(guildId, { customWords: settings.customWords });
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '✅ Word Added', description: `\`${word}\` will now be filtered.` }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'removeword') {
      const word     = interaction.options.getString('word').trim().toLowerCase();
      const settings = getAutoModSettings(guildId);
      if (!settings.customWords.includes(word)) {
        return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Not Found', description: `\`${word}\` isn't in this server's custom filter list.` }, interaction.guild)], ephemeral: true });
      }
      setAutoModSettings(guildId, { customWords: settings.customWords.filter(w => w !== word) });
      return interaction.reply({ embeds: [createServerEmbed('success', { title: '✅ Word Removed', description: `\`${word}\` will no longer be filtered.` }, interaction.guild)], ephemeral: true });
    }

    if (sub === 'wordlist') {
      const settings = getAutoModSettings(guildId);
      return interaction.reply({
        embeds: [createServerEmbed('info', {
          title: '📋 Custom Filter Words',
          description: settings.customWords.length ? settings.customWords.map(w => `\`${w}\``).join(', ') : 'No custom words added yet. Use `/automod addword`.',
          footer: 'This is in addition to the built-in filter list',
        }, interaction.guild)],
        ephemeral: true,
      });
    }

    if (sub === 'cooldowns') {
      return interaction.reply({ ...buildCooldownListPayload(interaction.guild), ephemeral: true });
    }
  },

  // ── Panel toggle button ─────────────────────────────────────────────────
  async handleToggle(interaction, feature) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only Administrators can change auto-mod settings.', ephemeral: true });
    }
    const current  = getAutoModSettings(interaction.guild.id);
    const settings = setAutoModSettings(interaction.guild.id, { [feature]: !current[feature] });
    return interaction.update({ embeds: [buildPanelEmbed(interaction.guild, settings)], components: [buildPanelRow(settings)] });
  },

  // ── Message filtering (called from events/messageCreate.js) ────────────
  // Returns true if the message was removed/handled — the caller should stop
  // further processing (XP, card drops, autoreply) for that message.
  async handleMessage(message, client) {
    if (!message.guild || message.author.bot || !message.member) return false;
    const settings = getAutoModSettings(message.guild.id);
    if (!settings.badWords && !settings.linkFilter) return false;
    if (isAutoModExempt(message.member)) return false;

    if (settings.linkFilter && LINK_REGEX.test(message.content)) {
      // A previously-approved user gets exactly one link per their admin-set
      // cooldown, no re-request needed. Posting again before that cooldown
      // is up doesn't just cost the permit — it locks them out of
      // submitting a *new* request too, until the original cooldown would
      // have elapsed anyway, so spamming "Request Approval" can't shortcut it.
      const status = evaluate(message.guild.id, message.author.id);
      if (status.state === 'allowed') {
        consumeAllowed(message.guild.id, message.author.id);
        return false; // let it through, restart their cooldown clock
      }
      if (status.state === 'locked') {
        await handleLockedLinkAttempt(message, status.secondsLeft);
        return true;
      }
      if (status.state === 'waiting') {
        lockAfterViolation(message.guild.id, message.author.id);
        await handleLockedLinkAttempt(message, status.secondsLeft);
        return true;
      }
      await handleLinkViolation(message, client);
      return true;
    }

    if (settings.badWords) {
      const hit = findBadWord(message.content, settings.customWords);
      if (hit) {
        await handleBadWordViolation(message, client);
        return true;
      }
    }

    return false;
  },

  // ── Link-request button/modal/approval (routed from interactionCreate.js) ──
  handleLinkRequestButton,
  handleLinkModalSubmit,
  handleLinkApprove,
  handleLinkApproveModalSubmit,
  handleLinkDeny,

  // ── /automod cooldowns — list/select/manage (routed from interactionCreate.js) ──
  handleCooldownSelect,
  handleCooldownButton,
  handleCooldownAdjustModalSubmit,
};

// ── Bad-word filter action ──────────────────────────────────────────────
async function handleBadWordViolation(message, client) {
  const content = message.content;
  const channel = message.channel;
  const author  = message.author;

  try { await message.delete(); } catch { return; } // already gone — nothing to act on
  suppressDeleteLog(message.id);

  const warnMsg = await channel.send({
    embeds: [createServerEmbed('warning', {
      title: '⚠️ Message Removed',
      description: `${author}, that language isn't allowed here. Please keep the chat respectful.`,
    }, message.guild)],
  }).catch(() => null);
  if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 10_000);

  let autoPunish = null;
  try {
    ({ autoPunish } = await issueWarning(message.guild, { id: client.user.id, tag: 'Auto-Mod' }, author, message.member, 'Auto-Mod: filtered word/phrase detected'));
  } catch { /* warning system unavailable — the message removal above still stands */ }

  await postCustomLog(message.guild, new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('🤬 Auto-Mod: Bad Word Filtered')
    .addFields(
      { name: 'User',    value: `${author} \`${author.tag}\``, inline: true },
      { name: 'Channel', value: `${channel}`,                  inline: true },
      { name: 'Message', value: content ? (content.length > 500 ? `${content.slice(0, 500)}…` : content) : '*(no text content)*', inline: false },
    )
    .setTimestamp());

  if (autoPunish) {
    await channel.send({ content: `🤖 ${author} was automatically **${autoPunish.action}ed** after reaching **${autoPunish.threshold}** warnings.` }).catch(() => {});
  }
}

function readableDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.ceil(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

// Posts a short-lived, clearly-scoped-to-one-user notice in the channel —
// Discord only allows a true "only you can see" (ephemeral) message as a
// direct response to an interaction (slash command, button, modal…); a
// plain message being posted isn't one, so there's no API-level way to make
// this genuinely private without a DM. This is the closest practical
// stand-in: labeled so bystanders know it isn't for them, and auto-deleted
// quickly to minimize how long it's visible to anyone else.
async function sendPrivateNotice(channel, user, embed, components = [], ttlMs = 15_000) {
  embed.setFooter({ text: `👁️ Only relevant to ${user.username}` });
  const notice = await channel.send({ content: `${user}`, embeds: [embed], components }).catch(() => null);
  if (notice && ttlMs > 0) setTimeout(() => notice.delete().catch(() => {}), ttlMs);
  return notice;
}

async function handleLockedLinkAttempt(message, secondsLeft) {
  try { await message.delete(); } catch { return; }
  suppressDeleteLog(message.id);
  await sendPrivateNotice(message.channel, message.author, new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('🔒 Still On Cooldown')
    .setDescription(
      `You posted a link before your approved cooldown finished, so that permission has been **revoked**.\n` +
      `You can request approval again in **${readableDuration(secondsLeft)}**.`,
    ));
}

// ── Link filter action ──────────────────────────────────────────────────
async function handleLinkViolation(message, client) {
  // Never let a user pile up more than one live request — otherwise
  // spamming links and clicking "Request Approval" repeatedly stacks
  // duplicate approval cards in the mod-log channel.
  const existing = findActiveRequest(message.guild.id, message.author.id);
  if (existing) {
    try { await message.delete(); } catch { return; }
    suppressDeleteLog(message.id);
    await sendPrivateNotice(message.channel, message.author, new EmbedBuilder()
      .setColor(0xF39C12)
      .setTitle('⏳ Request Already Pending')
      .setDescription('You already have a link request waiting on a moderator\'s decision. Please wait for that one to be handled before sending another link.'));
    return;
  }

  const originalContent = message.content;
  const channelId = message.channel.id;

  try { await message.delete(); } catch { return; }
  suppressDeleteLog(message.id);

  const request = createRequest({
    guildId: message.guild.id, channelId,
    userId: message.author.id, userTag: message.author.tag,
    originalContent,
  });

  const embed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('🔗 Link Removed')
    .setDescription(
      `${message.author}, your message was removed — only moderators can post links here.\n\n` +
      'If you have a legitimate reason to share it, click below to request approval.',
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_link_request:${request.id}`).setLabel('📨 Request Approval').setStyle(ButtonStyle.Primary),
  );

  const notice = await sendPrivateNotice(message.channel, message.author, embed, [row], 60_000);
  if (notice) updateRequest(request.id, { noticeMessageId: notice.id });

  // If they never click through, the request would otherwise sit in
  // 'pending' forever — findActiveRequest would then treat it as still
  // live and permanently block them from ever requesting again.
  setTimeout(() => {
    const current = getRequest(request.id);
    if (current && current.status === 'pending') updateRequest(request.id, { status: 'expired' });
  }, 60_000);
}

async function handleLinkRequestButton(interaction, requestId) {
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request has expired.', ephemeral: true });
  if (request.userId !== interaction.user.id) return interaction.reply({ content: '❌ This isn\'t your request.', ephemeral: true });
  if (request.status !== 'pending') return interaction.reply({ content: `This request has already been **${request.status}**.`, ephemeral: true });

  const modal = new ModalBuilder().setCustomId(`automod_link_modal:${requestId}`).setTitle('Request to Post a Link').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('link').setLabel('The link').setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(500).setValue(request.link || ''),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel('What is it for?').setStyle(TextInputStyle.Paragraph)
        .setRequired(true).setMaxLength(500).setPlaceholder('Explain why you need to share this link'),
    ),
  );
  // Clean up the in-channel notice now that they're moving into the modal —
  // showModal() must be the first response to this interaction, so the
  // notice deletion fires-and-forgets rather than being awaited first.
  if (request.noticeMessageId) {
    interaction.channel?.messages.fetch(request.noticeMessageId).then(m => m.delete()).catch(() => {});
  }
  return interaction.showModal(modal);
}

async function handleLinkModalSubmit(interaction, requestId) {
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request has expired.', ephemeral: true });

  const link   = interaction.fields.getTextInputValue('link').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim();
  updateRequest(requestId, { link, reason, status: 'pending_review' });

  const guild          = interaction.client.guilds.cache.get(request.guildId);
  const modLogChannel  = guild ? getModLogChannel(guild) : null;
  if (!guild || !modLogChannel) {
    return interaction.reply({ content: '⚠️ This server hasn\'t set up a mod-log channel yet, so your request can\'t be reviewed. Contact an admin about `/config logs`.', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('🔗 Link Approval Request')
    .addFields(
      { name: 'User',             value: `<@${request.userId}> \`${request.userTag}\``, inline: true },
      { name: 'Channel',          value: `<#${request.channelId}>`,                      inline: true },
      { name: 'Link',             value: link,                                            inline: false },
      { name: 'Reason',           value: reason,                                          inline: false },
      { name: 'Original Message', value: request.originalContent ? (request.originalContent.length > 300 ? `${request.originalContent.slice(0, 300)}…` : request.originalContent) : '*(link only)*', inline: false },
    )
    .setFooter({ text: `Request #${requestId} • Admins only` })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_link_approve:${requestId}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`automod_link_deny:${requestId}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
  );
  await modLogChannel.send({ embeds: [embed], components: [row] }).catch(() => {});

  return interaction.reply({
    embeds: [createServerEmbed('success', { title: '📨 Request Sent', description: 'Your link request has been sent to the moderators for review. You\'ll be notified when it\'s handled.' }, interaction.guild)],
    ephemeral: true,
  });
}

// Approving isn't instant — the admin sets how long this user's next-link
// cooldown should be first, via a modal, so the "one link per cooldown"
// permit can actually be granted rather than a one-time-only exception.
async function handleLinkApprove(interaction, requestId) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Only Administrators can approve link requests.', ephemeral: true });
  }
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request no longer exists.', ephemeral: true });
  if (request.status === 'approved' || request.status === 'denied') {
    return interaction.reply({ content: `This request was already **${request.status}**.`, ephemeral: true });
  }

  const modal = new ModalBuilder().setCustomId(`automod_link_approve_modal:${requestId}`).setTitle('Approve Link Request').addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown until next link (1h/24h/7d)')
        .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setValue('24h'),
    ),
  );
  return interaction.showModal(modal);
}

async function handleLinkApproveModalSubmit(interaction, requestId) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Only Administrators can approve link requests.', ephemeral: true });
  }
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request no longer exists.', ephemeral: true });
  if (request.status === 'approved' || request.status === 'denied') {
    return interaction.reply({ content: `This request was already **${request.status}**.`, ephemeral: true });
  }

  const raw   = interaction.fields.getTextInputValue('cooldown').trim();
  const match = raw.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return interaction.reply({ content: '❌ Invalid cooldown format. Use something like `30m`, `1h`, `24h`, or `7d`.', ephemeral: true });
  }
  const cooldownMs = parseInt(match[1], 10) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];

  updateRequest(requestId, { status: 'approved', cooldownLabel: raw });
  grantPermit(request.guildId, request.userId, cooldownMs);

  const targetChannel = interaction.guild.channels.cache.get(request.channelId);
  if (targetChannel) {
    // The reposted link is the actual approved content — it stays public
    // and persistent, unlike the status notice below.
    await targetChannel.send({ content: `🔗 **${request.userTag}** (link approved by ${interaction.user.tag}):\n${request.originalContent || request.link}` }).catch(() => {});
    const user = await interaction.client.users.fetch(request.userId).catch(() => null);
    if (user) {
      await sendPrivateNotice(targetChannel, user, new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('✅ Link Request Approved')
        .setDescription(`You can post **one more link every ${raw}**. Post another before the cooldown's up and this permission is revoked — you'd need to request approval again.`), [], 20_000);
    }
  }

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x2ECC71).setFooter({ text: `✅ Approved by ${interaction.user.tag} • Cooldown: ${raw}` });
  return interaction.update({ embeds: [updatedEmbed], components: [] });
}

async function handleLinkDeny(interaction, requestId) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Only Administrators can deny link requests.', ephemeral: true });
  }
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request no longer exists.', ephemeral: true });
  if (request.status === 'approved' || request.status === 'denied') {
    return interaction.reply({ content: `This request was already **${request.status}**.`, ephemeral: true });
  }
  updateRequest(requestId, { status: 'denied' });

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xE74C3C).setFooter({ text: `❌ Denied by ${interaction.user.tag}` });
  await interaction.update({ embeds: [updatedEmbed], components: [] });

  const targetChannel = interaction.guild.channels.cache.get(request.channelId);
  if (targetChannel) {
    const user = await interaction.client.users.fetch(request.userId).catch(() => null);
    if (user) {
      await sendPrivateNotice(targetChannel, user, new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('❌ Link Request Denied')
        .setDescription(`Your link request was denied by ${interaction.user.tag}.`), [], 20_000);
    }
  }
}

// ── /automod cooldowns — list every active permit, with select-to-manage ───
// Built the same way as /giveaway list: an embed + a select menu of live
// entries, selecting one opens a confirm/manage step, actions re-render the
// same list in place via interaction.update().

function statusLine(guild, userId) {
  const status = evaluate(guild.id, userId);
  if (status.state === 'locked')  return `🔒 Locked — next request allowed in **${readableDuration(status.secondsLeft)}**`;
  if (status.state === 'waiting') return `⏳ Waiting — next link auto-allowed in **${readableDuration(status.secondsLeft)}**`;
  return '🟢 Ready — their next link goes through automatically';
}

function buildCooldownListPayload(guild) {
  const permits = getAllPermits(guild.id);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔗 Link Cooldowns')
    .setFooter({ text: `${permits.length} active permit${permits.length !== 1 ? 's' : ''} • Admins only` })
    .setTimestamp();

  if (permits.length === 0) {
    embed.setDescription('_No active link cooldowns right now — they\'re created when you approve a link request._');
  } else {
    embed.setDescription(permits.map(p => {
      const member = guild.members.cache.get(p.userId);
      const cooldown = readableDuration(Math.round(p.cooldownMs / 1000));
      return `${member || `<@${p.userId}>`} — cooldown **${cooldown}** · ${statusLine(guild, p.userId)}`;
    }).join('\n'));
  }

  const components = [];
  if (permits.length > 0) {
    const options = permits.slice(0, 25).map(p => {
      const member = guild.members.cache.get(p.userId);
      return new StringSelectMenuOptionBuilder()
        .setLabel((member?.user.tag || `User ${p.userId}`).slice(0, 100))
        .setDescription(`Cooldown: ${readableDuration(Math.round(p.cooldownMs / 1000))}`.slice(0, 100))
        .setValue(p.userId);
    });
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('automod_cd_select').setPlaceholder('⚙️ Manage a user\'s cooldown…').addOptions(options),
    ));
  }
  return { embeds: [embed], components };
}

function buildCooldownManagePayload(guild, userId) {
  const rec = getRecord(guild.id, userId);
  if (!rec) return null;
  const member   = guild.members.cache.get(userId);
  const cooldown = readableDuration(Math.round(rec.cooldownMs / 1000));

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚙️ Manage Cooldown')
    .setDescription(
      `${member || `<@${userId}>`}\n\n` +
      `**Cooldown:** ${cooldown}\n` +
      `**Status:** ${statusLine(guild, userId)}`,
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_cd_adjust:${userId}`).setLabel('✏️ Adjust Cooldown').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`automod_cd_delete:${userId}`).setLabel('🗑️ Delete').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('automod_cd_back').setLabel('← Back').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

async function handleCooldownSelect(interaction) {
  if (interaction.customId !== 'automod_cd_select') return;
  const userId  = interaction.values[0];
  const payload = buildCooldownManagePayload(interaction.guild, userId);
  if (!payload) return interaction.update(buildCooldownListPayload(interaction.guild));
  return interaction.update(payload);
}

async function handleCooldownButton(interaction) {
  const id = interaction.customId;

  if (id === 'automod_cd_back') {
    return interaction.update(buildCooldownListPayload(interaction.guild));
  }

  if (id.startsWith('automod_cd_delete:')) {
    const userId = id.slice('automod_cd_delete:'.length);
    const member = interaction.guild.members.cache.get(userId);
    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('⚠️ Confirm Deletion')
      .setDescription(`Delete the link cooldown for ${member || `<@${userId}>`}?\nThey'll be treated as if they've never requested a link before.\n**This cannot be undone.**`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`automod_cd_delyes:${userId}`).setLabel('🗑️ Yes, Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`automod_cd_delno:${userId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (id.startsWith('automod_cd_delyes:')) {
    const userId = id.slice('automod_cd_delyes:'.length);
    clearRecord(interaction.guild.id, userId);
    return interaction.update(buildCooldownListPayload(interaction.guild));
  }

  if (id.startsWith('automod_cd_delno:')) {
    const userId   = id.slice('automod_cd_delno:'.length);
    const payload  = buildCooldownManagePayload(interaction.guild, userId);
    return interaction.update(payload || buildCooldownListPayload(interaction.guild));
  }

  if (id.startsWith('automod_cd_adjust:')) {
    const userId = id.slice('automod_cd_adjust:'.length);
    const rec     = getRecord(interaction.guild.id, userId);
    if (!rec) return interaction.update(buildCooldownListPayload(interaction.guild));
    const current = readableDuration(Math.round(rec.cooldownMs / 1000));
    const modal = new ModalBuilder().setCustomId(`automod_cd_adjust_modal:${userId}`).setTitle('Adjust Cooldown').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('cooldown').setLabel('New cooldown (e.g. 1h, 24h, 7d)')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setValue(current),
      ),
    );
    return interaction.showModal(modal);
  }
}

async function handleCooldownAdjustModalSubmit(interaction, userId) {
  const rec = getRecord(interaction.guild.id, userId);
  if (!rec) {
    return interaction.reply({ content: '⌛ That cooldown no longer exists — it may have already been deleted or expired.', ephemeral: true });
  }

  const raw   = interaction.fields.getTextInputValue('cooldown').trim();
  const match = raw.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return interaction.reply({ content: '❌ Invalid cooldown format. Use something like `30m`, `1h`, `24h`, or `7d`.', ephemeral: true });
  }
  const cooldownMs = parseInt(match[1], 10) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];

  grantPermit(interaction.guild.id, userId, cooldownMs);

  const payload = buildCooldownManagePayload(interaction.guild, userId);
  return interaction.update(payload || buildCooldownListPayload(interaction.guild));
}
