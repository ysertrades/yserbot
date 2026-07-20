'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, addCoins, removeCoins, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { hasEffect, setEffect } = require('../../utils/effectsManager');

const ROB_COOLDOWN  = 90 * 60 * 1000; // 1.5 hours
const SUCCESS_RATE  = 0.55;
const MIN_TARGET    = 200;
const MAX_STEAL     = 2500;
const fmt = n => Number(n).toLocaleString();

const WIN_LINES = [
  '🕵️ You blended into the crowd and vanished with the goods.',
  '🌙 Under the cover of darkness, you made your move flawlessly.',
  '🎭 A masterclass con job — they never knew what hit them.',
  '💨 In and out before they even blinked.',
  '🃏 Sleight of hand at its finest.',
  '🦊 Slick as a fox — they never saw it coming.',
  '🎯 Precision strike — right in the wallet.',
  '🧤 Clean hands, full pockets.',
];

const LOSE_LINES = [
  '🚨 Caught red-handed — the whole street saw you.',
  '🐕 Their guard dog had very different plans for you.',
  '📸 Security camera caught every second in 4K.',
  '🔔 You tripped the alarm on the way out.',
  '💪 Turns out they were a lot stronger than they looked.',
  '🤦 You dropped your own wallet while fleeing.',
  '🚔 Off-duty cop was right behind you.',
  '🎤 A witness livestreamed the whole thing.',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Attempt to rob another user\'s coins (55% success, 1.5h cooldown)')
    .addUserOption(o => o.setName('target').setDescription('Who to rob').setRequired(true)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const target = interaction.options.getUser('target');

    if (target.id === userId)
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('❌ Nice Try').setDescription('You can\'t rob yourself.')], ephemeral: true });
    if (target.bot)
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('❌ No Can Do').setDescription('Bots don\'t carry coins.')], ephemeral: true });

    const cd = checkCooldown(userId, 'rob', ROB_COOLDOWN);
    if (cd > 0) {
      const ts = Math.floor((Date.now() + cd) / 1000);
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xFF4757)
        .setTitle('⏳  Laying Low')
        .setDescription(`You're still on the run from your last job.\nTry again <t:${ts}:R>.`)], ephemeral: true });
    }

    // Check if target has an active rob shield
    if (hasEffect(target.id, interaction.guild.id, 'rob_shield')) {
      setCooldown(userId, 'rob');
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🛡️  Bounced Right Off!')
        .setDescription(`<@${target.id}> has an active **Rob Shield**!\nYou fled empty-handed — and that wasted your cooldown.`)
        .setFooter({ text: 'Next attempt in 1.5 hours' })] });
    }

    const targetBal = getBalance(target.id);
    if (targetBal < MIN_TARGET)
      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xFF4757)
        .setTitle('🪙  Not Worth the Risk')
        .setDescription(`<@${target.id}> only has **${fmt(targetBal)}** coins — not worth getting caught for.`)], ephemeral: true });

    setCooldown(userId, 'rob');
    const won = Math.random() < SUCCESS_RATE;

    if (won) {
      const pct    = 0.10 + Math.random() * 0.20;
      const stolen = Math.min(MAX_STEAL, Math.floor(targetBal * pct));
      removeCoins(target.id, stolen);
      addCoins(userId, stolen);
      const line = WIN_LINES[Math.floor(Math.random() * WIN_LINES.length)];

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('💰  Robbery Successful!')
        .setDescription(`*${line}*`)
        .addFields(
          { name: '🎯 Target',       value: `<@${target.id}>`,              inline: true },
          { name: '💸 Stolen',       value: `**${fmt(stolen)}** coins`,      inline: true },
          { name: '💰 Your Balance', value: `**${fmt(getBalance(userId))}** coins`, inline: true },
        )
        .setFooter({ text: 'Next heist in 1.5 hours  •  Stay out of trouble' })
        .setTimestamp()] });
    } else {
      const fine      = Math.min(1000, Math.floor(targetBal * 0.05));
      const actualFine = Math.min(fine, getBalance(userId));
      if (actualFine > 0) removeCoins(userId, actualFine);
      const line = LOSE_LINES[Math.floor(Math.random() * LOSE_LINES.length)];

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xE74C3C)
        .setTitle('🚔  Caught Red-Handed!')
        .setDescription(`*${line}*\n\nYou were fined **${fmt(actualFine)}** coins.`)
        .addFields(
          { name: '🎯 Target',       value: `<@${target.id}>`,              inline: true },
          { name: '💸 Fine Paid',    value: `**${fmt(actualFine)}** coins`,  inline: true },
          { name: '💰 Your Balance', value: `**${fmt(getBalance(userId))}** coins`, inline: true },
        )
        .setFooter({ text: 'Next attempt in 1.5 hours  •  Better luck next time' })
        .setTimestamp()] });
    }
  },
};
