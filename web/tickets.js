'use strict';

/**
 * web/tickets.js
 *
 * Tickets, from the panel.
 *
 * Two things the slash command cannot do, which is most of why this exists:
 * see every open ticket at once, and close one you are not currently sitting
 * in. /ticket close only ever acts on the channel it was typed in, so
 * clearing up a dozen stale tickets means visiting a dozen channels.
 *
 * Open tickets are not stored anywhere — the channel *is* the record. A ticket
 * channel is one whose topic is `ticket-owner:<id>`, which is what
 * commands/utility/ticket.js writes when it creates one, so this reads the
 * same marker rather than keeping a second list that could drift out of sync
 * with reality.
 */

const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const { createServerEmbed } = require('../utils/embedBuilder');

const ticketCmd = () => require('../commands/utility/ticket.js');

const TOPIC_PREFIX = 'ticket-owner:';

// Mirrors DEFAULT in commands/utility/ticket.js. Kept in the same shape so the
// panel and the command always read one another's writes.
const DEFAULTS = {
  inactivityEnabled: true,
  inactivityTime: 30,
  inactivityMessage: 'This ticket has been inactive for {time}. Click below if you still need help.',
  transcriptEnabled: false,
};

const FIELDS = [
  { key: 'inactivityEnabled', type: 'bool', label: 'Nudge quiet tickets' },
  { key: 'inactivityTime', type: 'int', label: 'Nudge after (minutes)', min: 1, max: 10080 },
  { key: 'inactivityMessage', type: 'text', label: 'What the nudge says', max: 400 },
  { key: 'transcriptEnabled', type: 'bool', label: 'Save a transcript on close' },
];

function settingsFor(guildId) {
  const stored = readJson('config.json', {})[guildId]?.ticketSettings || {};
  return { ...DEFAULTS, ...stored };
}

/** Every open ticket channel, newest first. */
function openTickets(guild) {
  if (!guild?.channels?.cache) return [];
  const out = [];
  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== ChannelType.GuildText) continue;
    const topic = ch.topic || '';
    // The name check is the fallback the command itself uses for tickets made
    // before topics were set.
    const byTopic = topic.startsWith(TOPIC_PREFIX);
    if (!byTopic && !ch.name?.startsWith('ticket-')) continue;
    out.push({
      id: ch.id,
      name: ch.name,
      ownerId: byTopic ? topic.slice(TOPIC_PREFIX.length) : null,
      createdAt: ch.createdTimestamp ?? null,
    });
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Everything the Tickets screen shows. */
function read(guildId, guild) {
  const s = settingsFor(guildId);
  const supportRoleId = readJson('config.json', {})[guildId]?.supportRole || null;
  return {
    fields: FIELDS,
    values: Object.fromEntries(FIELDS.map(f => [f.key, s[f.key]])),
    supportRoleId,
    supportRole: (supportRoleId && guild?.roles?.cache?.get(supportRoleId)?.name) || null,
    open: openTickets(guild),
  };
}

/* ─── writing ────────────────────────────────────────────────────────────── */

function save(guildId, body, guild) {
  const config = readJson('config.json', {});
  if (!config[guildId]) config[guildId] = {};
  const current = settingsFor(guildId);
  const next = { ...current };
  const changed = [];

  for (const f of FIELDS) {
    if (!(f.key in body)) continue;
    const raw = body[f.key];

    if (f.type === 'bool') {
      if (typeof raw !== 'boolean' || raw === current[f.key]) continue;
      next[f.key] = raw;
    } else if (f.type === 'int') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < f.min || n > f.max) return { error: 'bad_value', field: f.key };
      if (n === current[f.key]) continue;
      next[f.key] = n;
    } else {
      if (typeof raw !== 'string') continue;
      const clean = raw.trim().slice(0, f.max);
      if (!clean || clean === current[f.key]) continue;
      next[f.key] = clean;
    }
    changed.push(f.label);
  }

  if ('supportRoleId' in body) {
    const id = body.supportRoleId;
    if (id === null || id === '') {
      if (config[guildId].supportRole) { delete config[guildId].supportRole; changed.push('support role cleared'); }
    } else {
      if (typeof id !== 'string' || !/^\d{5,25}$/.test(id) || !guild?.roles?.cache?.has(id)) return { error: 'bad_role' };
      if (config[guildId].supportRole !== id) { config[guildId].supportRole = id; changed.push('support role'); }
    }
  }

  if (!changed.length) return { unchanged: true };
  config[guildId].ticketSettings = next;
  writeJson('config.json', config);
  return { ok: true, changed };
}

/**
 * Closes a ticket from the panel.
 *
 * Deletes the channel outright, which is what /ticket close does — there is no
 * archive state in this system, so pretending otherwise would leave a channel
 * nobody can see and nobody cleans up. The inactivity timer is cleared first
 * so a deleted channel cannot be nudged afterwards.
 */
async function close(guildId, body, { guild, session }) {
  const channelId = String(body.channelId || '');
  if (!/^\d{5,25}$/.test(channelId)) return { error: 'bad_channel' };

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { error: 'unknown_ticket' };

  const topic = channel.topic || '';
  if (!topic.startsWith(TOPIC_PREFIX) && !channel.name?.startsWith('ticket-')) {
    return { error: 'not_a_ticket' };
  }

  try { ticketCmd().clearInactivityTimer(channel.id); } catch { /* no timer running */ }

  const name = channel.name;
  const ownerId = topic.startsWith(TOPIC_PREFIX) ? topic.slice(TOPIC_PREFIX.length) : null;

  try {
    await channel.delete(`Ticket closed from the control panel by ${session.name}`);
  } catch (err) {
    console.error('[Panel] closing a ticket failed:', err.message);
    return { error: 'close_failed', detail: err.message.slice(0, 140) };
  }
  return { ok: true, name, ownerId };
}

/**
 * Posts the "open a ticket" panel into a channel.
 *
 * Built from the same createServerEmbed + create_ticket button the slash
 * command uses, so the message members see is identical however it was posted.
 */
async function postPanel(guildId, body, { guild }) {
  const channelId = String(body.channelId || '');
  if (!/^\d{5,25}$/.test(channelId)) return { error: 'bad_channel' };
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.()) return { error: 'bad_channel' };

  const embed = createServerEmbed('ticket', {
    title: 'Support Tickets',
    description: 'Need help? Click the button below to open a private ticket and our team will assist you.',
    fields: [
      { name: 'Response Time', value: 'Usually within a few hours', inline: true },
      { name: 'What to Include', value: 'Describe your issue clearly', inline: true },
    ],
  }, guild);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('create_ticket').setLabel('Create Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫'),
  );

  try {
    // Nothing in this embed should ever ping anyone.
    await channel.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
  } catch (err) {
    console.error('[Panel] posting the ticket panel failed:', err.message);
    return { error: 'post_failed', detail: err.message.slice(0, 140) };
  }
  return { ok: true, channelName: channel.name };
}

module.exports = { read, save, close, postPanel, openTickets, FIELDS, DEFAULTS };
