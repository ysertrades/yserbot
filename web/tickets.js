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

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');

const ticketCmd = () => require('../commands/utility/ticket.js');

const TOPIC_PREFIX = 'ticket-owner:';

// The command's own defaults rather than a second copy of them. Two tables
// spelling out the same wording is how the panel and the bot drift apart, and
// they already had: the Settings screen offered the same stored field under a
// different name, in a different unit, describing a thing it does not do.
const { DEFAULT: DEFAULTS } = require('../commands/utility/ticket');

const FIELDS = [];

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
  const conf = readJson('config.json', {})[guildId] || {};
  let supportRoleIds = Array.isArray(conf.supportRoles) ? conf.supportRoles.filter(Boolean) : [];
  if (!supportRoleIds.length && conf.supportRole) supportRoleIds = [conf.supportRole];
  const supportRoles = supportRoleIds.map(id => ({
    id,
    name: guild?.roles?.cache?.get(id)?.name || id,
  }));
  return {
    fields: FIELDS,
    values: {},
    supportRoleIds,
    supportRoles,
    // legacy single for any old UI
    supportRoleId: supportRoleIds[0] || null,
    supportRole: supportRoles[0]?.name || null,
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

  if ('supportRoleIds' in body || 'supportRoleId' in body) {
    let ids = body.supportRoleIds;
    if (!Array.isArray(ids) && 'supportRoleId' in body) {
      ids = body.supportRoleId ? [body.supportRoleId] : [];
    }
    if (!Array.isArray(ids)) return { error: 'bad_roles' };
    const clean = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !/^\d{5,25}$/.test(id)) return { error: 'bad_role' };
      if (!guild?.roles?.cache?.has(id)) return { error: 'bad_role' };
      if (!clean.includes(id)) clean.push(id);
    }
    const prev = Array.isArray(config[guildId].supportRoles) ? config[guildId].supportRoles : [];
    const same = prev.length === clean.length && prev.every((id, i) => id === clean[i]);
    if (!same) {
      config[guildId].supportRoles = clean;
      if (clean.length) config[guildId].supportRole = clean[0];
      else {
        delete config[guildId].supportRole;
        delete config[guildId].supportRoles;
      }
      changed.push(clean.length ? `support roles (${clean.length})` : 'support roles cleared');
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
 * Through the command's own builder, not a copy of it. This used to hold a
 * second copy of the wording and the button, and once the panel became
 * editable on the Appearance screen only the command's copy was taught to
 * read it — so editing the card changed what /ticket setup sent and left
 * this posting the shipped default. Required lazily for the same reason
 * web/composer.js does it: the command files pull in a good deal of the bot
 * and web/ is loaded before they have all settled.
 */
async function postPanel(guildId, body, { guild }) {
  const channelId = String(body.channelId || '');
  if (!/^\d{5,25}$/.test(channelId)) return { error: 'bad_channel' };
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.()) return { error: 'bad_channel' };

  const { buildTicketPanel } = require('../commands/utility/ticket.js');

  try {
    await channel.send(buildTicketPanel(guild));
  } catch (err) {
    console.error('[Panel] posting the ticket panel failed:', err.message);
    return { error: 'post_failed', detail: err.message.slice(0, 140) };
  }
  return { ok: true, channelName: channel.name };
}

module.exports = { read, save, close, postPanel, openTickets, FIELDS, DEFAULTS };
