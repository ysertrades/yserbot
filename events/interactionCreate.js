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

// Why every dispatch below reads `return await handler(...)` rather than
// `return handler(...)`:
//
// The handlers are async, so a bare `return` hands back a promise and the try
// block exits before it settles. The catch underneath never runs — the
// rejection sails past it to the caller, which is a bare
// `event.execute(...)` in index.js with nothing attached. The result was that
// every button, modal and select handler in this file had an error path that
// could not fire: the user saw Discord's own "This interaction failed" and the
// log got one line from the process-wide unhandledRejection hook, with no
// indication of which button it was.

// ── Cmd permission helper ─────────────────────────────────────────────────────
const { MOD_COMMANDS, ADMIN_COMMANDS, PUBLIC_COMMANDS } = require('../commands/system/cmd');
const { reattachEmbedImage, reattachBuilt } = require('../utils/embedAttachments');
const { memberAction, actionCard } = require('../utils/modEmbed');

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

// ── Coins giveaway participants helpers (mirrors the block above) ────────────

function buildCoinsParticipantsEmbed(giveawayMsgId, page) {
  const entrants   = global.coinsGiveawayEntrants?.get(giveawayMsgId) || new Set();
  const members    = Array.from(entrants).map(id => `<@${id}>`);
  const total      = members.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage   = Math.max(1, Math.min(page, totalPages));
  const slice      = members.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const embed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle('🏅 Coins Giveaway Participants')
    .setDescription(total === 0 ? 'No participants yet.' : slice.map((m, i) => `**${(safePage - 1) * PAGE_SIZE + i + 1}.** ${m}`).join('\n'))
    .setFooter({ text: `Page ${safePage}/${totalPages} • ${total} participant${total !== 1 ? 's' : ''}` });

  return { embed, totalPages, currentPage: safePage };
}

