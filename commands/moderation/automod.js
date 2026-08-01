'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  AutoModerationRuleTriggerType, AutoModerationActionType, AutoModerationRuleEventType,
  MessageFlags,
} = require('discord.js');
const { createServerEmbed, sendTempReply } = require('../../utils/embedBuilder');
const { getAutoModSettings, setAutoModSettings, isAutoModExempt, getModLogChannel } = require('../../utils/modConfig');
const { readJson } = require('../../utils/jsonStorage');
const { findBadWord } = require('../../utils/badWords');
const { issueWarning } = require('../../utils/warnUtil');
const { postCustomLog, suppressDeleteLog } = require('../../utils/modLog');
const {
  createRequest, getRequest, updateRequest, deleteRequest,
  findActiveRequest, getAllActiveRequests, getUserHistory, LINK_REGEX,
} = require('../../utils/linkRequests');
const { analyse, humanAge, flagLines, severity } = require('../../utils/linkInsight');
const linkDecisions = require('../../utils/linkDecisions');
const { evaluate, consumeAllowed, lockAfterViolation, grantPermit, getRecord, clearRecord, getAllPermits } = require('../../utils/linkPermits');

const FEATURES = [
  { key: 'badWords',              label: '🤬 Bad Word / Harassment Filter',        desc: 'Deletes messages containing filtered words and warns the sender in-channel.' },
  { key: 'linkFilter',            label: '🔗 Link Posting Approval',               desc: 'Non-moderators need admin approval before a posted link goes through.' },
  { key: 'mentionSpamProtection', label: '🚨 Mass-Mention Raid Protection (native)', desc: 'Uses Discord\'s built-in Auto Moderation to instantly block messages with excessive @mentions — a common raid tactic.' },
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
    .addSubcommand(s => s.setName('cooldowns').setDescription('List every active link cooldown, and adjust or delete one'))
    .addSubcommand(s => s.setName('requests').setDescription('List every pending link request by user, and approve/deny/delete one')),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'panel') {
      const settings = getAutoModSettings(guildId);
      return interaction.reply({ embeds: [buildPanelEmbed(interaction.guild, settings)], components: [buildPanelRow(settings)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'addword') {
      const word = interaction.options.getString('word').trim().toLowerCase();
      if (!word) return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Invalid', description: 'Word cannot be empty.' }, interaction.guild)] });
      const settings = getAutoModSettings(guildId);
      if (settings.customWords.includes(word)) {
        return sendTempReply(interaction, { embeds: [createServerEmbed('info', { title: 'Already Added', description: `\`${word}\` is already in this server's filter.` }, interaction.guild)] });
      }
      settings.customWords.push(word);
      setAutoModSettings(guildId, { customWords: settings.customWords });
      return sendTempReply(interaction, { embeds: [createServerEmbed('success', { title: '✅ Word Added', description: `\`${word}\` will now be filtered.` }, interaction.guild)] });
    }

    if (sub === 'removeword') {
      const word     = interaction.options.getString('word').trim().toLowerCase();
      const settings = getAutoModSettings(guildId);
      if (!settings.customWords.includes(word)) {
        return sendTempReply(interaction, { embeds: [createServerEmbed('error', { title: 'Not Found', description: `\`${word}\` isn't in this server's custom filter list.` }, interaction.guild)] });
      }
      setAutoModSettings(guildId, { customWords: settings.customWords.filter(w => w !== word) });
      return sendTempReply(interaction, { embeds: [createServerEmbed('success', { title: '✅ Word Removed', description: `\`${word}\` will no longer be filtered.` }, interaction.guild)] });
    }

    if (sub === 'wordlist') {
      const settings = getAutoModSettings(guildId);
      return interaction.reply({
        embeds: [createServerEmbed('info', {
          title: '📋 Custom Filter Words',
          description: settings.customWords.length ? settings.customWords.map(w => `\`${w}\``).join(', ') : 'No custom words added yet. Use `/automod addword`.',
          footer: 'This is in addition to the built-in filter list',
        }, interaction.guild)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'cooldowns') {
      return interaction.reply({ ...buildCooldownListPayload(interaction.guild), flags: MessageFlags.Ephemeral });
    }

    if (sub === 'requests') {
      return interaction.reply({ ...buildRequestsListPayload(interaction.guild), flags: MessageFlags.Ephemeral });
    }
  },

  // ── Panel toggle button ─────────────────────────────────────────────────
  async handleToggle(interaction, feature) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Only Administrators can change auto-mod settings.', flags: MessageFlags.Ephemeral });
    }
    const current = getAutoModSettings(interaction.guild.id);

    // This one isn't a plain flag — it has to actually create/delete a real
    // Discord AutoModerationRule, so it needs its own path with error
    // handling (missing Manage Server permission, API failures, etc.)
    // instead of the simple flip-a-boolean the other filters use.
    if (feature === 'mentionSpamProtection') {
      const result = await setMentionSpamRule(interaction.guild, !current.mentionSpamProtection);
      if (!result.ok) {
        return interaction.reply({ content: `❌ Couldn't update mass-mention protection: ${result.error}\nMake sure the bot has **Manage Server** permission.`, flags: MessageFlags.Ephemeral });
      }
      const settings = getAutoModSettings(interaction.guild.id);
      return interaction.update({ embeds: [buildPanelEmbed(interaction.guild, settings)], components: [buildPanelRow(settings)] });
    }

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

  // ── /automod requests — list/select/manage (routed from interactionCreate.js) ──
  handleRequestsSelect,
  handleRequestsButton,
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
  if (!request) return interaction.reply({ content: '⌛ This request has expired.', flags: MessageFlags.Ephemeral });
  if (request.userId !== interaction.user.id) return interaction.reply({ content: '❌ This isn\'t your request.', flags: MessageFlags.Ephemeral });
  if (request.status !== 'pending') return interaction.reply({ content: `This request has already been **${request.status}**.`, flags: MessageFlags.Ephemeral });

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

/**
 * The approval card.
 *
 * Shared by the mod-log post and /automod requests' manage panel. It used to
 * be the link, a reason, and nothing else — which makes every request look
 * identical, so a two-year regular sharing their own site reads the same as an
 * account made this morning posting a shortener.
 *
 * It now leads with who is asking and what is being asked for, and carries a
 * signals block drawn from things that cannot be talked around: the domain
 * itself, how old the account is, how long they have been here, and how their
 * previous requests went. The colour follows the worst signal, so a card that
 * needs a careful read looks different across the channel from one that does
 * not.
 *
 * @param {object} request
 * @param {object} [guild] used for member/account age; the card degrades
 *   gracefully without it.
 */
function buildRequestCardEmbed(request, guild) {
  const member = guild?.members?.cache?.get(request.userId) || null;
  const history = getUserHistory(request.guildId, request.userId);
  const insight = analyse(request.link || request.originalContent, {
    // Discord snowflakes carry their own creation time, so this needs no fetch.
    accountCreatedAt: snowflakeTime(request.userId),
    joinedAt: member?.joinedTimestamp,
    history,
  });

  const COLOURS = { danger: 0xE74C3C, warn: 0xF39C12, clear: 0x5865F2 };
  const seen = history.total > 1 ? `${history.total - 1} previous request${history.total - 1 === 1 ? '' : 's'} · ✅ ${history.approved} · ❌ ${history.denied}` : 'First request from this member';

  const original = request.originalContent && request.originalContent !== request.link
    ? (request.originalContent.length > 300 ? `${request.originalContent.slice(0, 300)}…` : request.originalContent)
    : null;

  const embed = new EmbedBuilder()
    .setColor(COLOURS[severity(insight.flags)])
    .setTitle('🔗 Link Approval Request')
    .setDescription(
      `<@${request.userId}> wants to post a link in <#${request.channelId}>.\n` +
      `**\`${insight.domain || 'unreadable address'}\`**`,
    )
    .addFields(
      {
        name: '👤 Who is asking',
        value: `\`${request.userTag}\`\nAccount ${humanAge(snowflakeTime(request.userId))} old${member?.joinedTimestamp ? ` · here ${humanAge(member.joinedTimestamp)}` : ''}\n${seen}`,
        inline: true,
      },
      {
        name: '🔎 Signals',
        value: flagLines(insight.flags),
        inline: true,
      },
      { name: '🌐 The link', value: `\`\`\`\n${(request.link || '(none)').slice(0, 400)}\n\`\`\``, inline: false },
      { name: '💬 Their reason', value: request.reason ? request.reason.slice(0, 500) : '*(none given)*', inline: false },
    );

  if (original) embed.addFields({ name: '📝 The message it came from', value: original, inline: false });

  return embed
    .setFooter({ text: `Request #${request.id} • Approve grants one link per cooldown • Admins only` })
    .setTimestamp(request.createdAt || Date.now());
}

/**
 * When a Discord id was created.
 *
 * Every snowflake embeds its own timestamp, so account age needs no API call —
 * which matters on a card built while a message is being handled.
 */
function snowflakeTime(id) {
  try { return Number((BigInt(id) >> 22n) + 1420070400000n); }
  catch { return NaN; }
}

function buildRequestCardRow(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_link_approve:${requestId}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`automod_link_deny:${requestId}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger),
  );
}

async function handleLinkModalSubmit(interaction, requestId) {
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request has expired.', flags: MessageFlags.Ephemeral });

  const link   = interaction.fields.getTextInputValue('link').trim();
  const reason = interaction.fields.getTextInputValue('reason').trim();
  const updated = updateRequest(requestId, { link, reason, status: 'pending_review' });

  const guild          = interaction.client.guilds.cache.get(request.guildId);
  const modLogChannel  = guild ? getModLogChannel(guild) : null;
  if (!guild || !modLogChannel) {
    return interaction.reply({ content: '⚠️ This server hasn\'t set up a mod-log channel yet, so your request can\'t be reviewed. Contact an admin about `/config logs`.', flags: MessageFlags.Ephemeral });
  }

  await modLogChannel.send({ embeds: [buildRequestCardEmbed(updated, guild)], components: [buildRequestCardRow(requestId)] }).catch(() => {});

  return sendTempReply(interaction, {
    embeds: [createServerEmbed('success', { title: '📨 Request Sent', description: 'Your link request has been sent to the moderators for review. You\'ll be notified when it\'s handled.' }, interaction.guild)],
  });
}

// Approving isn't instant — the admin sets how long this user's next-link
// cooldown should be first, via a modal, so the "one link per cooldown"
// permit can actually be granted rather than a one-time-only exception.
async function handleLinkApprove(interaction, requestId) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Only Administrators can approve link requests.', flags: MessageFlags.Ephemeral });
  }
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request no longer exists.', flags: MessageFlags.Ephemeral });
  if (request.status === 'approved' || request.status === 'denied') {
    return interaction.reply({ content: `This request was already **${request.status}**.`, flags: MessageFlags.Ephemeral });
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
    return interaction.reply({ content: '❌ Only Administrators can approve link requests.', flags: MessageFlags.Ephemeral });
  }
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request no longer exists.', flags: MessageFlags.Ephemeral });
  if (request.status === 'approved' || request.status === 'denied') {
    return interaction.reply({ content: `This request was already **${request.status}**.`, flags: MessageFlags.Ephemeral });
  }

  const raw = interaction.fields.getTextInputValue('cooldown').trim();

  // Granting the permit, reposting the link and telling the member all live in
  // utils/linkDecisions so the panel does exactly the same thing.
  const result = await linkDecisions.approve({
    client: interaction.client, requestId, cooldown: raw, by: interaction.user.tag,
  });
  if (!result.ok) {
    if (result.error === 'bad_cooldown') {
      return interaction.reply({ content: '❌ Invalid cooldown format. Use something like `30m`, `1h`, `24h`, or `7d`.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ content: `⌛ ${result.error === 'already_decided' ? `This request was already **${result.status}**.` : 'This request no longer exists.'}`, flags: MessageFlags.Ephemeral });
  }

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x2ECC71).setFooter({ text: `✅ Approved by ${interaction.user.tag} • Cooldown: ${result.cooldownLabel}` });
  return interaction.update({ embeds: [updatedEmbed], components: [] });
}

async function handleLinkDeny(interaction, requestId) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Only Administrators can deny link requests.', flags: MessageFlags.Ephemeral });
  }
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request no longer exists.', flags: MessageFlags.Ephemeral });
  if (request.status === 'approved' || request.status === 'denied') {
    return interaction.reply({ content: `This request was already **${request.status}**.`, flags: MessageFlags.Ephemeral });
  }
  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xE74C3C).setFooter({ text: `❌ Denied by ${interaction.user.tag}` });
  await interaction.update({ embeds: [updatedEmbed], components: [] });
  await linkDecisions.deny({ client: interaction.client, requestId, by: interaction.user.tag });
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
    return interaction.reply({ content: '⌛ That cooldown no longer exists — it may have already been deleted or expired.', flags: MessageFlags.Ephemeral });
  }

  const raw   = interaction.fields.getTextInputValue('cooldown').trim();
  const match = raw.match(/^(\d+)([smhd])$/i);
  if (!match) {
    return interaction.reply({ content: '❌ Invalid cooldown format. Use something like `30m`, `1h`, `24h`, or `7d`.', flags: MessageFlags.Ephemeral });
  }
  const cooldownMs = parseInt(match[1], 10) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];

  grantPermit(interaction.guild.id, userId, cooldownMs);

  const payload = buildCooldownManagePayload(interaction.guild, userId);
  return interaction.update(payload || buildCooldownListPayload(interaction.guild));
}

// ── /automod requests — list every pending link request, select-to-manage ──
// Same pattern as /automod cooldowns and /giveaway list. Selecting a
// pending_review request opens the exact same card + Approve/Deny buttons
// as the mod-log posting (so an admin can act on it right from the list,
// not just from wherever it landed in mod-log), plus a delete option to
// clear a stuck/orphaned request without notifying anyone — the fix for a
// request that got stuck and kept blocking that user from requesting again.

const REQUEST_STATUS_LABEL = {
  pending: '📝 Awaiting their submission',
  pending_review: '⏳ Awaiting admin review',
};

function buildRequestsListPayload(guild) {
  const requests = getAllActiveRequests(guild.id);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔗 Pending Link Requests')
    .setFooter({ text: `${requests.length} active request${requests.length !== 1 ? 's' : ''} • Admins only` })
    .setTimestamp();

  if (requests.length === 0) {
    embed.setDescription('_No pending link requests right now._');
  } else {
    embed.setDescription(requests.map(r => {
      const member = guild.members.cache.get(r.userId);
      return `${member || `<@${r.userId}>`} — ${REQUEST_STATUS_LABEL[r.status] || r.status} · <t:${Math.floor(r.createdAt / 1000)}:R>`;
    }).join('\n'));
  }

  const components = [];
  if (requests.length > 0) {
    const options = requests.slice(0, 25).map(r => {
      const member = guild.members.cache.get(r.userId);
      return new StringSelectMenuOptionBuilder()
        .setLabel((member?.user.tag || r.userTag || `User ${r.userId}`).slice(0, 100))
        .setDescription((REQUEST_STATUS_LABEL[r.status] || r.status).slice(0, 100))
        .setValue(r.id);
    });
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('automod_req_select').setPlaceholder('📨 Manage a pending request…').addOptions(options),
    ));
  }
  return { embeds: [embed], components };
}

function buildRequestManagePayload(request, guild) {
  if (request.status === 'pending_review') {
    const rows = [
      buildRequestCardRow(request.id),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`automod_req_delete:${request.id}`).setLabel('🗑️ Delete Without Notifying').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('automod_req_back').setLabel('← Back').setStyle(ButtonStyle.Secondary),
      ),
    ];
    return { embeds: [buildRequestCardEmbed(request, guild)], components: rows };
  }

  // status === 'pending' — they clicked "Request Approval" but haven't
  // submitted the link/reason modal yet (or their notice already expired).
  const embed = new EmbedBuilder()
    .setColor(0x95A5A6)
    .setTitle('📝 Awaiting Submission')
    .setDescription(
      `<@${request.userId}> \`${request.userTag}\` hasn't filled in the link/reason yet.\n` +
      `Created <t:${Math.floor(request.createdAt / 1000)}:R> in <#${request.channelId}>.`,
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_req_delete:${request.id}`).setLabel('🗑️ Delete Request').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('automod_req_back').setLabel('← Back').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

async function handleRequestsSelect(interaction) {
  if (interaction.customId !== 'automod_req_select') return;
  const requestId = interaction.values[0];
  const request    = getRequest(requestId);
  if (!request) return interaction.update(buildRequestsListPayload(interaction.guild));
  return interaction.update(buildRequestManagePayload(request, interaction.guild));
}

async function handleRequestsButton(interaction) {
  const id = interaction.customId;

  if (id === 'automod_req_back') {
    return interaction.update(buildRequestsListPayload(interaction.guild));
  }

  if (id.startsWith('automod_req_delete:')) {
    const requestId = id.slice('automod_req_delete:'.length);
    const request   = getRequest(requestId);
    const label     = request ? `<@${request.userId}> \`${request.userTag}\`` : requestId;
    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('⚠️ Confirm Deletion')
      .setDescription(`Delete this pending request for ${label}?\nThey will **not** be notified — they'll just be free to submit a new link request.\n**This cannot be undone.**`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`automod_req_delyes:${requestId}`).setLabel('🗑️ Yes, Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`automod_req_delno:${requestId}`).setLabel('← Back').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (id.startsWith('automod_req_delyes:')) {
    const requestId = id.slice('automod_req_delyes:'.length);
    deleteRequest(requestId);
    return interaction.update(buildRequestsListPayload(interaction.guild));
  }

  if (id.startsWith('automod_req_delno:')) {
    const requestId = id.slice('automod_req_delno:'.length);
    const request   = getRequest(requestId);
    return interaction.update(request ? buildRequestManagePayload(request, interaction.guild) : buildRequestsListPayload(interaction.guild));
  }
}

// ── Native Discord AutoMod integration ──────────────────────────────────
// Everything else in this file is our own custom moderation (message
// events + bot-side deletes) — Discord only credits a bot as "using
// AutoMod" for rules created through its actual Auto Moderation API. This
// is a genuinely separate, additive protection (mass-mention/raid
// blocking, enforced instantly by Discord itself before the message even
// reaches our bot) rather than a reimplementation of the custom filters
// above, so turning it on/off never changes badWords/linkFilter behavior.
async function setMentionSpamRule(guild, enable) {
  const settings = getAutoModSettings(guild.id);

  if (!enable) {
    if (settings.mentionSpamRuleId) {
      try { await guild.autoModerationRules.delete(settings.mentionSpamRuleId, 'Disabled via /automod panel'); }
      catch { /* rule may already be gone — fine, we're clearing our record of it either way */ }
    }
    setAutoModSettings(guild.id, { mentionSpamProtection: false, mentionSpamRuleId: null });
    return { ok: true };
  }

  // Already have a live rule — just flip our own flag back on.
  if (settings.mentionSpamRuleId) {
    try {
      await guild.autoModerationRules.fetch(settings.mentionSpamRuleId);
      setAutoModSettings(guild.id, { mentionSpamProtection: true });
      return { ok: true };
    } catch { /* rule was deleted outside the bot (manually, etc.) — recreate/adopt below */ }
  }

  // Discord allows only one rule per trigger type per guild — if a
  // MentionSpam rule already exists (set up independently, e.g. via
  // Discord's own Safety Setup, or left over from before we tracked its
  // ID), creating a new one fails outright. Adopt the existing one instead
  // of erroring, and make sure it's actually enabled.
  try {
    const existingRules = await guild.autoModerationRules.fetch();
    const existing = existingRules.find(r => r.triggerType === AutoModerationRuleTriggerType.MentionSpam);
    if (existing) {
      if (!existing.enabled) {
        try { await existing.setEnabled(true, 'Enabled via /automod panel'); } catch { /* still adopt it even if we can't flip it on */ }
      }
      setAutoModSettings(guild.id, { mentionSpamProtection: true, mentionSpamRuleId: existing.id });
      return { ok: true };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const config   = readJson('config.json', {});
  const modRoles = config[guild.id]?.cmdSetup?.modRoles || [];

  try {
    const rule = await guild.autoModerationRules.create({
      name: 'YSER Flow — Mass-Mention Raid Protection',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 6, mentionRaidProtectionEnabled: true },
      actions: [{ type: AutoModerationActionType.BlockMessage }],
      enabled: true,
      exemptRoles: modRoles,
      reason: 'Enabled via /automod panel',
    });
    setAutoModSettings(guild.id, { mentionSpamProtection: true, mentionSpamRuleId: rule.id });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
