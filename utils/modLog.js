'use strict';

const { EmbedBuilder } = require('discord.js');
const { readJson } = require('./jsonStorage');

const ACTION_COLOR = {
  ban:    0xe74c3c,
  kick:   0xe67e22,
  mute:   0xf39c12,
  warn:   0xf1c40f,
  unmute: 0x2ecc71,
  unban:  0x2ecc71,
};
const ACTION_ICON = {
  ban:    '🔨', kick:   '👢', mute:   '🔇',
  warn:   '⚠️',  unmute: '🔊', unban:  '🔓',
};
const USER_MSG = {
  ban:    'You have been **banned** from the server.',
  kick:   'You have been **kicked** from the server.',
  mute:   'You have been **timed out** in the server.',
  warn:   'You have received a **warning** in the server.',
  unmute: 'Your **timeout** has been lifted.',
  unban:  'You have been **unbanned** from the server.',
};

/** Send to the guild's configured mod-log channel. */
async function sendModLog(guild, action, targetUser, moderator, reason, extra = {}) {
  const config = readJson('config.json', {});
  const channelId = config[guild.id]?.logsChannel;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(ACTION_COLOR[action] ?? 0x95a5a6)
    .setAuthor({ name: `${ACTION_ICON[action] ?? '📋'} ${action.toUpperCase()}` })
    .addFields(
      { name: 'User',      value: `<@${targetUser.id}> \`${targetUser.tag}\``, inline: true },
      { name: 'Moderator', value: `<@${moderator.id}>`,                        inline: true },
      { name: '\u200b',    value: '\u200b',                                    inline: true },
      { name: 'Reason',    value: reason,                                      inline: false },
    )
    .setTimestamp();

  if (extra.duration) embed.addFields({ name: 'Duration', value: extra.duration, inline: true });
  if (extra.caseId)   embed.setFooter({ text: `Case #${extra.caseId}` });
  if (targetUser.displayAvatarURL) embed.setThumbnail(targetUser.displayAvatarURL());

  await channel.send({ embeds: [embed] }).catch(() => {});
}

/** DM the affected user a creative, informative embed. */
async function dmUser(targetUser, action, guild, reason, extra = {}) {
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLOR[action] ?? 0x95a5a6)
    .setTitle(`${ACTION_ICON[action] ?? '📋'} Action taken in ${guild.name}`)
    .setThumbnail(guild.iconURL({ dynamic: true }) ?? null)
    .setDescription(USER_MSG[action] ?? 'A moderation action was taken against you.')
    .addFields({ name: '📋 Reason', value: reason, inline: false })
    .setTimestamp()
    .setFooter({ text: 'If you believe this is a mistake, contact the server staff.' });

  if (extra.duration) embed.addFields({ name: '⏱️ Duration', value: extra.duration, inline: true });
  if (extra.caseId)   embed.addFields({ name: '🗂️ Case',    value: `#${extra.caseId}`, inline: true });

  await targetUser.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { sendModLog, dmUser };