function buildCoinsParticipantsRow(giveawayMsgId, currentPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cg_p:${giveawayMsgId}:${currentPage}`)
      .setLabel('◄ Prev').setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`cg_n:${giveawayMsgId}:${currentPage}`)
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
  const modActions = require('../utils/modActions');
  const reports    = require('../utils/reports');

  try {
    const record = reports.findByMessage(interaction.guild.id, reportMsgId);

    if (action === 'dismiss') {
      if (record) reports.update(record.id, { status: 'dismissed', handledBy: interaction.user.tag, handledAt: Date.now(), action: 'dismiss' });
      await markReportCard(interaction.guild, reportChannelId, reportMsgId, `✅ Dismissed by ${interaction.user.tag}`, 0x95a5a6);
      return interaction.update({
        embeds: [actionCard({ title: 'Report dismissed', iconURL: interaction.user.displayAvatarURL({ size: 64 }), color: 0x95a5a6 })],
        components: [],
      });
    }

    const targetUser = await interaction.client.users.fetch(targetUserId);
    const member     = interaction.guild.members.cache.get(targetUserId);

    // The case, the DM and the mod-log line all live in utils/modActions, so
    // this does exactly what /warn and the panel do.
    const result = await modActions.apply({
      guild: interaction.guild,
      moderator: { id: interaction.user.id, tag: interaction.user.tag },
      targetUser, member, action,
      reason: `Report action by ${interaction.user.tag}`,
    });

    if (!result.ok) {
      return interaction.update({
        embeds: [actionCard({
          title: 'Could not finish that',
          iconURL: interaction.guild.iconURL({ size: 64 }),
          note: result.error === 'not_in_server'
            ? 'That member is not in the server any more.'
            : `Discord refused it: ${result.detail || result.error}`,
          color: 0xe74c3c,
        })],
        components: [],
      });
    }

    if (record) reports.update(record.id, { status: 'actioned', handledBy: interaction.user.tag, handledAt: Date.now(), action });
    await markReportCard(interaction.guild, reportChannelId, reportMsgId,
      `✅ Handled by ${interaction.user.tag} — ${result.label}`, 0x2ecc71);

    return interaction.update({
      embeds: [memberAction({ user: targetUser, member, action, reason: 'reported' })],
      components: [],
    });
  } catch (err) {
    console.error('[REPORT ACTION]', err);
    return interaction.reply({ content: '❌ Failed to execute action.', flags: EPHEMERAL_FLAG });
  }
}

/** Strikes the original report card so the channel shows it as dealt with. */
async function markReportCard(guild, channelId, messageId, footer, colour) {
  try {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(messageId);
    const updated = EmbedBuilder.from(message.embeds[0]).setColor(colour).setFooter({ text: footer });
    await message.edit({ embeds: [updated], components: [] });
  } catch { /* the card may have been deleted; the action itself still stands */ }
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
          return await client.commands.get('giveaway')?.handleSetupButton(interaction);
        }

        // Giveaway — list view: delete-ended-giveaway confirm/back
        if (id.startsWith('gaw_list_delyes:') || id === 'gaw_list_delno') {
          return await client.commands.get('giveaway')?.handleListButton(interaction);
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
            return await interaction.reply({ content: `❌ You need the <@&${gawMeta.requiredRoleId}> role to enter this giveaway.`, flags: EPHEMERAL_FLAG });
          }
          if (gawMeta?.minAccountAgeDays > 0) {
            const ageDays = (Date.now() - interaction.user.createdTimestamp) / 86400000;
            if (ageDays < gawMeta.minAccountAgeDays) {
              return await interaction.reply({ content: `❌ Your account must be at least **${gawMeta.minAccountAgeDays} days** old to enter this giveaway.`, flags: EPHEMERAL_FLAG });
            }
          }

          entrants.add(interaction.user.id);
          try {
            const upd  = EmbedBuilder.from(interaction.message.embeds[0]);
            const desc = (upd.data.description || '').replace(/📊 \*\*Entries:\*\* \d+ participants?/, `📊 **Entries:** ${entrants.size} participant${entrants.size !== 1 ? 's' : ''}`);
            upd.setDescription(desc);
            // The banner is re-uploaded rather than re-linked. A signed CDN URL
            // copied out of the live embed is not something Discord can match
            // back to the attachment, so it drew the picture twice — once
            // inside the embed and once above it. See utils/embedAttachments.
            const stored = global.giveawayMeta?.get(interaction.message.id)
              ?? client.commands.get('giveaway')?.getActiveGiveaway?.(interaction.message.id);
            const imageOpts = reattachEmbedImage(upd, stored?.imageUrl ?? null, interaction.guild?.id);
            await interaction.message.edit({ embeds: [upd], ...imageOpts }).catch(() => {});
          } catch {}
          // Persist the new entry so it survives future restarts
          client.commands.get('giveaway')?.persistGiveawayEntry?.(interaction.message.id, entrants);
          return await interaction.reply({ content: '🎟️ You\'ve entered the giveaway! Good luck!', flags: EPHEMERAL_FLAG });
        }

        // Giveaway — participants (first page)
        if (id === 'giveaway_participants') {
          const giveawayMsgId = interaction.message.id;
          const { embed, totalPages, currentPage } = buildParticipantsEmbed(giveawayMsgId, 1);
          const row = buildParticipantsRow(giveawayMsgId, currentPage, totalPages);
          return await interaction.reply({ embeds: [embed], components: [row], flags: EPHEMERAL_FLAG });
        }

        // Giveaway — prev/next page (updates in-place, no new message)
        if (id.startsWith('gaw_p:') || id.startsWith('gaw_n:')) {
          const [, giveawayMsgId, pageStr] = id.split(':');
          const currentPage = parseInt(pageStr);
          const newPage     = id.startsWith('gaw_p:') ? currentPage - 1 : currentPage + 1;
          const { embed, totalPages, currentPage: safePage } = buildParticipantsEmbed(giveawayMsgId, newPage);
          const row = buildParticipantsRow(giveawayMsgId, safePage, totalPages);
          return await interaction.update({ embeds: [embed], components: [row] });
        }

        // Coins giveaway — setup panel buttons
        if (id.startsWith('cg_setup:')) {
          return await client.commands.get('coinsgiveaway')?.handleSetupButton(interaction);
        }

        // Coins giveaway — list view: delete-ended-giveaway confirm/back
        if (id.startsWith('cg_list_delyes:') || id === 'cg_list_delno') {
          return await client.commands.get('coinsgiveaway')?.handleListButton(interaction);
        }

        // Coins giveaway — enter
        if (id === 'coinsgaw_enter') {
          if (!global.coinsGiveawayEntrants) global.coinsGiveawayEntrants = new Map();
          let entrants = global.coinsGiveawayEntrants.get(interaction.message.id);

          // Not in memory — bot may have restarted during a long giveaway.
          // Check persisted active-giveaway state before declaring it ended.
          if (!entrants) {
            const cgCmd = client.commands.get('coinsgiveaway');
            const saved = cgCmd?.getActive?.(interaction.message.id);
            if (saved && saved.endTime > Date.now()) {
              if (!global.coinsGiveawayMeta) global.coinsGiveawayMeta = new Map();
              entrants = new Set(saved.entrants || []);
              global.coinsGiveawayEntrants.set(interaction.message.id, entrants);
              global.coinsGiveawayMeta.set(interaction.message.id, {
                amount: saved.amount, winners: saved.winnersCount,
                hostId: saved.hostId, endTime: saved.endTime, guildId: saved.guildId,
                requiredRoleId: saved.requiredRoleId || null, bonusRoleId: saved.bonusRoleId || null,
                minAccountAgeDays: saved.minAccountAgeDays || 0,
              });
            }
          }

          if (!entrants) return interaction.reply({ content: 'This giveaway has ended.', flags: EPHEMERAL_FLAG });
          if (entrants.has(interaction.user.id)) return interaction.reply({ content: "You've already entered!", flags: EPHEMERAL_FLAG });

          const cgMeta = global.coinsGiveawayMeta?.get(interaction.message.id);
          if (cgMeta?.requiredRoleId && !interaction.member.roles.cache.has(cgMeta.requiredRoleId)) {
            return await interaction.reply({ content: `❌ You need the <@&${cgMeta.requiredRoleId}> role to enter this giveaway.`, flags: EPHEMERAL_FLAG });
          }
          if (cgMeta?.minAccountAgeDays > 0) {
            const ageDays = (Date.now() - interaction.user.createdTimestamp) / 86400000;
            if (ageDays < cgMeta.minAccountAgeDays) {
              return await interaction.reply({ content: `❌ Your account must be at least **${cgMeta.minAccountAgeDays} days** old to enter this giveaway.`, flags: EPHEMERAL_FLAG });
            }
          }

          entrants.add(interaction.user.id);
          try {
            const upd  = EmbedBuilder.from(interaction.message.embeds[0]);
            const desc = (upd.data.description || '').replace(/📊 \*\*Entries:\*\* \d+ participants?/, `📊 **Entries:** ${entrants.size} participant${entrants.size !== 1 ? 's' : ''}`);
            upd.setDescription(desc);
            // Redrawn and re-uploaded, for the same reason as the prize
            // giveaway above: pointing the embed at the file already on the
            // message is a guess, and it was the wrong one.
            const cgCmdRef = client.commands.get('coinsgiveaway');
            const forBanner = cgMeta ?? cgCmdRef?.getActive?.(interaction.message.id);
            const banner = forBanner
              ? cgCmdRef?.buildBanner?.({ amount: forBanner.amount, winners: forBanner.winners ?? forBanner.winnersCount ?? 1 })
              : null;
            const coinsOpts = banner ? reattachBuilt(upd, banner) : {};
            await interaction.message.edit({ embeds: [upd], ...coinsOpts }).catch(() => {});
          } catch {}
          client.commands.get('coinsgiveaway')?.persistEntry?.(interaction.message.id, entrants);
          return await interaction.reply({ content: '🎟️ You\'ve entered the giveaway! Good luck!', flags: EPHEMERAL_FLAG });
        }

        // Coins giveaway — participants (first page)
        if (id === 'coinsgaw_participants') {
          const giveawayMsgId = interaction.message.id;
          const { embed, totalPages, currentPage } = buildCoinsParticipantsEmbed(giveawayMsgId, 1);
          const row = buildCoinsParticipantsRow(giveawayMsgId, currentPage, totalPages);
          return await interaction.reply({ embeds: [embed], components: [row], flags: EPHEMERAL_FLAG });
        }

        // Coins giveaway — prev/next page (updates in-place, no new message)
        if (id.startsWith('cg_p:') || id.startsWith('cg_n:')) {
          const [, giveawayMsgId, pageStr] = id.split(':');
          const currentPage = parseInt(pageStr);
          const newPage     = id.startsWith('cg_p:') ? currentPage - 1 : currentPage + 1;
          const { embed, totalPages, currentPage: safePage } = buildCoinsParticipantsEmbed(giveawayMsgId, newPage);
          const row = buildCoinsParticipantsRow(giveawayMsgId, safePage, totalPages);
          return await interaction.update({ embeds: [embed], components: [row] });
        }

        // Ticket buttons
        if (id === 'create_ticket' || id === 'close_ticket' || id === 'ticket_still_here') {
          return await client.commands.get('ticket')?.handleButton(interaction, [], client);
        }

        // Verification — memory-sequence challenge
        if (id === 'verify_start') {
          return await client.commands.get('verify')?.handleStart(interaction);
        }
        if (id.startsWith('verify_ready:')) {
          return await client.commands.get('verify')?.handleReady(interaction, id.slice('verify_ready:'.length));
        }
        if (id.startsWith('verify_pick:')) {
          const [, sessionId, idxStr] = id.split(':');
          return await client.commands.get('verify')?.handlePick(interaction, sessionId, parseInt(idxStr, 10));
        }
        if (id.startsWith('verify_cancel:')) {
          return await client.commands.get('verify')?.handleCancel(interaction, id.slice('verify_cancel:'.length));
        }

        // Poll
        if (id.startsWith('poll_vote_')) {
          return await client.commands.get('poll')?.handleButton(interaction, [], client);
        }

        // Embed editor + delete-selector + list-pager + preview-send buttons
        if (id.startsWith('embed_edit_') || id.startsWith('embed_del') || id.startsWith('embed_list:') || id.startsWith('embed_previewsend:')) {
          return await client.commands.get('embed')?.handleEmbedButton(interaction);
        }

        // Button editor + delete-selector buttons (be_* / btn_del*)
        if ((id.startsWith('be_') && !id.startsWith('be_modal_')) || id.startsWith('btn_del')) {
          return await client.commands.get('button')?.handleButtonEdit(interaction);
        }

        // Schedule cancel-selector buttons
        if (id.startsWith('sch_del')) {
          return await client.commands.get('schedule')?.handleScheduleButton(interaction);
        }

        // Shop settings panel — add/edit/remove/close buttons
        if (id.startsWith('shopset_')) {
          return await client.commands.get('shopsettings')?.handleButton(interaction);
        }

        // Report — submission panel buttons (link/submit/cancel)
        if (id.startsWith('report_link:') || id.startsWith('report_submit:') || id.startsWith('report_cancel:')) {
          return await client.commands.get('report')?.handleButton(interaction);
        }

        // Report — take action
        if (id.startsWith('rpt_action:')) {
          const [, targetUserId, reportChannelId] = id.split(':');
          return await handleReportAction(interaction, targetUserId, reportChannelId);
        }

        // Report — execute action
        if (id.startsWith('rpt_w:') || id.startsWith('rpt_k:') || id.startsWith('rpt_b:') || id.startsWith('rpt_dismiss:')) {
          const parts = id.split(':');
          if (id.startsWith('rpt_dismiss:')) {
            const [, reportChannelId, reportMsgId] = parts;
            return await executeReportAction(interaction, 'dismiss', null, reportChannelId, reportMsgId);
          }
          const [, targetUserId, reportChannelId, reportMsgId] = parts;
          const action = id.startsWith('rpt_w:') ? 'warn' : id.startsWith('rpt_k:') ? 'kick' : 'ban';
          return await executeReportAction(interaction, action, targetUserId, reportChannelId, reportMsgId);
        }

        // Card grab
        if (id === 'card_grab') {
          if (!global.cardDrops) global.cardDrops = new Map();
          const drop = global.cardDrops.get(interaction.message.id);
          if (!drop || drop.grabbed) {
            return await interaction.reply({ content: '💨 Too late! Someone already grabbed this card.', flags: EPHEMERAL_FLAG });
          }
          drop.grabbed = true;
          global.cardDrops.delete(interaction.message.id);
          const { writeJson } = require('../utils/jsonStorage');
          const { buildClaimedEmbed } = require('../utils/cardsManager');
          const allCards = readJson('cards.json', {});
          if (!allCards[interaction.user.id]) allCards[interaction.user.id] = [];
          allCards[interaction.user.id].push({ ...drop.card, collectedAt: Date.now() });
          writeJson('cards.json', allCards);
          const { embed: claimedEmbed, files: claimedFiles } = buildClaimedEmbed(drop.card, interaction.user);
          const disabled = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('card_claimed')
              .setLabel(`🎉 ${interaction.user.username} grabbed it!`)
              .setStyle(ButtonStyle.Success)
              .setDisabled(true),
          );
          return await interaction.update({ embeds: [claimedEmbed], files: claimedFiles, components: [disabled], attachments: [] });
        }

        // Restore — confirm
        if (id.startsWith('restore_confirm:')) {
          const [, guildId, userId] = id.split(':');
          if (interaction.user.id !== userId || interaction.guild.id !== guildId) {
            return await interaction.reply({ content: '❌ Only the admin who initiated this restore can confirm it.', flags: EPHEMERAL_FLAG });
          }
          return await client.commands.get('restore')?.handleRestoreConfirm(interaction);
        }

        // Restore — cancel
        if (id.startsWith('restore_cancel:')) {
          const [, guildId, userId] = id.split(':');
          if (interaction.user.id !== userId || interaction.guild.id !== guildId) {
            return await interaction.reply({ content: '❌ Only the admin who initiated this restore can cancel it.', flags: EPHEMERAL_FLAG });
          }
          return await client.commands.get('restore')?.handleRestoreCancel(interaction);
        }

        // Auto-mod — panel toggles
        if (id.startsWith('automod_toggle:')) {
          return await client.commands.get('automod')?.handleToggle(interaction, id.slice('automod_toggle:'.length));
        }
        if (id.startsWith('modlog_toggle:')) {
          return await client.commands.get('modlog')?.handleToggle(interaction, id.slice('modlog_toggle:'.length));
        }

        // Economic calendar — panel buttons
        if (id.startsWith('econcal_panel:')) {
          return await client.commands.get('econcal')?.handlePanelButton(interaction, id.slice('econcal_panel:'.length));
        }

        // Trivia — answer buttons / close session
        if (id.startsWith('trivia_answer:')) {
          return await client.commands.get('trivia')?.handleAnswer(interaction);
        }
        if (id.startsWith('trivia_close:')) {
          return await client.commands.get('trivia')?.handleClose(interaction);
        }

        // Fishing / mining — continue-session or close-session buttons
        if (id.startsWith('gather_again:') || id.startsWith('gather_close:')) {
          const action = id.split(':')[1];
          return await client.commands.get(action)?.handleButton(interaction);
        }

        // News feed panel — toggle/channel/sources/topics/close
        if (id.startsWith('nf:')) {
          return await client.commands.get('newsfeed')?.handleButton(interaction);
        }

        // Shop panel — buy/inventory/use/close buttons
        if (id === 'shop_buy' || id === 'shop_inventory' || id === 'shop_use' || id.startsWith('shop_close:')) {
          return await client.commands.get('shop')?.handleButton(interaction);
        }

        // Bank panel — deposit/withdraw/collect/check-balance/leaderboard/close
        if (id.startsWith('bank_panel:')) {
          return await client.commands.get('bank')?.handleButton(interaction);
        }
        if (id.startsWith('bank_close:')) {
          return await client.commands.get('bank')?.handleClose(interaction);
        }

        // Auto-mod — link request flow
        if (id.startsWith('automod_link_request:')) {
          return await client.commands.get('automod')?.handleLinkRequestButton(interaction, id.slice('automod_link_request:'.length));
        }
        if (id.startsWith('automod_link_approve:')) {
          return await client.commands.get('automod')?.handleLinkApprove(interaction, id.slice('automod_link_approve:'.length));
        }
        if (id.startsWith('automod_link_deny:')) {
          return await client.commands.get('automod')?.handleLinkDeny(interaction, id.slice('automod_link_deny:'.length));
        }

        // Auto-mod — cooldowns list (manage/adjust/delete)
        if (id === 'automod_cd_back' || id.startsWith('automod_cd_delete:') || id.startsWith('automod_cd_delyes:')
          || id.startsWith('automod_cd_delno:') || id.startsWith('automod_cd_adjust:')) {
          return await client.commands.get('automod')?.handleCooldownButton(interaction);
        }

        // Auto-mod — requests list (manage/delete) — approve/deny reuse the
        // automod_link_approve:/automod_link_deny: routes above
        if (id === 'automod_req_back' || id.startsWith('automod_req_delete:') || id.startsWith('automod_req_delyes:')
          || id.startsWith('automod_req_delno:')) {
          return await client.commands.get('automod')?.handleRequestsButton(interaction);
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
              return await interaction.reply({ content: `⏳ Please wait **${Math.ceil(remain / 1000)}s** before using this button again.`, flags: EPHEMERAL_FLAG });
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
            else { await interaction.reply({ embeds: payload.embeds, files: payload.files, components: payload.components.length ? payload.components : undefined, flags: EPHEMERAL_FLAG }); success = true; }
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
        if (isUnknownInteractionError(err)) return;
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
          return await client.commands.get('giveaway')?.handleSetupModal(interaction);
        }

        // Coins giveaway setup modals
        if (id.startsWith('cg_modal:')) {
          return await client.commands.get('coinsgiveaway')?.handleSetupModal(interaction);
        }

        // Embed editor modals
        if (id.startsWith('embed_modal_')) {
          return await client.commands.get('embed')?.handleEmbedModal(interaction);
        }

        // Button editor modals
        if (id.startsWith('be_modal_')) {
          return await client.commands.get('button')?.handleButtonEditModal(interaction);
        }

        // Shop settings — add/edit item modals
        if (id.startsWith('shopset_')) {
          return await client.commands.get('shopsettings')?.handleModal(interaction);
        }

        // Report — link modal
        if (id.startsWith('report_link_modal:')) {
          return await client.commands.get('report')?.handleModal(interaction);
        }

        // Verification — rules text modal
        if (id === 'verify_rules_modal') {
          return await client.commands.get('verify')?.handleRulesModal(interaction);
        }

        // Auto-mod — link request modal (link + reason)
        if (id.startsWith('automod_link_modal:')) {
          return await client.commands.get('automod')?.handleLinkModalSubmit(interaction, id.slice('automod_link_modal:'.length));
        }

        // Auto-mod — approval cooldown modal
        if (id.startsWith('automod_link_approve_modal:')) {
          return await client.commands.get('automod')?.handleLinkApproveModalSubmit(interaction, id.slice('automod_link_approve_modal:'.length));
        }

        // Auto-mod — cooldowns list: adjust modal
        if (id.startsWith('automod_cd_adjust_modal:')) {
          return await client.commands.get('automod')?.handleCooldownAdjustModalSubmit(interaction, id.slice('automod_cd_adjust_modal:'.length));
        }

        // Economic calendar — weekly post time/offset modal
        if (id === 'econcal_weekly_time_modal') {
          return await client.commands.get('econcal')?.handleWeeklyTimeModalSubmit(interaction);
        }

        // Bank panel — deposit/withdraw amount modal
        if (id.startsWith('bank_amount_modal:')) {
          return await client.commands.get('bank')?.handleModal(interaction);
        }
      } catch (err) {
        if (isUnknownInteractionError(err)) return;
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
          return await client.commands.get('embed')?.handleEmbedSelect(interaction);
        if (id === 'btn_delselect')
          return await client.commands.get('button')?.handleButtonSelect(interaction);
        if (id === 'sch_delselect')
          return await client.commands.get('schedule')?.handleScheduleSelect(interaction);
        if (id === 'gaw_list_delsel')
          return await client.commands.get('giveaway')?.handleListSelect(interaction);
        if (id === 'cg_list_delsel')
          return await client.commands.get('coinsgiveaway')?.handleListSelect(interaction);
        if (id === 'automod_cd_select')
          return await client.commands.get('automod')?.handleCooldownSelect(interaction);
        if (id === 'automod_req_select')
          return await client.commands.get('automod')?.handleRequestsSelect(interaction);
        if (id.startsWith('newsfeed_topics_select') || id.startsWith('nf_topics_select:'))
          return await client.commands.get('newsfeed')?.handleTopicsSelect(interaction);
        if (id === 'econcal_impact_select')
          return await client.commands.get('econcal')?.handleImpactSelect(interaction);
        if (id === 'econcal_currency_select')
          return await client.commands.get('econcal')?.handleCurrencySelect(interaction);
        if (id === 'econcal_weekly_weekday_select')
          return await client.commands.get('econcal')?.handleWeekdaySelect(interaction);
        if (id === 'shop_buy_select' || id === 'shop_use_select')
          return await client.commands.get('shop')?.handleSelect(interaction);
        if (id.startsWith('report_reason_select:'))
          return await client.commands.get('report')?.handleReasonSelect(interaction);
        if (id.startsWith('shopset_'))
          return await client.commands.get('shopsettings')?.handleSelect(interaction);

        // Generic fallback (existing sel_* pattern)
        const [system, ...args] = id.split(':');
        const handler = client.commands.get(`sel_${system}`);
        if (handler?.handleSelect) await handler.handleSelect(interaction, args, client);
      } catch (err) {
        if (isUnknownInteractionError(err)) return;
        console.error(`[SEL ERROR] ${id}:`, err);
        const rep = { embeds: [embedUtil.error('Error', 'An unexpected error occurred.')], flags: EPHEMERAL_FLAG };
        if (interaction.replied || interaction.deferred) await interaction.followUp(rep).catch(() => {});
        else await interaction.reply(rep).catch(() => {});
      }
    }

    // ── User Select Menus (native picker — e.g. report panel) ──────────────────
    if (interaction.isUserSelectMenu()) {
      const id = interaction.customId;
      try {
        if (id.startsWith('report_user_select:'))
          return await client.commands.get('report')?.handleUserSelect(interaction);
        if (id.startsWith('bank_checkbalance_select:'))
          return await client.commands.get('bank')?.handleUserSelect(interaction);
      } catch (err) {
        if (isUnknownInteractionError(err)) return;
        console.error(`[USER SELECT ERROR] ${id}:`, err);
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
          return await client.commands.get('giveaway')?.handleRoleSelect(interaction);
        if (id.startsWith('cg_role_select:'))
          return await client.commands.get('coinsgiveaway')?.handleRoleSelect(interaction);
        if (id === 'econcal_role_select')
          return await client.commands.get('econcal')?.handleRoleSelect(interaction);
      } catch (err) {
        if (isUnknownInteractionError(err)) return;
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
          return await client.commands.get('giveaway')?.handleChannelSelect(interaction);
        if (id.startsWith('cg_channel_select:'))
          return await client.commands.get('coinsgiveaway')?.handleChannelSelect(interaction);
        if (id.startsWith('nf_channel_select:'))
          return await client.commands.get('newsfeed')?.handleChannelSelect(interaction);
        if (id === 'econcal_channel_select')
          return await client.commands.get('econcal')?.handleChannelSelect(interaction);
        if (id.startsWith('econcal_postchannel_select:'))
          return await client.commands.get('econcal')?.handlePostChannelSelect(interaction);
      } catch (err) {
        if (isUnknownInteractionError(err)) return;
        console.error(`[CHANNEL SELECT ERROR] ${id}:`, err);
        const rep = { embeds: [embedUtil.error('Error', 'An unexpected error occurred.')], flags: EPHEMERAL_FLAG };
        if (interaction.replied || interaction.deferred) await interaction.followUp(rep).catch(() => {});
        else await interaction.reply(rep).catch(() => {});
      }
    }
  },
};
