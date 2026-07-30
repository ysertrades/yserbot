'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');
const { generateWorkResultImage, generateWorkCooldownImage } = require('../../utils/workVisual');

const WORK_COOLDOWN = 60 * 60 * 1000;
const MIN_EARNINGS  = 50;
const MAX_EARNINGS  = 200;

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
    .setDescription('Work and earn coins (1 hour cooldown)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const cd     = checkCooldown(userId, 'work', WORK_COOLDOWN, interaction.guild?.id);

    if (cd > 0) {
      const hours   = Math.floor(cd / 3600000);
      const minutes = Math.floor((cd % 3600000) / 60000);
      const nextTs  = Math.floor((Date.now() + cd) / 1000);

      const imageName  = `work_cooldown_${Date.now()}.png`;
      const attachment = new AttachmentBuilder(generateWorkCooldownImage({ hours, minutes }), { name: imageName });
      const embed = new EmbedBuilder().setImage(`attachment://${imageName}`).setDescription(`Available again <t:${nextTs}:R>.`);

      return interaction.reply({ embeds: [embed], files: [attachment], flags: MessageFlags.Ephemeral });
    }

    let earnings = Math.floor(Math.random() * (MAX_EARNINGS - MIN_EARNINGS + 1)) + MIN_EARNINGS;
    const boost  = getEffect(userId, interaction.guild?.id, 'coin_boost');
    if (boost) earnings = Math.floor(earnings * (boost.multiplier || 1.5));

    const task = TASKS[Math.floor(Math.random() * TASKS.length)];
    addCoins(userId, earnings);
    setCooldown(userId, 'work');

    const nextTs = Math.floor((Date.now() + WORK_COOLDOWN) / 1000);
    const imageName  = `work_result_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateWorkResultImage({
      taskEmoji: task.emoji, task: task.text, earnings, boostActive: Boolean(boost),
    }), { name: imageName });
    const embed = new EmbedBuilder()
      .setImage(`attachment://${imageName}`)
      .setDescription(`💰 Balance: **${getBalance(userId).toLocaleString()}** coins · Next shift <t:${nextTs}:R>`);

    return interaction.reply({ embeds: [embed], files: [attachment] });
  },
};
