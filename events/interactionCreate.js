'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { readJson }    = require('../utils/jsonStorage');

const embedUtil = { error: (title, desc) => createEmbed('error', { title, description: desc }) };
const EPHEMERAL_FLAG = 64;

function isUnknownInteractionError(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}

// ── Cmd permission helper ─────────────────────────────────────────────────────
const { MOD_COMMANDS, ADMIN_COMMANDS, PUBLIC_COMMANDS } = require('../commands/system/cmd');

function checkCmdPermission(interaction) {
  if (!interaction.inGuild()) return true;
  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (isAdmin) return true;

  const config     = readJson('config.json', {});
  const setup      = config[interaction.guild.id]?.cmdSetup || {};
  const cmd        = interaction.commandName;
  const modRoles   = setup.modRoles   || [];
  const adminRoles = setup.adminRoles || [];

  const hasMod   = modRoles.length   > 0 && modRoles.some(id   => interaction.member.roles.cache.has(id));
  const hasAdmin = adminRoles.length > 0 && adminRoles.some(id => interaction.member.roles.cache.has(id));

  if (MOD_COMMANDS.includes(cmd)) {
    if (modRoles.length === 0) return true; // no restriction configured
    return hasMod || hasAdmin;              // admin roles can also use mod commands
  }

  if (ADMIN_COMMANDS.includes(cmd)) {
    if (adminRoles.length === 0) return false; // admin commands always need a role or Discord admin perm
    return hasAdmin;
  }

  // Public / unclassified — mod-only users are locked to PUBLIC_COMMANDS
  if (hasMod && !hasAdmin) return PUBLIC_COMMANDS.includes(cmd);

  return true;
}

// ── Giveaway participants helpers ─────────────────────────────────────────────
const PAGE_SIZE = 10;

function buildParticipantsEmbed(giveawayMsgId, page) {
  const entrants   = global.giveawayEntrants?.get(giveawayMsgId) || new Set();
  const members    = Array.from(entrants).map(id => `<@${id}>`);
  const total      = members.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage   = Math.max(1, Math.min(page, totalPages));
  const slice      = members.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('🏅 Giveaway Participants')
    .setDescription(total === 0 ? 'No participants yet.' : slice.map((m, i) => `**${(safePage - 1) * PAGE_SIZE + i + 1}.** ${m}`).join('\n'))
    .setFooter({ text: `Page ${safePage}/${totalPages} • ${total} participant${total !== 1 ? 's' : ''}` });

  return { embed, totalPages, currentPage: safePage };
}

