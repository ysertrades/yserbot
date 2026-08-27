'use strict';

const { Events, EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getModLogSettings, getAutoModSettings, isAutoModExempt } = require('../utils/modConfig');
const { postCustomLog, isDeleteLogSuppressed } = require('../utils/modLog');
const { findBadWord } = require('../utils/badWords');
const { forget: forgetPosts } = require('../utils/panelPosts');

/**
 * Drops a deleted message from the Composer's "Already posted" list.
 *
 * Deliberately silent and never throwing: this is bookkeeping hung off an
 * event that exists to write a mod-log entry, and a storage hiccup here must
 * not cost the log its entry.
 */
function forgetPanelPosts(guildId, messageId) {
  try { forgetPosts(guildId, messageId); } catch { /* the sweep will catch it */ }
}

// Best-effort lookup of who actually deleted a message, via the audit log —
// the raw MessageDelete gateway event doesn't include the executor at all.
// Requires the bot to have "View Audit Log"; fails open (returns null) on
// any error so a lookup problem never blocks the log entry from posting.
async function findDeletionExecutor(guild, message) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 });
    const entry = logs.entries.find(e =>
      e.target?.id === message.author.id &&
      Date.now() - e.createdTimestamp < 5000,
    );
    return entry?.executor || null;
  } catch {
    return null;
  }
}

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    // Before every guard below, on purpose. A message the Composer posted is
    // the bot's own and is usually uncached by the time it is deleted, so it
    // fails both the partial check and the bot check — the two things that
    // would stop this from ever running.
    const guildId = message.guildId || message.guild?.id;
    if (guildId && message.id) forgetPanelPosts(guildId, message.id);

    if (!message.guild || message.partial) return; // can't read content of an uncached (partial) message
    if (message.author?.bot) return;
    if (isDeleteLogSuppressed(message.id)) return; // already logged by auto-mod or /purge itself

    const settings = getModLogSettings(message.guild.id);
    if (!settings.messages) return;

    // Staff manually cleaning up a bad-word message themselves isn't worth
    // logging — that's the whole point of them being able to moderate.
    if (message.content) {
      const autoModSettings = getAutoModSettings(message.guild.id);
      if (findBadWord(message.content, autoModSettings.customWords)) {
        const executor = await findDeletionExecutor(message.guild, message);
        if (executor) {
          const executorMember = message.guild.members.cache.get(executor.id)
            || await message.guild.members.fetch(executor.id).catch(() => null);
          if (executorMember && isAutoModExempt(executorMember)) return;
        }
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x95A5A6)
      .setTitle('🗑️ Message Deleted')
      .addFields(
        { name: 'Author',  value: message.author ? `${message.author} \`${message.author.tag}\`` : 'Unknown', inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Content', value: message.content ? (message.content.length > 500 ? `${message.content.slice(0, 500)}…` : message.content) : '*(no text content — embed/attachment only)*', inline: false },
      )
      .setTimestamp();

    await postCustomLog(message.guild, embed);
  },
};
