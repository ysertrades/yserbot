'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');

const WORK_COOLDOWN = 60 * 60 * 1000;
const MIN_EARNINGS  = 50;
const MAX_EARNINGS  = 200;
const fmt = n => Number(n).toLocaleString();

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
    const cd     = checkCooldown(userId, 'work', WORK_COOLDOWN);

    if (cd > 0) {
      const hours   = Math.floor(cd / 3600000);
      const minutes = Math.floor((cd % 3600000) / 60000);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('⏰ Still on Cooldown')
        .setDescription(`You need to wait **${hours}h ${minutes}m** before you can work again.`)
        .setFooter({ text: 'Work again later!' })], ephemeral: true });
    }

    let earnings = Math.floor(Math.random() * (MAX_EARNINGS - MIN_EARNINGS + 1)) + MIN_EARNINGS;
    const boost  = getEffect(userId, interaction.guild?.id, 'coin_boost');
    if (boost) earnings = Math.floor(earnings * 1.5);

    const task = TASKS[Math.floor(Math.random() * TASKS.length)];
    addCoins(userId, earnings);
    setCooldown(userId, 'work');

    return interaction.reply({ embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Work Completed!')
      .setDescription(`${task.emoji} You ${task.text} and earned **${fmt(earnings)}** coins!${boost ? '\n💰 *Coin Boost active — 1.5× earnings!*' : ''}`)
      .addFields({ name: '💰 Balance', value: `**${fmt(getBalance(userId))}** coins`, inline: true })
      .setFooter({ text: 'Come back in 1 hour for more work' })
      .setTimestamp()] });
  },
};
