'use strict';

/**
 * web/desk.js — Channel Desk backend for the control panel Overview.
 * Isolated from leveling, composer templates, and moderation writes.
 */

const { PermissionFlagsBits, ChannelType } = require('discord.js');

let MessageReferenceType;
try {
  MessageReferenceType = require('discord.js').MessageReferenceType;
} catch {
  MessageReferenceType = { Default: 0, Forward: 1 };
}

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

function canManageMessages(channel, me) {
  if (!channel || !me) return false;
  try {
    const perms = channel.permissionsFor(me);
    return !!(perms && perms.has(PermissionFlagsBits.ManageMessages));
  } catch {
    return false;
  }
}

function isDeskChannel(ch) {
  if (!ch || ch.isThread?.()) return false;
  if (typeof ch.isTextBased === 'function' && !ch.isTextBased()) return false;
  if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) return false;
  return true;
}

function serializeMessage(m) {
  const author = m.author;
  const attachments = [];
  try {
    if (m.attachments && m.attachments.size) {
      for (const a of m.attachments.values()) {
        attachments.push({
          id: a.id,
          url: a.url || a.proxyURL || null,
          name: a.name || 'file',
          contentType: a.contentType || '',
          width: a.width || null,
          height: a.height || null,
          size: a.size || null,
        });
        if (attachments.length >= 8) break;
      }
    }
  } catch { /* ignore */ }

  const images = [];
  try {
    if (Array.isArray(m.embeds)) {
      for (const e of m.embeds) {
        const u = e.image?.url || e.thumbnail?.url || null;
        if (u) images.push({ url: u, name: 'embed' });
        if (images.length >= 4) break;
      }
    }
  } catch { /* ignore */ }

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
    attachments,
    images,
    embeds: Array.isArray(m.embeds) ? m.embeds.length : 0,
    referenceId: m.reference?.messageId || null,
  };
}

async function resolveChannel(guild, channelId) {
  let ch = guild.channels.cache.get(channelId);
  if (!ch) {
    try { ch = await guild.channels.fetch(channelId); } catch { ch = null; }
  }
  return ch;
}

async function resolveMe(guild) {
  let me = meMember(guild);
  if (!me) {
    try { me = await guild.members.fetchMe(); } catch { me = null; }
  }
  return me;
}

async function listChannels(guild) {
  if (!guild) return { error: 'no_guild' };
  const me = await resolveMe(guild);
  try { await guild.channels.fetch(); } catch { /* keep cache */ }
  const channels = [];
  for (const ch of guild.channels.cache.values()) {
    if (!isDeskChannel(ch)) continue;
    if (!canRead(ch, me)) continue;
    channels.push({
      id: ch.id,
      name: ch.name,
      category: ch.parent?.name || null,
      categoryId: ch.parentId || null,
      position: typeof ch.rawPosition === 'number' ? ch.rawPosition : (ch.position || 0),
      canSend: canSend(ch, me),
    });
  }
  channels.sort((a, b) => {
    const ca = (a.category || '\uffff').toLowerCase();
    const cb = (b.category || '\uffff').toLowerCase();
    if (ca !== cb) return ca < cb ? -1 : 1;
    if (a.position !== b.position) return a.position - b.position;
    return String(a.name).localeCompare(String(b.name));
  });
  return { channels };
}

async function history(guild, channelId, opts = {}) {
  if (!guild) return { error: 'no_guild' };
  if (!/^\d{5,25}$/.test(String(channelId || ''))) return { error: 'bad_channel' };

  const ch = await resolveChannel(guild, channelId);
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };

  const me = await resolveMe(guild);
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
    canManage: canManageMessages(ch, me),
  };
}

async function deleteMessage(guild, channelId, messageId) {
  if (!guild) return { error: 'no_guild' };
  if (!/^\d{5,25}$/.test(String(channelId || ''))) return { error: 'bad_channel' };
  if (!/^\d{5,25}$/.test(String(messageId || ''))) return { error: 'bad_message' };

  const ch = await resolveChannel(guild, channelId);
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };
  const me = await resolveMe(guild);
  if (!canManageMessages(ch, me) && !canSend(ch, me)) return { error: 'cannot_manage' };

  let msg;
  try {
    msg = await ch.messages.fetch(String(messageId));
  } catch {
    return { error: 'message_not_found' };
  }

  const isOwn = msg.author?.id && me?.id && msg.author.id === me.id;
  if (!isOwn && !canManageMessages(ch, me)) return { error: 'cannot_manage' };

  try {
    await msg.delete();
    return { ok: true, deletedId: String(messageId) };
  } catch (err) {
    console.warn('[desk] delete failed:', err.message || err);
    return { error: 'delete_failed', detail: String(err.message || err).slice(0, 140) };
  }
}

