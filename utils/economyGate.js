'use strict';

/**
 * economyGate.js
 *
 * The one place a switched-off economy command says so.
 *
 * Kept apart from economySettings.js so that module stays free of discord.js
 * and can be reasoned about — and tested — as plain data.
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const { ACTIVITIES, isEnabled } = require('./economySettings');

/**
 * Refuses the interaction when the server has this activity switched off.
 *
 * Deliberately ephemeral and deliberately not apologetic: it is a choice the
 * server made, not a fault, and it should not leave a message in the channel.
 *
 * @returns {Promise<boolean>} true when it replied and the caller must stop
 */
async function refuseIfOff(interaction, key) {
  const guildId = interaction.guild?.id;
  // Outside a guild there is nobody to have switched it off.
  if (!guildId || isEnabled(guildId, key)) return false;

  const a = ACTIVITIES[key];
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x6b7280)
      .setTitle(`${a.emoji}  ${a.label} is closed`)
      .setDescription(`\`${a.command}\` is switched off in this server.`)],
    flags: MessageFlags.Ephemeral,
  }).catch(() => {});
  return true;
}

module.exports = { refuseIfOff };
