'use strict';

const { Events, EmbedBuilder } = require('discord.js');
const { getModLogSettings } = require('../utils/modConfig');
const { postCustomLog } = require('../utils/modLog');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage, client) {
    if (!newMessage.guild) return;
    // An invite edited in after posting is caught like a fresh one. This
    // runs even for messages the bot hadn't cached (the edit log can't).
    if (newMessage.partial) newMessage = await newMessage.fetch().catch(() => null);
    if (!newMessage || newMessage.author?.bot) return;
    if (!oldMessage.partial && oldMessage.content === newMessage.content) return; // embed unfurl / pin / reaction-only update
    try {
      const { isFeatureEnabled } = require('../utils/featureToggles');
      if (isFeatureEnabled(newMessage.guild.id, 'automod')
        && await client?.commands?.get('automod')?.handleMessage(newMessage, client, { edited: true })) return;
    } catch { /* filtering must never break the edit log */ }
    if (oldMessage.partial) return;

    const settings = getModLogSettings(newMessage.guild.id);
    if (!settings.messages) return;

    const trim = s => (s && s.length > 400 ? `${s.slice(0, 400)}…` : s) || '*(no text content)*';

    const embed = new EmbedBuilder()
      .setColor(0xF39C12)
      .setTitle('✏️ Message Edited')
      .addFields(
        { name: 'Author',  value: `${newMessage.author} \`${newMessage.author.tag}\``, inline: true },
        { name: 'Channel', value: `${newMessage.channel}`,                              inline: true },
        { name: 'Before',  value: trim(oldMessage.content), inline: false },
        { name: 'After',   value: trim(newMessage.content), inline: false },
      )
      .setURL(newMessage.url)
      .setTimestamp();

    await postCustomLog(newMessage.guild, embed);
  },
};
