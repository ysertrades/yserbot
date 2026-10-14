'use strict';

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
  } catch {}
  return {
    id: m.id,
    content: m.content || '',
    createdAt: m.createdTimestamp || null,
    author: author
      ? { id: author.id, name: author.username || author.globalName || 'Unknown', avatar: author.displayAvatarURL?.({ size: 64 }) || null }
      : { id: '', name: 'Unknown', avatar: null },
    attachments,
  };
}

async function resolveChannel(guild, channelId) {
  try {
    return guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId);
  } catch {
    return null;
  }
}

async function resolveMe(guild) {
  try {
    return guild.members.me || await guild.members.fetchMe();
  } catch {
    return meMember(guild);
  }
}

async function listChannels(guild) {
  const me = await resolveMe(guild);
  const channels = [];
  for (const ch of guild.channels.cache.values()) {
    if (!isDeskChannel(ch)) continue;
    if (!canRead(ch, me)) continue;
    const isForum = ch.type === ChannelType.GuildForum;
    channels.push({
      id: ch.id,
      name: ch.name,
      category: isForum ? (ch.name || 'Forum') : (ch.parent?.name || null),
      categoryId: isForum ? ch.id : (ch.parentId || null),
      position: typeof ch.rawPosition === 'number' ? ch.rawPosition : (ch.position || 0),
      canSend: canSend(ch, me),
      isForum: !!isForum,
    });
  }
  channels.sort((a, b) => {
    if (a.isForum !== b.isForum) return a.isForum ? 1 : -1;
    const ca = (a.category || '').toLowerCase();
    const cb = (b.category || '').toLowerCase();
    if (ca !== cb) return ca.localeCompare(cb);
    return (a.name || '').localeCompare(b.name || '');
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
  try {
    const deleted = await ch.bulkDelete(amount, true);
    return { ok: true, deleted: deleted.size };
  } catch (err) {
    console.warn('[desk] purge failed:', err.message || err);
    return { error: 'purge_failed', detail: String(err.message || err).slice(0, 140) };
  }
}

async function forwardMessage(guild, targetChannelId, body = {}) {
  if (!guild) return { error: 'no_guild' };
  const sourceChannelId = body.sourceChannelId || body.fromChannelId;
  const messageId = body.messageId;
  const note = body.note || body.content || '';
  if (!/^\d{5,25}$/.test(String(targetChannelId || ''))) return { error: 'bad_channel' };
  if (!/^\d{5,25}$/.test(String(sourceChannelId || ''))) return { error: 'source_not_found' };
  if (!/^\d{5,25}$/.test(String(messageId || ''))) return { error: 'bad_message' };
  const sourceCh = await resolveChannel(guild, sourceChannelId);
  if (!sourceCh || !isDeskChannel(sourceCh)) return { error: 'source_not_found' };
  const targetCh = await resolveChannel(guild, targetChannelId);
  if (!targetCh || !isDeskChannel(targetCh)) return { error: 'not_found' };
  const me = await resolveMe(guild);
  if (!canRead(sourceCh, me)) return { error: 'no_access' };
  if (!canSend(targetCh, me)) return { error: 'no_permission' };
  try {
    const m = await sourceCh.messages.fetch(String(messageId));
    const refType = (MessageReferenceType && MessageReferenceType.Forward) || 1;
    const payload = {
      messageReference: {
        messageId: m.id,
        channelId: sourceCh.id,
        guildId: guild.id,
        type: refType,
      },
    };
    const noteText = String(note || '').trim();
    if (noteText) payload.content = noteText.slice(0, 500);
    const sent = await targetCh.send(payload);
    return { ok: true, message: serializeMessage(sent) };
  } catch (err) {
    console.warn('[desk] forward failed:', err.message || err);
    return { error: 'forward_failed', detail: String(err.message || err).slice(0, 140) };
  }
}

async function sendAsBot(guild, channelId, body = {}) {
  if (!guild) return { error: 'no_guild' };
  if (!/^\d{5,25}$/.test(String(channelId || ''))) return { error: 'bad_channel' };
  const action = String(body.action || 'send').toLowerCase();
  if (action === 'delete') return deleteMessage(guild, channelId, body.messageId);
  if (action === 'purge' || action === 'purgeuser') return purgeMessages(guild, channelId, body);
  if (action === 'forward') return forwardMessage(guild, channelId, body);
  const ch = await resolveChannel(guild, channelId);
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };
  const me = await resolveMe(guild);
  if (!canSend(ch, me)) return { error: 'no_permission' };
  const text = String(body.content || '').trim();
  if (!text) return { error: 'empty' };
  const replyTo = body.replyTo && /^\d{5,25}$/.test(String(body.replyTo))
    ? String(body.replyTo)
    : null;
  const payload = { content: text.slice(0, 2000) };
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
module.exports.fetchMessages = module.exports.history;
module.exports.sendMessage = module.exports.sendAsBot;
