'use strict';

const { Events, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const { createServerEmbed } = require('../utils/embedBuilder');
const { pickRandomCard, buildDropEmbed, buildClaimedEmbed, getCardConfig } = require('../utils/cardsManager');
const { isOn } = require('../utils/messageStyle');
const { isFeatureEnabled } = require('../utils/featureToggles');
const { equip } = require('../utils/badgeManager');
const { BADGE_DEFS } = require('../utils/badges');

if (!global.cardDrops)         global.cardDrops         = new Map();
if (!global.cardMessageCounts) global.cardMessageCounts = new Map(); // key: "guildId:channelId"

const cooldowns = new Map();

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;
    const guildId = message.guild?.id;
    if (!guildId) return;

    // ── Ticket inactivity reset ───────────────────────────────────────────
    const isTicket = message.channel.topic?.startsWith('ticket-owner:') || message.channel.name?.startsWith('ticket-');
    if (isTicket) {
      const ticketCmd = client?.commands?.get('ticket');
      if (ticketCmd?.resetInactivityTimer) {
        ticketCmd.resetInactivityTimer(message.channel.id);
      }
    }

    // ── g.reroll <id> prefix command ─────────────────────────────────────
    const content = message.content.trim();
    if (content.toLowerCase().startsWith('g.reroll')) {
      const parts  = content.split(/\s+/);
      const shortId = parts[1] || '';
      const { reroll } = require('../commands/utility/giveaway');
      try { await reroll(message, shortId); } catch (err) { console.error('[REROLL]', err); }
      return;
    }

    // ── Auto-mod (bad-word / link filter) ─────────────────────────────────
    // Runs before XP/cards/autoreply — a filtered message shouldn't earn XP,
    // drop a card, or trigger an autoreply.
    const handled = isFeatureEnabled(guildId, 'automod')
      && await client?.commands?.get('automod')?.handleMessage(message, client).catch(() => false);
    if (handled) return;

    if (isFeatureEnabled(guildId, 'leveling')) await handleLeveling(message);
    if (isFeatureEnabled(guildId, 'autoreply')) await handleAutoReply(message);
    if (isFeatureEnabled(guildId, 'cards')) await handleCardDrop(message);
  },
};

async function handleLeveling(message) {
  const levels    = readJson('levels.json', {});
  const guildData = levels[message.guild.id] || { users: {}, roles: {}, settings: { xpPerMessage: [15, 25], baseXp: 100, multiplier: 1.5 } };
  const userId    = message.author.id;

  if (!guildData.users[userId]) {
    guildData.users[userId] = { xp: 0, level: 1, messages: 0, lastMessage: 0, totalXp: 0 };
  }

  const settings = guildData.settings || { xpPerMessage: [15, 25], baseXp: 100, multiplier: 1.5 };

  // Two levers, and they stop different things. The cooldown caps how *often*
  // a member can earn; the minimum length caps how *cheaply*. On its own the
  // cooldown still pays full XP for "k" every twenty seconds, which is the
  // whole of what someone farming a leaderboard actually does.
  //
  // Length is checked first so a too-short message is simply not an earning
  // attempt — it neither pays nor starts the clock, and the member's next real
  // sentence is not punished for it.
  const minLength = Number.isFinite(settings.minLength) ? settings.minLength : 0;
  if (minLength > 0 && message.content.trim().length < minLength) return;

  const now        = Date.now();
  // 20 seconds is what this was fixed at before it could be set, so a guild
  // that has never touched it behaves exactly as it always did.
  const cooldownMs = Number.isFinite(settings.cooldownMs) ? settings.cooldownMs : 20000;
  if (now - guildData.users[userId].lastMessage < cooldownMs) return;

  guildData.users[userId].lastMessage = now;
  guildData.users[userId].messages   += 1;

  const minXp     = settings.xpPerMessage[0] || 15;
  const maxXp     = settings.xpPerMessage[1] || 25;
  const xpGain    = Math.floor(Math.random() * (maxXp - minXp + 1)) + minXp;
  guildData.users[userId].xp      += xpGain;
  guildData.users[userId].totalXp += xpGain;

  const baseXp     = settings.baseXp || 100;
  const multiplier = settings.multiplier || 1.5;
  const neededXp   = Math.floor(baseXp * Math.pow(guildData.users[userId].level, multiplier));

  if (guildData.users[userId].xp >= neededXp) {
    guildData.users[userId].level += 1;
    guildData.users[userId].xp    = 0;
    const newLevel = guildData.users[userId].level;

    const levelRoles = guildData.roles || {};
    const roleId     = levelRoles[newLevel];
    if (roleId) {
      const role = message.guild.roles.cache.get(roleId);
      if (role) { try { await message.member.roles.add(role); } catch {} }
    }

    // The badge-at-a-level replacement for buying one in the shop — works
    // the same whether or not this server's economy is switched on, since a
    // badge was never really an economy thing, just sold in one.
    const levelBadges = guildData.badges || {};
    const badgeId = levelBadges[newLevel];
    let awardedBadge = null;
    if (badgeId && BADGE_DEFS[badgeId]) {
      const result = equip(userId, message.guild.id, badgeId);
      if (result.ok && !result.already) awardedBadge = BADGE_DEFS[badgeId];
    }

    // Announced in whatever channel they were talking in, so it is kept to the
    // one fact that is news. The running totals are in /rank. A server that
    // would rather not have it at all can switch it off in Appearance.
    //
    // Plain content rather than an embed — a level-up is a passing moment,
    // not a card someone opens and reads; QuantLab's own voice guidance is
    // "short declaratives, almost no numbers, teach don't sell", which an
    // embed's boxed-and-bordered weight works against more than it helps.
    // Discord's small "-# " subtext line carries the eyebrow and the stats
    // without needing a border to do it.
    if (isOn(message.guild.id, 'member.levelup')) {
      const lines = [
        '-# quantlab \u00b7 level up',
        `**${message.member.displayName}** just reached **level ${newLevel}.**`,
      ];
      if (awardedBadge) lines.push(`-# ${awardedBadge.emoji} new badge equipped \u2014 ${awardedBadge.label}`);
      lines.push(`-# ${guildData.users[userId].totalXp.toLocaleString()} xp total \u00b7 ${guildData.users[userId].messages.toLocaleString()} messages`);
      try { await message.channel.send({ content: lines.join('\n') }); } catch {}
    }
  }

  levels[message.guild.id] = guildData;
  writeJson('levels.json', levels);
}

