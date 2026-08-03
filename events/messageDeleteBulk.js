'use strict';

const { Events } = require('discord.js');
const { forget: forgetPosts } = require('../utils/panelPosts');

/**
 * Bulk deletes — /purge, and Discord's own "delete messages" on a channel.
 *
 * These do not fire MessageDelete per message, so without this a purge that
 * swept up a Composer post would leave its row in "Already posted" until the
 * next sweep noticed. One write for the whole batch rather than one per
 * message, since they all belong to the same guild.
 */
module.exports = {
  name: Events.MessageBulkDelete,
  async execute(messages, channel) {
    try {
      const guildId = channel?.guildId || channel?.guild?.id
        || messages?.first?.()?.guildId || messages?.first?.()?.guild?.id;
      if (!guildId) return;

      const ids = [...messages.keys()];
      if (ids.length) forgetPosts(guildId, ids);
    } catch { /* the sweep on the next panel read will catch whatever this missed */ }
  },
};
