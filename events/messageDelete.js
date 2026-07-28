'use strict';

const { Events, EmbedBuilder } = require('discord.js');
const { getModLogSettings } = require('../utils/modConfig');
const { postCustomLog, isDeleteLogSuppressed } = require('../utils/modLog');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild || message.partial) return; // can't read content of an uncached (partial) message
    if (message.author?.bot) return;
    if (isDeleteLogSuppressed(message.id)) return; // already logged by auto-mod or /purge itself

    const settings = getModLogSettings(message.guild.id);
    if (!settings.messages) return;

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