async function handleCardDrop(message) {
  try {
    const guildId = message.guild.id;
    const cfg = getCardConfig(guildId);

    // A drop channel, when one is set. It was on the panel long before
    // anything read it, so picking one used to change nothing at all.
    if (cfg.channelId && cfg.channelId !== message.channel.id) return;

    // Increment per-channel counter
    const key   = `${guildId}:${message.channel.id}`;
    const count = (global.cardMessageCounts.get(key) || 0) + 1;

    if (count < cfg.interval) {
      global.cardMessageCounts.set(key, count);
      return;
    }

    // Hit the threshold — reset and drop a card
    global.cardMessageCounts.set(key, 0);

    // ...and the chance roll, which was the panel's other dead setting. The
    // counter still resets on a miss, so a low chance makes drops rarer rather
    // than making the very next message drop one.
    if (cfg.chance < 100 && Math.random() * 100 >= cfg.chance) return;

    const card = pickRandomCard(guildId);
    const { embed, files } = buildDropEmbed(card, false, cfg.claimSeconds);
    const row   = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('card_grab').setLabel('🃏 Grab Card!').setStyle(ButtonStyle.Secondary),
    );

    const msg = await message.channel.send({ embeds: [embed], files, components: [row] });
    global.cardDrops.set(msg.id, { card, grabbed: false, guildId });

    // Expire once the claim window is up
    setTimeout(async () => {
      const drop = global.cardDrops.get(msg.id);
      if (!drop || drop.grabbed) return;
      global.cardDrops.delete(msg.id);
      const { embed: expiredEmbed, files: expiredFiles } = buildDropEmbed(card, true);
      const disabled = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('card_gone').setLabel('💨 Nobody grabbed it...').setStyle(ButtonStyle.Secondary).setDisabled(true),
      );
      await msg.edit({ embeds: [expiredEmbed], files: expiredFiles, components: [disabled], attachments: [] }).catch(() => {});
    }, cfg.claimSeconds * 1000);
  } catch (err) {
    console.error('[CARD DROP]', err);
  }
}

async function handleAutoReply(message) {
  // ── Admin-only: only admins trigger auto-replies ──────────────────────
  const isAdmin = message.member?.permissions?.has(PermissionFlagsBits.Administrator);
  if (!isAdmin) return;

  const autoreplies  = readJson('autoreplies.json', {});
  const guildReplies = autoreplies[message.guild.id] || {};

  for (const [name, data] of Object.entries(guildReplies)) {
    if (!data.enabled) continue;
    const content = message.content;
    const match   = data.exact
      ? content.toLowerCase() === data.trigger.toLowerCase()
      : content.toLowerCase().includes(data.trigger.toLowerCase());
    if (!match) continue;

    const key        = `${message.guild.id}-${name}`;
    const lastUsed   = cooldowns.get(key) || 0;
    const cooldownMs = (data.cooldown || 5) * 1000;
    if (Date.now() - lastUsed < cooldownMs) continue;

    cooldowns.set(key, Date.now());

    // Use buildEmbedPayload so buttons attached to the template are included
    const { buildEmbedPayload } = require('../commands/utility/embed');
    const payload = buildEmbedPayload(message.guild, data.embedName);
    if (!payload) continue;

    try { await message.reply({ embeds: payload.embeds, files: payload.files, components: payload.components }); } catch {}
    break;
  }
}
