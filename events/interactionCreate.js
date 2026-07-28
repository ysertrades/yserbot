'use strict';

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { createEmbed } = require('../utils/embedBuilder');
const { readJson, writeJson } = require('../utils/jsonStorage');

const embedUtil = { error: (title, desc) => createEmbed('error', { title, description: desc }) };
const EPHEMERAL_FLAG = 64;

// Per-user, per-button cooldown tracking for stored buttons. In-memory by
// design (mirrors how lightweight cooldowns are handled elsewhere in the
// bot) — cooldowns reset on restart, which is an acceptable trade-off.
const buttonCooldowns = new Map();

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
        try { await command.autocomplete(interaction); } catch (err) {
          if (err.code === 10062) return; // interaction expired before we could respond — normal on restarts/load
          console.error(`[AC ERROR] ${interaction.commandName}:`, err);
        }
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

        // Giveaway — list view: delete-ended-giveaway confirm/back
        if (id.startsWith('gaw_list_delyes:') || id === 'gaw_list_delno') {
          return client.commands.get('giveaway')?.handleListButton(interaction);
        }

        // Giveaway — enter
        if (id === 'giveaway_enter') {
          if (!global.giveawayEntrants) global.giveawayEntrants = new Map();
          let entrants = global.giveawayEntrants.get(interaction.message.id);

          // Not in memory — bot may have restarted during a long giveaway.
          // Check persisted active-giveaway state before declaring it ended.
          if (!entrants) {
            const giveawayCmd = client.commands.get('giveaway');
            const saved = giveawayCmd?.getActiveGiveaway?.(interaction.message.id);
            if (saved && saved.endTime > Date.now()) {
              if (!global.giveawayMeta) global.giveawayMeta = new Map();
              entrants = new Set(saved.entrants || []);
              global.giveawayEntrants.set(interaction.message.id, entrants);
              global.giveawayMeta.set(interaction.message.id, {
                prize: saved.prize, winners: saved.winnersCount, imageUrl: saved.imageUrl,
                hostId: saved.hostId, endTime: saved.endTime, guildId: saved.guildId,
                requiredRoleId: saved.requiredRoleId || null, bonusRoleId: saved.bonusRoleId || null,
                minAccountAgeDays: saved.minAccountAgeDays || 0,
              });
            }
          }

          if (!entrants) return interaction.reply({ content: 'This giveaway has ended.', flags: EPHEMERAL_FLAG });
          if (entrants.has(interaction.user.id)) return interaction.reply({ content: "You've already entered!", flags: EPHEMERAL_FLAG });

          const gawMeta = global.giveawayMeta?.get(interaction.message.id);
          if (gawMeta?.requiredRoleId && !interaction.member.roles.cache.has(gawMeta.requiredRoleId)) {
            return interaction.reply({ content: `❌ You need the <@&${gawMeta.requiredRoleId}> role to enter this giveaway.`, flags: EPHEMERAL_FLAG });
          }
          if (gawMeta?.minAccountAgeDays > 0) {
            const ageDays = (Date.now() - interaction.user.createdTimestamp) / 86400000;
            if (ageDays < gawMeta.minAccountAgeDays) {
              return interaction.reply({ content: `❌ Your account must be at least **${gawMeta.minAccountAgeDays} days** old to enter this giveaway.`, flags: EPHEMERAL_FLAG });
            }
          }

          entrants.add(interaction.user.id);
          try {
            const upd  = EmbedBuilder.from(interaction.message.embeds[0]);
            const desc = (upd.data.description || '').replace(/📊 \*\*Entries:\*\* \d+ participants?/, `📊 **Entries:** ${entrants.size} participant${entrants.size !== 1 ? 's' : ''}`);
            upd.setDescription(desc);
            await interaction.message.edit({ embeds: [upd] }).catch(() => {});
          } catch {}
          // Persist the new entry so it survives future restarts
          client.commands.get('giveaway')?.persistGiveawayEntry?.(interaction.message.id, entrants);
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

        // Verification — memory-sequence challenge
        if (id === 'verify_start') {
          return client.commands.get('verify')?.handleStart(interaction);
        }
        if (id.startsWith('verify_ready:')) {
          return client.commands.get('verify')?.handleReady(interaction, id.slice('verify_ready:'.length));
        }
        if (id.startsWith('verify_pick:')) {
          const [, sessionId, idxStr] = id.split(':');
          return client.commands.get('verify')?.handlePick(interaction, sessionId, parseInt(idxStr, 10));
        }
        if (id.startsWith('verify_cancel:')) {
          return client.commands.get('verify')?.handleCancel(interaction, id.slice('verify_cancel:'.length));
        }

        // Poll
        if (id.startsWith('poll_vote_')) {
          return client.commands.get('poll')?.handleButton(interaction, [], client);
        }

        // Embed editor + delete-selector + list-pager + preview-send buttons
        if (id.startsWith('embed_edit_') || id.startsWith('embed_del') || id.startsWith('embed_list:') || id.startsWith('embed_previewsend:')) {
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

        // Auto-mod — panel toggles
        if (id.startsWith('automod_toggle:')) {
          return client.commands.get('automod')?.handleToggle(interaction, id.slice('automod_toggle:'.length));
        }
        if (id.startsWith('modlog_toggle:')) {
          return client.commands.get('modlog')?.handleToggle(interaction, id.slice('modlog_toggle:'.length));
        }

        // Auto-mod — link request flow
        if (id.startsWith('automod_link_request:')) {
          return client.commands.get('automod')?.handleLinkRequestButton(interaction, id.slice('automod_link_request:'.length));
        }
        if (id.startsWith('automod_link_approve:')) {
          return client.commands.get('automod')?.handleLinkApprove(interaction, id.slice('automod_link_approve:'.length));
        }
        if (id.startsWith('automod_link_deny:')) {
          return client.commands.get('automod')?.handleLinkDeny(interaction, id.slice('automod_link_deny:'.length));
        }

        // Auto-mod — cooldowns list (manage/adjust/delete)
        if (id === 'automod_cd_back' || id.startsWith('automod_cd_delete:') || id.startsWith('automod_cd_delyes:')
          || id.startsWith('automod_cd_delno:') || id.startsWith('automod_cd_adjust:')) {
          return client.commands.get('automod')?.handleCooldownButton(interaction);
        }

        // Auto-mod — requests list (manage/delete) — approve/deny reuse the
        // automod_link_approve:/automod_link_deny: routes above
        if (id === 'automod_req_back' || id.startsWith('automod_req_delete:') || id.startsWith('automod_req_delyes:')
          || id.startsWith('automod_req_delno:')) {
          return client.commands.get('automod')?.handleRequestsButton(interaction);
        }

        // Casino — skip (handled by casinoInteraction.js)
        if (id.startsWith('cs:')) return;

        // Stored buttons (role / custom / embed / random)
        const buttons   = readJson('buttons.json', {});
        const btnConfig = (buttons[interaction.guildId] || {})[id];
        if (btnConfig) {
          // Per-user cooldown — checked up front, but only *consumed* below
          // once we know the click actually did something. A denied click
          // (missing prerequisite role, misconfigured button, etc.) must not
          // burn the user's cooldown window for a benefit they never got.
          const cdKey = `${interaction.guildId}:${id}:${interaction.user.id}`;
          if (btnConfig.cooldown) {
            const last   = buttonCooldowns.get(cdKey) || 0;
            const remain = (last + btnConfig.cooldown * 1000) - Date.now();
            if (remain > 0) {
              return interaction.reply({ content: `⏳ Please wait **${Math.ceil(remain / 1000)}s** before using this button again.`, flags: EPHEMERAL_FLAG });
            }
          }

          let success = false; // only true for a genuine, effective action

          if (btnConfig.type === 'role' && btnConfig.roleId) {
            const role = interaction.guild.roles.cache.get(btnConfig.roleId);
            if (!role) {
              await interaction.reply({ content: '❌ Role not found (it may have been deleted).', flags: EPHEMERAL_FLAG });
            } else {
              const member = interaction.member;
              if (btnConfig.requiredRoleId && !member.roles.cache.has(btnConfig.requiredRoleId)) {
                const reqRole = interaction.guild.roles.cache.get(btnConfig.requiredRoleId);
                await interaction.reply({ content: `❌ You need the **${reqRole?.name || 'required'}** role first.`, flags: EPHEMERAL_FLAG });
              } else {
                const has  = member.roles.cache.has(btnConfig.roleId);
                const mode = btnConfig.mode || 'toggle';
                if (mode === 'give') {
                  if (has) { await interaction.reply({ content: `ℹ️ You already have **${role.name}**.`, flags: EPHEMERAL_FLAG }); }
                  else { await member.roles.add(role); await interaction.reply({ content: `✅ You now have **${role.name}**.`, flags: EPHEMERAL_FLAG }); success = true; }
                } else if (mode === 'remove') {
                  if (!has) { await interaction.reply({ content: `ℹ️ You don't have **${role.name}**.`, flags: EPHEMERAL_FLAG }); }
                  else { await member.roles.remove(role); await interaction.reply({ content: `✅ Removed **${role.name}**.`, flags: EPHEMERAL_FLAG }); success = true; }
                } else if (has) {
                  await member.roles.remove(role);
                  await interaction.reply({ content: `✅ Removed **${role.name}**.`, flags: EPHEMERAL_FLAG });
                  success = true;
                } else {
                  await member.roles.add(role);
                  await interaction.reply({ content: `✅ You now have **${role.name}**.`, flags: EPHEMERAL_FLAG });
                  success = true;
                }
              }
            }
          } else if (btnConfig.type === 'custom') {
            await interaction.reply({ content: btnConfig.message || '✅', flags: EPHEMERAL_FLAG });
            success = true;
          } else if (btnConfig.type === 'embed') {
            const { buildEmbedPayload } = require('../commands/utility/embed');
            const payload = buildEmbedPayload(interaction.guild, btnConfig.responseEmbedName || btnConfig.embedName, { user: interaction.user, channel: interaction.channel });
            if (!payload) { await interaction.reply({ content: '❌ Embed template not found.', flags: EPHEMERAL_FLAG }); }
            else { await interaction.reply({ embeds: payload.embeds, components: payload.components.length ? payload.components : undefined, flags: EPHEMERAL_FLAG }); success = true; }
          } else if (btnConfig.type === 'random') {
            const list = (btnConfig.responses || '').split('|').map(s => s.trim()).filter(Boolean);
            if (list.length === 0) { await interaction.reply({ content: '❌ This button has no responses configured.', flags: EPHEMERAL_FLAG }); }
            else { await interaction.reply({ content: list[Math.floor(Math.random() * list.length)], flags: EPHEMERAL_FLAG }); success = true; }
          } else {
            // Misconfigured (e.g. role type missing its role) — always acknowledge
            // rather than leaving the interaction to time out looking "failed".
            await interaction.reply({ content: '❌ This button is misconfigured. Ask an admin to check `/button edit`.', flags: EPHEMERAL_FLAG });
          }

          if (success) {
            if (btnConfig.cooldown) buttonCooldowns.set(cdKey, Date.now());
            btnConfig.uses = (btnConfig.uses || 0) + 1;
            writeJson('buttons.json', buttons);
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

        // Verification — rules text modal
        if (id === 'verify_rules_modal') {
          return client.commands.get('verify')?.handleRulesModal(interaction);
        }

        // Auto-mod — link request modal (link + reason)
        if (id.startsWith('automod_link_modal:')) {
          return client.commands.get('automod')?.handleLinkModalSubmit(interaction, id.slice('automod_link_modal:'.length));
        }

        // Auto-mod — approval cooldown modal
        if (id.startsWith('automod_link_approve_modal:')) {
          return client.commands.get('automod')?.handleLinkApproveModalSubmit(interaction, id.slice('automod_link_approve_modal:'.length));
        }

        // Auto-mod — cooldowns list: adjust modal
        if (id.startsWith('automod_cd_adjust_modal:')) {
          return client.commands.get('automod')?.handleCooldownAdjustModalSubmit(interaction, id.slice('automod_cd_adjust_modal:'.length));
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
        // Delete / cancel selectors (+ embed field-removal selector)
        if (id === 'embed_delselect' || id.startsWith('embed_fieldsel_'))
          return client.commands.get('embed')?.handleEmbedSelect(interaction);
        if (id === 'btn_delselect')
          return client.commands.get('button')?.handleButtonSelect(interaction);
        if (id === 'sch_delselect')
          return client.commands.get('schedule')?.handleScheduleSelect(interaction);
        if (id === 'gaw_list_delsel')
          return client.commands.get('giveaway')?.handleListSelect(interaction);
        if (id === 'automod_cd_select')
          return client.commands.get('automod')?.handleCooldownSelect(interaction);
        if (id === 'automod_req_select')
          return client.commands.get('automod')?.handleRequestsSelect(interaction);
        if (id === 'newsfeed_topics_select')
          return client.commands.get('newsfeed')?.handleTopicsSelect(interaction);

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

    // ── Role / Channel Select Menus (native pickers — e.g. giveaway setup) ──────
    if (interaction.isRoleSelectMenu()) {
      const id = interaction.customId;
      try {
        if (id.startsWith('gaw_role_select:'))
          return client.commands.get('giveaway')?.handleRoleSelect(interaction);
      } catch (err) {
        console.error(`[ROLE SELECT ERROR] ${id}:`, err);
        const rep = { embeds: [embedUtil.error('Error', 'An unexpected error occurred.')], flags: EPHEMERAL_FLAG };
        if (interaction.replied || interaction.deferred) await interaction.followUp(rep).catch(() => {});
        else await interaction.reply(rep).catch(() => {});
      }
    }

    if (interaction.isChannelSelectMenu()) {
      const id = interaction.customId;
      try {
        if (id.startsWith('gaw_channel_select:'))
          return client.commands.get('giveaway')?.handleChannelSelect(interaction);
      } catch (err) {
        console.error(`[CHANNEL SELECT ERROR] ${id}:`, err);
        const rep = { embeds: [embedUtil.error('Error', 'An unexpected error occurred.')], flags: EPHEMERAL_FLAG };
        if (interaction.replied || interaction.deferred) await interaction.followUp(rep).catch(() => {});
        else await interaction.reply(rep).catch(() => {});
      }
    }
  },
};
