'use strict';

const { readJson } = require('./jsonStorage');
const messageStyle = require('./messageStyle');
const { colorFor } = require('./modEmbed');

const ACTION_ICON = {
  ban:    '🔨', kick:   '👢', mute:   '🔇',
  warn:   '⚠️',  unmute: '🔊', unban:  '🔓',
};

// How an action reads inside a sentence — "You have been **banned** in …".
// Kept apart from the icons because the two are used in different places, and
// a server can now reword the sentence around them from the panel.
const ACTION_WORD = {
  ban: 'banned', kick: 'kicked', mute: 'timed out',
  warn: 'warned', unmute: 'un-muted', unban: 'unbanned',
};

const BLANK = '​';

/**
 * Send to the guild's configured mod-log channel.
 *
 * The layout is fixed on purpose — User, Moderator, Reason, in that order,
 * every time — because this is the record, and a record you have to read
 * differently each time is not much of one. What a server can change, from
 * the panel's Appearance screen, is the heading, the footer, the thumbnail
 * and the timestamp.
 */
async function sendModLog(guild, action, targetUser, moderator, reason, extra = {}) {
  const config = readJson('config.json', {});
  const channelId = config[guild.id]?.logsChannel;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const fields = [
    { name: 'User',      value: `<@${targetUser.id}> \`${targetUser.tag}\``, inline: true },
    { name: 'Moderator', value: `<@${moderator.id}>`,                        inline: true },
    { name: BLANK,       value: BLANK,                                       inline: true },
    { name: 'Reason',    value: reason,                                      inline: false },
  ];
  if (extra.duration) fields.push({ name: 'Duration', value: extra.duration, inline: true });

  const embed = messageStyle.build(guild.id, 'log.action', {
    fields,
    thumbnailURL: targetUser.displayAvatarURL ? targetUser.displayAvatarURL() : null,
    tokens: {
      action: `${ACTION_ICON[action] ?? '📋'} ${action}`,
      server: guild.name,
      user: targetUser.tag,
      moderator: moderator.tag || moderator.id,
      reason,
      case: extra.caseId ?? '',
      duration: extra.duration ?? '',
    },
  });
  if (!embed) return;

  // The colour follows the action's own card, so one change in the panel
  // covers the card, this entry and the DM rather than leaving three separate
  // colours to keep in step by hand.
  try { embed.setColor(colorFor(guild.id, action)); } catch {}

  await channel.send({ embeds: [embed] }).catch(() => {});
}

/** DM the affected user a creative, informative embed. */
async function dmUser(targetUser, action, guild, reason, extra = {}) {
  const fields = [{ name: '📋 Reason', value: reason, inline: false }];
  if (extra.duration) fields.push({ name: '⏱️ Duration', value: extra.duration, inline: true });
  if (extra.caseId)   fields.push({ name: '🗂️ Case',    value: `#${extra.caseId}`, inline: true });

  const embed = messageStyle.build(guild.id, 'dm.action', {
    fields,
    thumbnailURL: guild.iconURL?.({ dynamic: true }) ?? null,
    tokens: {
      action: ACTION_WORD[action] ?? 'moderated',
      server: guild.name,
      user: targetUser.tag,
      reason,
      case: extra.caseId ?? '',
      duration: extra.duration ?? '',
    },
  });
  if (!embed) return;

  try { embed.setColor(colorFor(guild.id, action)); } catch {}

  await targetUser.send({ embeds: [embed] }).catch(() => {});
}

// Message IDs that some other code path (auto-mod filters, /purge) already
// deleted and logged its own way, so the generic passive message-delete
// listener doesn't post a second, redundant entry for the same message.
if (!global.suppressDeleteLog) global.suppressDeleteLog = new Set();
function suppressDeleteLog(messageId) {
  global.suppressDeleteLog.add(messageId);
  setTimeout(() => global.suppressDeleteLog.delete(messageId), 60_000);
}
function isDeleteLogSuppressed(messageId) {
  return global.suppressDeleteLog.has(messageId);
}

/** Post an already-built embed straight to the guild's mod-log channel —
 *  used by passive logging (message edits/deletes, joins/leaves, role
 *  changes, purges, auto-mod actions) that don't fit the fixed
 *  User/Moderator/Reason layout `sendModLog` uses for manual actions. */
async function postCustomLog(guild, embed, components = []) {
  const config    = readJson('config.json', {});
  const channelId = config[guild.id]?.logsChannel;
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return null;
  return channel.send({ embeds: [embed], components }).catch(() => null);
}

module.exports = { sendModLog, dmUser, postCustomLog, suppressDeleteLog, isDeleteLogSuppressed };