async function purgeMessages(guild, channelId, body = {}) {
  if (!guild) return { error: 'no_guild' };
  if (!/^\d{5,25}$/.test(String(channelId || ''))) return { error: 'bad_channel' };

  const ch = await resolveChannel(guild, channelId);
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };
  const me = await resolveMe(guild);
  if (!canManageMessages(ch, me)) return { error: 'cannot_manage' };

  const amount = Math.min(100, Math.max(1, Number(body.amount) || 10));
  const userId = body.userId && /^\d{5,25}$/.test(String(body.userId)) ? String(body.userId) : null;

  let col;
  try {
    col = await ch.messages.fetch({ limit: Math.min(100, userId ? 100 : amount) });
  } catch (err) {
    return { error: 'fetch_failed', detail: String(err.message || err).slice(0, 140) };
  }

  const twoWeeks = Date.now() - 14 * 24 * 60 * 60 * 1000;
  let list = [...col.values()].filter((m) => m.createdTimestamp > twoWeeks);
  if (userId) list = list.filter((m) => m.author?.id === userId);
  list = list.slice(0, amount);

  if (!list.length) return { ok: true, deleted: 0 };

  try {
    if (typeof ch.bulkDelete === 'function' && list.length > 1) {
      const deleted = await ch.bulkDelete(list, true);
      return { ok: true, deleted: deleted.size || list.length };
    }
    let n = 0;
    for (const m of list) {
      try { await m.delete(); n++; } catch { /* skip */ }
    }
    return { ok: true, deleted: n };
  } catch (err) {
    console.warn('[desk] purge failed:', err.message || err);
    return { error: 'purge_failed', detail: String(err.message || err).slice(0, 140) };
  }
}

/**
 * Native Discord forward — keeps video/images/embeds via message snapshot.
 * Optional note is bot text on the same message (for @user / @everyone).
 *
 * Uses REST message_reference.type = 1 (FORWARD) so a note never causes a
 * plain text-only send without the forwarded snapshot.
 */
async function forwardMessage(guild, targetChannelId, body = {}) {
  if (!guild) return { error: 'no_guild' };
  if (!/^\d{5,25}$/.test(String(targetChannelId || ''))) return { error: 'bad_channel' };

  const messageId = String(body.messageId || '');
  const sourceChannelId = String(body.sourceChannelId || '');
  if (!/^\d{5,25}$/.test(messageId) || !/^\d{5,25}$/.test(sourceChannelId)) {
    return { error: 'bad_message' };
  }

  const note = String(body.content || '').trim().slice(0, 2000);

  const sourceCh = await resolveChannel(guild, sourceChannelId);
  if (!sourceCh || !isDeskChannel(sourceCh)) return { error: 'source_not_found' };

  const targetCh = await resolveChannel(guild, targetChannelId);
  if (!targetCh || !isDeskChannel(targetCh)) return { error: 'not_found' };

  const me = await resolveMe(guild);
  if (!canRead(sourceCh, me)) return { error: 'no_access' };
  if (!canSend(targetCh, me)) return { error: 'cannot_send' };

  let sourceMsg;
  try {
    sourceMsg = await sourceCh.messages.fetch(messageId);
  } catch {
    return { error: 'message_not_found' };
  }

  const restBody = {
    message_reference: {
      type: 1,
      message_id: sourceMsg.id,
      channel_id: sourceCh.id,
      guild_id: guild.id,
    },
    allowed_mentions: { parse: ['users', 'roles', 'everyone'] },
  };
  if (note) restBody.content = note;

  try {
    const client = targetCh.client;
    const raw = await client.rest.post(`/channels/${targetCh.id}/messages`, { body: restBody });
    let msg = null;
    try {
      msg = targetCh.messages.cache.get(raw.id) || await targetCh.messages.fetch(raw.id);
    } catch {
      msg = null;
    }
    if (msg) return { ok: true, message: serializeMessage(msg) };
    return {
      ok: true,
      message: {
        id: raw.id,
        content: String(raw.content || note || '').slice(0, 2000),
        createdAt: raw.timestamp ? Date.parse(raw.timestamp) : Date.now(),
        author: {
          id: raw.author?.id || me?.id || null,
          name: raw.author?.global_name || raw.author?.username || 'Quantbot',
          avatar: null,
          bot: true,
        },
        attachments: [],
        images: [],
        embeds: Array.isArray(raw.embeds) ? raw.embeds.length : 0,
        referenceId: raw.message_reference?.message_id || sourceMsg.id,
      },
    };
  } catch (err) {
    console.warn('[desk] forward REST failed:', err.message || err);
  }

  // Fallback: snapshot via Message#forward, then note as a reply to that forward
  try {
    if (typeof sourceMsg.forward === 'function') {
      const msg = await sourceMsg.forward(targetCh);
      if (note) {
        try {
          await targetCh.send({
            content: note,
            reply: { messageReference: msg.id, failIfNotExists: false },
            allowedMentions: { parse: ['users', 'roles', 'everyone'] },
          });
        } catch (noteErr) {
          console.warn('[desk] forward note reply failed:', noteErr.message || noteErr);
        }
      }
      return { ok: true, message: serializeMessage(msg) };
    }
  } catch (err2) {
    console.warn('[desk] forward() failed:', err2.message || err2);
    return { error: 'forward_failed', detail: String(err2.message || err2).slice(0, 140) };
  }

  return { error: 'forward_failed', detail: 'Native forward unavailable' };
}

async function sendAsBot(guild, channelId, body = {}) {
  if (!guild) return { error: 'no_guild' };
  if (!/^\d{5,25}$/.test(String(channelId || ''))) return { error: 'bad_channel' };

  const action = String(body.action || 'send').toLowerCase();

  if (action === 'delete') {
    return deleteMessage(guild, channelId, body.messageId);
  }
  if (action === 'purge' || action === 'purgeuser') {
    return purgeMessages(guild, channelId, body);
  }
  if (action === 'forward') {
    return forwardMessage(guild, channelId, body);
  }

  const text = String(body.content || '').trim().slice(0, 2000);
  if (!text) return { error: 'empty_message' };

  const ch = await resolveChannel(guild, channelId);
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };

  const me = await resolveMe(guild);
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

module.exports = { listChannels, history, sendAsBot, deleteMessage, purgeMessages, forwardMessage };
