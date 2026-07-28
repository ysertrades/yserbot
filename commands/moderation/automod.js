'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { getAutoModSettings, setAutoModSettings, isAutoModExempt, getModLogChannel } = require('../../utils/modConfig');
const { findBadWord } = require('../../utils/badWords');
const { issueWarning } = require('../../utils/warnUtil');
const { postCustomLog, suppressDeleteLog } = require('../../utils/modLog');
const { createRequest, getRequest, updateRequest, LINK_REGEX } = require('../../utils/linkRequests');

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
    .addSubcommand(s => s.setName('wordlist').setDescription('View this server\'s custom-added filter words')),

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
  handleLinkDeny,
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

// ── Link filter action ──────────────────────────────────────────────────
async function handleLinkViolation(message, client) {
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
      `Your message in **${message.guild.name}** (<#${channelId}>) was removed — only moderators can post links there.\n\n` +
      'If you have a legitimate reason to share it, click below to request approval.',
    )
    .setFooter({ text: 'Your original message is saved with this request' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`automod_link_request:${request.id}`).setLabel('📨 Request Approval').setStyle(ButtonStyle.Primary),
  );

  const dmOk = await message.author.send({ embeds: [embed], components: [row] }).then(() => true).catch(() => false);
  if (!dmOk) {
    // DMs closed — fall back to a self-cleaning message in the channel itself.
    const fallback = await message.channel.send({ content: `${message.author}`, embeds: [embed], components: [row] }).catch(() => null);
    if (fallback) setTimeout(() => fallback.delete().catch(() => {}), 30_000);
  }
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

async function handleLinkApprove(interaction, requestId) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Only Administrators can approve link requests.', ephemeral: true });
  }
  const request = getRequest(requestId);
  if (!request) return interaction.reply({ content: '⌛ This request no longer exists.', ephemeral: true });
  if (request.status === 'approved' || request.status === 'denied') {
    return interaction.reply({ content: `This request was already **${request.status}**.`, ephemeral: true });
  }
  updateRequest(requestId, { status: 'approved' });

  const targetChannel = interaction.guild.channels.cache.get(request.channelId);
  if (targetChannel) {
    await targetChannel.send({ content: `🔗 **${request.userTag}** (link approved by ${interaction.user.tag}):\n${request.originalContent || request.link}` }).catch(() => {});
  }

  const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x2ECC71).setFooter({ text: `✅ Approved by ${interaction.user.tag}` });
  await interaction.update({ embeds: [updatedEmbed], components: [] });

  const user = await interaction.client.users.fetch(request.userId).catch(() => null);
  if (user) await user.send({ content: `✅ Your link request has been **approved** by ${interaction.user.tag} — it's been posted back in <#${request.channelId}>.` }).catch(() => {});
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

  const user = await interaction.client.users.fetch(request.userId).catch(() => null);
  if (user) await user.send({ content: `❌ Your link request was **denied** by ${interaction.user.tag}.` }).catch(() => {});
}
