'use strict';

/**
 * web/desk.js — Channel Desk backend for the control panel Overview.
 * Isolated from leveling, composer templates, and moderation writes.
 */

const { PermissionFlagsBits, ChannelType } = require('discord.js');

function meMember(guild) {
  return guild.members.me || null;
}

function canRead(channel, me) {
  if (!channel || !me) return false;
  try {
    const perms = channel.permissionsFor(me);
    return !!(perms && perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.ReadMessageHistory));
  } catch {
    return false;
  }
}

function canSend(channel, me) {
  if (!channel || !me) return false;
  try {
    const perms = channel.permissionsFor(me);
    return !!(perms && perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages));
  } catch {
    return false;
  }
}

function isDeskChannel(ch) {
  if (!ch || ch.isThread?.()) return false;
  if (typeof ch.isTextBased === 'function' && !ch.isTextBased()) return false;
  // Skip pure voice; allow announcement/text/forum threads are already skipped
  if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) return false;
  return true;
}

function serializeMessage(m) {
  const author = m.author;
  return {
    id: m.id,
    content: String(m.content || '').slice(0, 2000),
    createdAt: m.createdTimestamp || Date.now(),
    author: {
      id: author?.id || null,
      name: m.member?.displayName || author?.globalName || author?.username || 'Unknown',
      avatar: (typeof author?.displayAvatarURL === 'function'
        ? author.displayAvatarURL({ extension: 'png', size: 64 })
        : null),
      bot: !!author?.bot,
    },
    attachments: m.attachments?.size || 0,
    embeds: Array.isArray(m.embeds) ? m.embeds.length : 0,
    referenceId: m.reference?.messageId || null,
  };
}

async function listChannels(guild) {
  if (!guild) return { error: 'no_guild' };
  let me = meMember(guild);
  if (!me) {
    try { me = await guild.members.fetchMe(); } catch { me = null; }
  }
  const channels = [];
  for (const ch of guild.channels.cache.values()) {
    if (!isDeskChannel(ch)) continue;
    if (!canRead(ch, me)) continue;
    channels.push({
      id: ch.id,
      name: ch.name,
      category: ch.parent?.name || null,
      canSend: canSend(ch, me),
    });
  }
  channels.sort((a, b) => {
    const ca = (a.category || 'zzz').toLowerCase();
    const cb = (b.category || 'zzz').toLowerCase();
    if (ca !== cb) return ca.localeCompare(cb);
    return a.name.localeCompare(b.name);
  });
  return { channels };
}

async function history(guild, channelId, opts = {}) {
  if (!guild) return { error: 'no_guild' };
  if (!/^\d{5,25}$/.test(String(channelId || ''))) return { error: 'bad_channel' };

  let ch = guild.channels.cache.get(channelId);
  if (!ch) {
    try { ch = await guild.channels.fetch(channelId); } catch { ch = null; }
  }
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };

  let me = meMember(guild);
  if (!me) {
    try { me = await guild.members.fetchMe(); } catch { me = null; }
  }
  if (!canRead(ch, me)) return { error: 'no_access' };

  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 50));
  const after = opts.after && /^\d{5,25}$/.test(String(opts.after)) ? String(opts.after) : null;

  const fetchOpts = { limit };
  if (after) fetchOpts.after = after;

  let col;
  try {
    col = await ch.messages.fetch(fetchOpts);
  } catch (err) {
    console.warn('[desk] fetch failed:', err.message || err);
    return { error: 'fetch_failed', detail: String(err.message || err).slice(0, 140) };
  }

  const messages = [...col.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(serializeMessage);

  return {
    channelId: ch.id,
    channelName: ch.name,
    messages,
    canSend: canSend(ch, me),
  };
}

async function sendAsBot(guild, channelId, body = {}) {
  if (!guild) return { error: 'no_guild' };
  if (!/^\d{5,25}$/.test(String(channelId || ''))) return { error: 'bad_channel' };

  const text = String(body.content || '').trim().slice(0, 2000);
  if (!text) return { error: 'empty_message' };

  let ch = guild.channels.cache.get(channelId);
  if (!ch) {
    try { ch = await guild.channels.fetch(channelId); } catch { ch = null; }
  }
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };

  let me = meMember(guild);
  if (!me) {
    try { me = await guild.members.fetchMe(); } catch { me = null; }
  }
  if (!canSend(ch, me)) return { error: 'cannot_send' };

  const replyTo = body.replyTo && /^\d{5,25}$/.test(String(body.replyTo))
    ? String(body.replyTo)
    : null;

  const payload = { content: text };
  if (replyTo) {
    payload.reply = { messageReference: replyTo, failIfNotExists: false };
  }

  try {
    const msg = await ch.send(payload);
    return { ok: true, message: serializeMessage(msg) };
  } catch (err) {
    console.warn('[desk] send failed:', err.message || err);
    return { error: 'send_failed', detail: String(err.message || err).slice(0, 140) };
  }
}

module.exports = { listChannels, history, sendAsBot };