function buildParticipantsRow(giveawayMsgId, currentPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gaw_p:${giveawayMsgId}:${currentPage}`)
      .setLabel('◄ Prev').setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`gaw_n:${giveawayMsgId}:${currentPage}`)
      .setLabel('Next ►').setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages),
  );
}

// ── Report action helpers ─────────────────────────────────────────────────────

async function handleReportAction(interaction, targetUserId, reportChannelId) {
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rpt_w:${targetUserId}:${reportChannelId}:${interaction.message.id}`).setLabel('⚠️ Warn').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rpt_k:${targetUserId}:${reportChannelId}:${interaction.message.id}`).setLabel('👢 Kick').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`rpt_b:${targetUserId}:${reportChannelId}:${interaction.message.id}`).setLabel('🔨 Ban').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`rpt_dismiss:${reportChannelId}:${interaction.message.id}`).setLabel('✅ Dismiss').setStyle(ButtonStyle.Secondary),
  );

  try {
    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0xf39c12)
      .setFooter({ text: `🔍 Being reviewed by ${interaction.user.tag}` });
    const disabledAction = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
    );
    await interaction.message.edit({ embeds: [updatedEmbed], components: [disabledAction] });
  } catch {}

  return interaction.reply({
    embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('⚡ Take Action').setDescription(`Choose a moderation action against <@${targetUserId}>:`)],
    components: [actionRow],
    flags: EPHEMERAL_FLAG,
  });
}

async function executeReportAction(interaction, action, targetUserId, reportChannelId, reportMsgId) {
  const { sendModLog, dmUser } = require('../utils/modLog');
  const { readJson: rj, writeJson: wj } = require('../utils/jsonStorage');

  let label = '';
  try {
    const targetUser = await interaction.client.users.fetch(targetUserId);
    const member     = interaction.guild.members.cache.get(targetUserId);
    const reason     = `Report action by ${interaction.user.tag}`;
    const cases      = rj('cases.json', {});
    const gCases     = cases[interaction.guild.id] || [];
    const caseId     = gCases.length + 1;

    if (action === 'warn') {
      gCases.push({ id: caseId, type: 'warn', userId: targetUserId, userTag: targetUser.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, timestamp: Date.now() });
      cases[interaction.guild.id] = gCases; wj('cases.json', cases);
      await dmUser(targetUser, 'warn', interaction.guild, reason, { caseId });
      await sendModLog(interaction.guild, 'warn', targetUser, interaction.user, reason, { caseId });
      label = 'warned';
    } else if (action === 'kick' && member) {
      gCases.push({ id: caseId, type: 'kick', userId: targetUserId, userTag: targetUser.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, timestamp: Date.now() });
      cases[interaction.guild.id] = gCases; wj('cases.json', cases);
      await dmUser(targetUser, 'kick', interaction.guild, reason, { caseId });
      await member.kick(reason);
      await sendModLog(interaction.guild, 'kick', targetUser, interaction.user, reason, { caseId });
      label = 'kicked';
    } else if (action === 'ban') {
      gCases.push({ id: caseId, type: 'ban', userId: targetUserId, userTag: targetUser.tag, moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, timestamp: Date.now() });
      cases[interaction.guild.id] = gCases; wj('cases.json', cases);
      await dmUser(targetUser, 'ban', interaction.guild, reason, {});
      await interaction.guild.members.ban(targetUserId, { reason });
      await sendModLog(interaction.guild, 'ban', targetUser, interaction.user, reason, { caseId });
      label = 'banned';
    }

    try {
      const reportCh  = interaction.guild.channels.cache.get(reportChannelId);
      if (reportCh) {
        const reportMsg = await reportCh.messages.fetch(reportMsgId);
        const updEmbed  = EmbedBuilder.from(reportMsg.embeds[0])
          .setColor(action === 'dismiss' ? 0x95a5a6 : 0x2ecc71)
          .setFooter({ text: `✅ Handled by ${interaction.user.tag} — ${action === 'dismiss' ? 'Dismissed' : label.charAt(0).toUpperCase() + label.slice(1)}` });
        await reportMsg.edit({ embeds: [updEmbed], components: [] });
      }
    } catch {}

    return interaction.update({
      embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Action Taken').setDescription(action === 'dismiss' ? 'Report dismissed.' : `<@${targetUserId}> has been **${label}**.`)],
      components: [],
    });
  } catch (err) {
    console.error('[REPORT ACTION]', err);
    return interaction.reply({ content: '❌ Failed to execute action.', flags: EPHEMERAL_FLAG });
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {

    // ── Autocomplete ──────────────────────────────────────────────────────────
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try { await command.autocomplete(interaction); } catch (err) { console.error(`[AC ERROR] ${interaction.commandName}:`, err); }
      }
      return;
    }

    // ── Slash Commands ────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      if (interaction.inGuild() && !checkCmdPermission(interaction)) {
        return interaction.reply({ embeds: [embedUtil.error('No Permission', `You don't have permission to use \`/${interaction.commandName}\`.`)], flags: EPHEMERAL_FLAG }).catch(() => {});
      }

      try {
        await command.execute(interaction, client);
      } catch (err) {
        if (isUnknownInteractionError(err)) return;
        console.error(`[CMD ERROR] /${interaction.commandName}:`, err);
        const reply = { embeds: [embedUtil.error('Error', 'An unexpected error occurred.')], flags: EPHEMERAL_FLAG };
        if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
        else await interaction.reply(reply).catch(() => {});
      }
      return;
    }

    // ── Button Interactions ───────────────────────────────────────────────────
    if (interaction.isButton()) {
      const id = interaction.customId;
      try {

        // Giveaway — setup panel buttons
        if (id.startsWith('gaw_setup:')) {
          return client.commands.get('giveaway')?.handleSetupButton(interaction);
        }

        // Giveaway — enter
        if (id === 'giveaway_enter') {
          if (!global.giveawayEntrants) global.giveawayEntrants = new Map();
          const entrants = global.giveawayEntrants.get(interaction.message.id);
          if (!entrants) return interaction.reply({ content: 'This giveaway has ended.', flags: EPHEMERAL_FLAG });
          if (entrants.has(interaction.user.id)) return interaction.reply({ content: "You've already entered!", flags: EPHEMERAL_FLAG });
          entrants.add(interaction.user.id);
          try {
            const upd  = EmbedBuilder.from(interaction.message.embeds[0]);
            const desc = (upd.data.description || '').replace(/📊 \*\*Entries:\*\* \d+ participants?/, `📊 **Entries:** ${entrants.size} participant${entrants.size !== 1 ? 's' : ''}`);
            upd.setDescription(desc);
            await interaction.message.edit({ embeds: [upd] }).catch(() => {});
          } catch {}
          return interaction.reply({ content: '🎟️ You\'ve entered the giveaway! Good luck!', flags: EPHEMERAL_FLAG });
        }

        // Giveaway — participants (first page)
        if (id === 'giveaway_participants') {
          const giveawayMsgId = interaction.message.id;
          const { embed, totalPages, currentPage } = buildParticipantsEmbed(giveawayMsgId, 1);
          const row = buildParticipantsRow(giveawayMsgId, currentPage, totalPages);
          return interaction.reply({ embeds: [embed], components: [row], flags: EPHEMERAL_FLAG });
        }

        // Giveaway — prev/next page (updates in-place, no new message)
        if (id.startsWith('gaw_p:') || id.startsWith('gaw_n:')) {
          const [, giveawayMsgId, pageStr] = id.split(':');
          const currentPage = parseInt(pageStr);
          const newPage     = id.startsWith('gaw_p:') ? currentPage - 1 : currentPage + 1;
          const { embed, totalPages, currentPage: safePage } = buildParticipantsEmbed(giveawayMsgId, newPage);
          const row = buildParticipantsRow(giveawayMsgId, safePage, totalPages);
          return interaction.update({ embeds: [embed], components: [row] });
        }

        // Ticket buttons
        if (id === 'create_ticket' || id === 'close_ticket' || id === 'ticket_still_here') {
          return client.commands.get('ticket')?.handleButton(interaction, [], client);
        }

        // Poll
        if (id.startsWith('poll_vote_')) {
          return client.commands.get('poll')?.handleButton(interaction, [], client);
        }

        // Embed editor + delete-selector buttons
        if (id.startsWith('embed_edit_') || id.startsWith('embed_del')) {
          return client.commands.get('embed')?.handleEmbedButton(interaction);
        }

        // Button editor + delete-selector buttons (be_* / btn_del*)
        if ((id.startsWith('be_') && !id.startsWith('be_modal_')) || id.startsWith('btn_del')) {
          return client.commands.get('button')?.handleButtonEdit(interaction);
        }

        // Schedule cancel-selector buttons
        if (id.startsWith('sch_del')) {
          return client.commands.get('schedule')?.handleScheduleButton(interaction);
        }

        // Report — take action
        if (id.startsWith('rpt_action:')) {
          const [, targetUserId, reportChannelId] = id.split(':');
          return handleReportAction(interaction, targetUserId, reportChannelId);
        }

        // Report — execute action
        if (id.startsWith('rpt_w:') || id.startsWith('rpt_k:') || id.startsWith('rpt_b:') || id.startsWith('rpt_dismiss:')) {
          const parts = id.split(':');
          if (id.startsWith('rpt_dismiss:')) {
            const [, reportChannelId, reportMsgId] = parts;
            return executeReportAction(interaction, 'dismiss', null, reportChannelId, reportMsgId);
          }
          const [, targetUserId, reportChannelId, reportMsgId] = parts;
          const action = id.startsWith('rpt_w:') ? 'warn' : id.startsWith('rpt_k:') ? 'kick' : 'ban';
          return executeReportAction(interaction, action, targetUserId, reportChannelId, reportMsgId);
        }

        // Card grab
        if (id === 'card_grab') {
          if (!global.cardDrops) global.cardDrops = new Map();
          const drop = global.cardDrops.get(interaction.message.id);
          if (!drop || drop.grabbed) {
            return interaction.reply({ content: '💨 Too late! Someone already grabbed this card.', flags: EPHEMERAL_FLAG });
          }
          drop.grabbed = true;
          global.cardDrops.delete(interaction.message.id);
          const { writeJson } = require('../utils/jsonStorage');
          const { buildClaimedEmbed } = require('../utils/cardsManager');
          const allCards = readJson('cards.json', {});
          if (!allCards[interaction.user.id]) allCards[interaction.user.id] = [];
          allCards[interaction.user.id].push({ ...drop.card, collectedAt: Date.now() });
          writeJson('cards.json', allCards);
          const claimedEmbed = buildClaimedEmbed(drop.card, interaction.user);
          const disabled = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('card_claimed')
              .setLabel(`🎉 ${interaction.user.username} grabbed it!`)
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
          );
          return interaction.update({ embeds: [claimedEmbed], components: [disabled] });
        }

        // Restore — confirm
        if (id.startsWith('restore_confirm:')) {
          const [, guildId, userId] = id.split(':');
          if (interaction.user.id !== userId || interaction.guild.id !== guildId) {
            return interaction.reply({ content: '❌ Only the admin who initiated this restore can confirm it.', flags: EPHEMERAL_FLAG });
          }
          return client.commands.get('restore')?.handleRestoreConfirm(interaction);
        }

        // Restore — cancel
        if (id.startsWith('restore_cancel:')) {
          const [, guildId, userId] = id.split(':');
          if (interaction.user.id !== userId || interaction.guild.id !== guildId) {
            return interaction.reply({ content: '❌ Only the admin who initiated this restore can cancel it.', flags: EPHEMERAL_FLAG });
          }
          return client.commands.get('restore')?.handleRestoreCancel(interaction);
        }

        // Casino — skip (handled by casinoInteraction.js)
        if (id.startsWith('cs:')) return;

        // Stored buttons (role / custom)
        const buttons   = readJson('buttons.json', {});
        const btnConfig = (buttons[interaction.guildId] || {})[id];
        if (btnConfig) {
          if (btnConfig.type === 'role' && btnConfig.roleId) {
            const role   = interaction.guild.roles.cache.get(btnConfig.roleId);
            if (!role) return interaction.reply({ content: '❌ Role not found.', flags: EPHEMERAL_FLAG });
            const member = interaction.member;
            if (member.roles.cache.has(btnConfig.roleId)) {
              await member.roles.remove(role);
              return interaction.reply({ content: `✅ Removed **${role.name}**.`, flags: EPHEMERAL_FLAG });
            } else {
              await member.roles.add(role);
              return interaction.reply({ content: `✅ You now have **${role.name}**.`, flags: EPHEMERAL_FLAG });
            }
          } else if (btnConfig.type === 'custom') {
            return interaction.reply({ content: btnConfig.message || '✅', flags: EPHEMERAL_FLAG });
          } else if (btnConfig.type === 'embed') {
            const { buildEmbedPayload } = require('../commands/utility/embed');
            const payload = buildEmbedPayload(interaction.guild, btnConfig.responseEmbedName || btnConfig.embedName);
            if (!payload) return interaction.reply({ content: '❌ Embed template not found.', flags: EPHEMERAL_FLAG });
            return interaction.reply({ embeds: payload.embeds, components: payload.components.length ? payload.components : undefined, flags: EPHEMERAL_FLAG });
          }
          return;
        }

      } catch (err) {
        console.error(`[BTN ERROR] ${id}:`, err);
        const rep = { embeds: [embedUtil.error('Error', 'An unexpected error occurred.')], flags: EPHEMERAL_FLAG };
        if (interaction.replied || interaction.deferred) await interaction.followUp(rep).catch(() => {});
        else await interaction.reply(rep).catch(() => {});
      }
    }

    // ── Modal Submissions ─────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      const id = interaction.customId;
      if (id.startsWith('cs:')) return; // casino handler

      try {
        // Giveaway setup modals
        if (id.startsWith('gaw_modal:')) {
          return client.commands.get('giveaway')?.handleSetupModal(interaction);
        }

        // Embed editor modals
        if (id.startsWith('embed_modal_')) {
          return client.commands.get('embed')?.handleEmbedModal(interaction);
        }

        // Button editor modals
        if (id.startsWith('be_modal_')) {
          return client.commands.get('button')?.handleButtonEditModal(interaction);
        }
      } catch (err) {
        console.error(`[MODAL ERROR] ${id}:`, err);
        const rep = { embeds: [embedUtil.error('Error', 'An unexpected error occurred.')], flags: EPHEMERAL_FLAG };
        if (interaction.replied || interaction.deferred) await interaction.followUp(rep).catch(() => {});
        else await interaction.reply(rep).catch(() => {});
      }
    }

    // ── Select Menus ──────────────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      try {
        // Delete / cancel selectors
        if (id === 'embed_delselect')
          return client.commands.get('embed')?.handleEmbedSelect(interaction);
        if (id === 'btn_delselect')
          return client.commands.get('button')?.handleButtonSelect(interaction);
        if (id === 'sch_delselect')
          return client.commands.get('schedule')?.handleScheduleSelect(interaction);

        // Generic fallback (existing sel_* pattern)
        const [system, ...args] = id.split(':');
        const handler = client.commands.get(`sel_${system}`);
        if (handler?.handleSelect) await handler.handleSelect(interaction, args, client);
      } catch (err) {
        console.error(`[SEL ERROR] ${id}:`, err);
        const rep = { embeds: [embedUtil.error('Error', 'An unexpected error occurred.')], flags: EPHEMERAL_FLAG };
        if (interaction.replied || interaction.deferred) await interaction.followUp(rep).catch(() => {});
        else await interaction.reply(rep).catch(() => {});
      }
    }
  },
};
