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
  if (!ch) return false;
  if (typeof ch.isThread === 'function' && ch.isThread()) {
    return true;
  }
  if (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice) return false;
  if (ch.type === ChannelType.GuildForum) return false;
  if (typeof ch.isTextBased === 'function' && !ch.isTextBased()) return false;
  return true;
}

function formatMentions(m) {
  let text = String(m.content || '');
  try {
    if (m.mentions && m.mentions.users) {
      for (const [id, user] of m.mentions.users) {
        const name = user.globalName || user.username || id;
        text = text.replace(new RegExp('<@!?' + id + '>', 'g'), '@' + name);
      }
    }
    if (m.mentions && m.mentions.roles) {
      for (const [id, role] of m.mentions.roles) {
        const name = role.name || id;
        text = text.replace(new RegExp('<@&' + id + '>', 'g'), '@' + name);
      }
    }
    if (m.mentions && m.mentions.channels) {
      for (const [id, ch] of m.mentions.channels) {
        const name = ch.name || id;
        text = text.replace(new RegExp('<#' + id + '>', 'g'), '#' + name);
      }
    }
    text = text.replace(/<@!?(\d{5,25})>/g, '@user');
    text = text.replace(/<@&(\d{5,25})>/g, '@role');
    text = text.replace(/<#(\d{5,25})>/g, '#channel');
  } catch {}
  return text;
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

  // Reply / forward context for the desk UI
  let refKind = null; // 'reply' | 'forward'
  let reference = null;
  try {
    const r = m.reference || null;
    const refType = r && (r.type === 1 || r.type === 'FORWARD' || String(r.type).toLowerCase() === 'forward')
      ? 'forward'
      : (r && (r.messageId || r.message_id) ? 'reply' : null);
    // MessageType.Reply === 19 in discord.js
    const isReplyType = m.type === 19 || m.type === 'REPLY' || String(m.type).toLowerCase() === 'reply';
    const isForwardType = m.type === 46 || m.type === 'FORWARD' || String(m.type).toLowerCase() === 'forward'
      || (m.flags && (typeof m.flags.has === 'function' ? false : false));
    if (refType === 'forward' || isForwardType) refKind = 'forward';
    else if (refType === 'reply' || isReplyType || m.referencedMessage) refKind = 'reply';

    if (r && (r.messageId || r.message_id || r.channelId || r.channel_id)) {
      reference = {
        messageId: String(r.messageId || r.message_id || ''),
        channelId: String(r.channelId || r.channel_id || ''),
        guildId: r.guildId || r.guild_id ? String(r.guildId || r.guild_id) : null,
        type: refKind || 'reply',
      };
    }
  } catch {}

  let repliedTo = null;
  try {
    const rm = m.referencedMessage || null;
    if (rm) {
      const ra = rm.author;
      repliedTo = {
        id: rm.id,
        content: formatMentions(rm).slice(0, 280),
        author: ra
          ? { id: ra.id, name: ra.username || ra.globalName || 'Unknown', avatar: ra.displayAvatarURL?.({ size: 32 }) || null }
          : { id: '', name: 'Unknown', avatar: null },
      };
    }
  } catch {}

  // Forward snapshots (Discord API message_snapshots / djs messageSnapshots)
  let forwardSnapshot = null;
  try {
    let snap = null;
    if (m.messageSnapshots && m.messageSnapshots.size) {
      snap = m.messageSnapshots.first();
    } else if (Array.isArray(m.messageSnapshots) && m.messageSnapshots.length) {
      snap = m.messageSnapshots[0];
    } else if (m.message_snapshots && m.message_snapshots.length) {
      snap = m.message_snapshots[0];
    }
    if (snap) {
      const sm = snap.message || snap;
      const sa = sm.author || (snap.author) || null;
      const sc = String(sm.content || '').slice(0, 400);
      forwardSnapshot = {
        content: sc,
        author: sa
          ? { id: sa.id || '', name: sa.username || sa.globalName || sa.name || 'Unknown' }
          : { id: '', name: 'Unknown' },
        timestamp: sm.timestamp || sm.createdTimestamp || null,
      };
      if (!refKind) refKind = 'forward';
    }
  } catch {}

  return {
    id: m.id,
    content: formatMentions(m),
    createdAt: m.createdTimestamp || null,
    author: author
      ? {
          id: author.id,
          name: author.username || author.globalName || 'Unknown',
          avatar: author.displayAvatarURL?.({ size: 64 }) || null,
          bot: !!(author.bot),
        }
      : { id: '', name: 'Unknown', avatar: null, bot: false },
    attachments,
    refKind: refKind,
    reference: reference,
    repliedTo: repliedTo,
    forwardSnapshot: forwardSnapshot,
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
    if (ch.type === ChannelType.GuildForum) continue;
    if (typeof ch.isThread === 'function' && ch.isThread()) continue;
    if (!isDeskChannel(ch)) continue;
    if (!canRead(ch, me)) continue;
    channels.push({
      id: ch.id,
      name: ch.name,
      category: (ch.parent && ch.parent.name) || null,
      categoryId: ch.parentId || null,
      position: typeof ch.rawPosition === 'number' ? ch.rawPosition : (ch.position || 0),
      canSend: canSend(ch, me),
      isForum: false,
      isThread: false,
    });
  }

  for (const forum of guild.channels.cache.values()) {
    if (forum.type !== ChannelType.GuildForum) continue;
    if (!canRead(forum, me)) continue;
    let active = null;
    try {
      active = await forum.threads.fetchActive();
    } catch (err) {
      console.warn('[desk] forum threads:', forum.name, err.message || err);
      continue;
    }
    const threads = active && active.threads ? [...active.threads.values()] : [];
    for (const th of threads) {
      if (!canRead(th, me)) continue;
      channels.push({
        id: th.id,
        name: th.name || 'post',
        category: forum.name || 'Forum',
        categoryId: forum.id,
        position: th.createdTimestamp || 0,
        canSend: canSend(th, me),
        isForum: true,
        isThread: true,
      });
    }
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
  // "Purge this user" used to fall through to a plain purge and delete the
  // last N messages from everybody.
  const userId = String(body.action || '').toLowerCase() === 'purgeuser' ? String(body.userId || '') : '';
  if (String(body.action || '').toLowerCase() === 'purgeuser' && !/^\d{5,25}$/.test(userId)) {
    return { error: 'bad_user' };
  }
  try {
    if (userId) {
      // Look back over the last 100 and take up to `amount` of theirs.
      const recent = await ch.messages.fetch({ limit: 100 });
      const theirs = [...recent.filter(m => m.author?.id === userId).values()].slice(0, amount);
      if (!theirs.length) return { ok: true, deleted: 0 };
      const deleted = await ch.bulkDelete(theirs, true);
      return { ok: true, deleted: deleted.size };
    }
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
    let sent = null;
    // Prefer native Message#forward (discord.js >= 14.18) — true Discord forward
    if (typeof m.forward === 'function') {
      sent = await m.forward(targetCh);
    } else {
      const refType = (MessageReferenceType && MessageReferenceType.Forward) || 1;
      sent = await targetCh.send({
        messageReference: {
          messageId: m.id,
          channelId: sourceCh.id,
          guildId: guild.id,
          type: refType,
        },
      });
    }
    // Optional note is a separate message after the forward (Discord UI style)
    const noteText = String(note || '').trim().slice(0, 500);
    if (noteText) {
      try {
        await targetCh.send({
          content: noteText,
          reply: { messageReference: sent.id, failIfNotExists: false },
          allowedMentions: { parse: ['users', 'roles'] },
        });
      } catch (noteErr) {
        console.warn('[desk] forward note failed:', noteErr.message || noteErr);
      }
    }
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
  // Users and roles can be pinged from the desk, @everyone/@here cannot — a
  // stray "@everyone" typed into the panel used to ping the whole server.
  const allowedMentions = { parse: ['users', 'roles'], repliedUser: true };
  const payload = { content: text.slice(0, 2000), allowedMentions };
  if (replyTo) {
    // discord.js v14 accepts either reply.messageReference or top-level messageReference
    payload.reply = { messageReference: replyTo, failIfNotExists: false };
    payload.messageReference = { messageId: replyTo, failIfNotExists: false };
  }
  try {
    const msg = await ch.send(payload);
    return { ok: true, message: serializeMessage(msg) };
  } catch (err) {
    console.warn('[desk] send failed:', err.message || err);
    // Retry without reply if the referenced message is gone
    if (replyTo) {
      try {
        const msg = await ch.send({ content: text.slice(0, 2000), allowedMentions });
        return { ok: true, message: serializeMessage(msg), warning: 'reply_target_missing' };
      } catch (err2) {
        return { error: 'send_failed', detail: String(err2.message || err2).slice(0, 140) };
      }
    }
    return { error: 'send_failed', detail: String(err.message || err).slice(0, 140) };
  }
}

module.exports = { listChannels, history, sendAsBot, deleteMessage, purgeMessages, forwardMessage };
module.exports.fetchMessages = module.exports.history;
module.exports.sendMessage = module.exports.sendAsBot;
