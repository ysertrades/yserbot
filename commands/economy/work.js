'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');
const { generateWorkResultImage, generateWorkCooldownImage } = require('../../utils/workVisual');
const { activity, scalePayout, boostNote } = require('../../utils/economySettings');
const { refuseIfOff } = require('../../utils/economyGate');

const TASKS = [
  { emoji: '💻', text: 'coded a Discord bot from scratch' },
  { emoji: '🍕', text: 'delivered 40 pizzas in record time' },
  { emoji: '📚', text: 'tutored students through exam season' },
  { emoji: '🎨', text: 'created artwork for a client' },
  { emoji: '🎵', text: 'performed live at an event' },
  { emoji: '⚡', text: 'fixed the city\'s electrical grid' },
  { emoji: '🧑‍💼', text: 'closed a big deal at the office' },
  { emoji: '🏗️', text: 'finished a construction project early' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work a shift and earn coins'),

  async execute(interaction) {
    if (await refuseIfOff(interaction, 'work')) return;

    const userId  = interaction.user.id;
    const guildId = interaction.guild?.id;
    const cfg     = activity(guildId, 'work');
    const cd      = checkCooldown(userId, 'work', cfg.cooldownMs, guildId);

    if (cd > 0) {
      const hours   = Math.floor(cd / 3600000);
      const minutes = Math.floor((cd % 3600000) / 60000);
      const nextTs  = Math.floor((Date.now() + cd) / 1000);

      const imageName  = `work_cooldown_${Date.now()}.png`;
      const attachment = new AttachmentBuilder(generateWorkCooldownImage({ hours, minutes }), { name: imageName });
      const embed = new EmbedBuilder().setImage(`attachment://${imageName}`).setDescription(`Available again <t:${nextTs}:R>.`);

      return interaction.reply({ embeds: [embed], files: [attachment], flags: MessageFlags.Ephemeral });
    }

    const span = Math.max(0, cfg.max - cfg.min);
    let earnings = Math.floor(Math.random() * (span + 1)) + cfg.min;
    const boost  = getEffect(userId, guildId, 'coin_boost');
    if (boost) earnings = Math.floor(earnings * (boost.multiplier || 1.5));
    // The server's own multiplier — and its boost hour, if one is running —
    // applied last, so it lifts whatever the member's own perks already gave.
    earnings = scalePayout(guildId, earnings);

    const task = TASKS[Math.floor(Math.random() * TASKS.length)];
    addCoins(userId, earnings);
    setCooldown(userId, 'work');

    const nextTs = Math.floor((Date.now() + cfg.cooldownMs) / 1000);
    const imageName  = `work_result_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateWorkResultImage({
      taskEmoji: task.emoji, task: task.text, earnings, boostActive: Boolean(boost),
    }), { name: imageName });
    const hour = boostNote(guildId);
    const embed = new EmbedBuilder()
      .setImage(`attachment://${imageName}`)
      .setDescription(`💰 Balance: **${getBalance(userId).toLocaleString()}** coins · Next shift <t:${nextTs}:R>${hour ? `\n${hour}` : ''}`);

    return interaction.reply({ embeds: [embed], files: [attachment] });
  },
};
