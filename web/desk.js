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

async function listChannels(guild) {
  const me = meMember(guild);
  const channels = [];
  for (const ch of guild.channels.cache.values()) {
    if (!isDeskChannel(ch)) continue;
    const isForum = ch.type === ChannelType.GuildForum;
    channels.push({
      id: ch.id,
      name: ch.name || 'channel',
      category: isForum ? (ch.name || 'Forum') : (ch.parent?.name || null),
      categoryId: isForum ? ch.id : (ch.parentId || null),
      canRead: canRead(ch, me),
      canSend: canSend(ch, me),
      canManage: canManageMessages(ch, me),
      isForum: !!isForum,
      type: ch.type,
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

async function fetchMessages(guild, channelId, limit = 40) {
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };
  const me = meMember(guild);
  if (!canRead(ch, me)) return { error: 'no_permission' };
  try {
    const msgs = await ch.messages.fetch({ limit: Math.min(50, Math.max(1, limit)) });
    const list = [];
    for (const m of msgs.values()) {
      list.push(serializeMessage(m));
      if (list.length >= limit) break;
    }
    list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return { messages: list, channelId };
  } catch (e) {
    return { error: 'fetch_failed', detail: String(e && e.message || e) };
  }
}

async function sendMessage(guild, channelId, content) {
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };
  const me = meMember(guild);
  if (!canSend(ch, me)) return { error: 'no_permission' };
  const text = String(content || '').trim();
  if (!text) return { error: 'empty' };
  try {
    const m = await ch.send({ content: text.slice(0, 2000) });
    return { ok: true, message: serializeMessage(m) };
  } catch (e) {
    return { error: 'send_failed', detail: String(e && e.message || e) };
  }
}

async function deleteMessage(guild, channelId, messageId) {
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };
  const me = meMember(guild);
  if (!canManageMessages(ch, me)) return { error: 'no_permission' };
  try {
    const m = await ch.messages.fetch(messageId);
    await m.delete();
    return { ok: true };
  } catch (e) {
    return { error: 'delete_failed', detail: String(e && e.message || e) };
  }
}

async function forwardMessage(guild, sourceChannelId, messageId, targetChannelId, note) {
  const sourceCh = guild.channels.cache.get(sourceChannelId);
  if (!sourceCh || !isDeskChannel(sourceCh)) return { error: 'source_not_found' };
  const targetCh = guild.channels.cache.get(targetChannelId);
  if (!targetCh || !isDeskChannel(targetCh)) return { error: 'not_found' };
  const me = meMember(guild);
  if (!canRead(sourceCh, me)) return { error: 'no_permission' };
  if (!canSend(targetCh, me)) return { error: 'no_permission' };
  try {
    const m = await sourceCh.messages.fetch(messageId);
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
  } catch (e) {
    return { error: 'forward_failed', detail: String(e && e.message || e) };
  }
}

async function replyMessage(guild, channelId, messageId, content) {
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !isDeskChannel(ch)) return { error: 'not_found' };
  const me = meMember(guild);
  if (!canSend(ch, me)) return { error: 'no_permission' };
  const text = String(content || '').trim();
  if (!text) return { error: 'empty' };
  try {
    const m = await ch.messages.fetch(messageId);
    const sent = await m.reply({ content: text.slice(0, 2000) });
    return { ok: true, message: serializeMessage(sent) };
  } catch (e) {
    return { error: 'reply_failed', detail: String(e && e.message || e) };
  }
}

module.exports = {
  listChannels,
  fetchMessages,
  sendMessage,
  deleteMessage,
  forwardMessage,
  replyMessage,
  isDeskChannel,
};
