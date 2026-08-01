'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');
const { activity, scalePayout, boostNote } = require('../../utils/economySettings');
const { refuseIfOff } = require('../../utils/economyGate');
const { formatDuration } = require('../../utils/duration');

const fmt = n => Number(n).toLocaleString();

// Weighted so most days are a modest payout with a real shot at a
// standout day — mirrors the fish/mine rarity tables for a shared feel.
const TIERS = [
  { label: 'Another Day', emoji: '🪙', color: 0x95A5A6, weight: 55, min: 100, max: 300 },
  { label: 'Good Day',    emoji: '💵', color: 0x2ECC71, weight: 28, min: 300, max: 600 },
  { label: 'Great Day',   emoji: '💰', color: 0x3498DB, weight: 13, min: 600, max: 1000 },
  { label: 'Jackpot Day', emoji: '🎉', color: 0xF1C40F, weight: 4,  min: 1500, max: 2500 },
];
const TOTAL_WEIGHT = TIERS.reduce((s, t) => s + t.weight, 0);

function rollTier() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const t of TIERS) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return TIERS[0];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily coins'),

  async execute(interaction) {
    if (await refuseIfOff(interaction, 'daily')) return;

    const userId  = interaction.user.id;
    const guildId = interaction.guild?.id;
    const cfg     = activity(guildId, 'daily');
    const cd = checkCooldown(userId, 'daily', cfg.cooldownMs, guildId);

    if (cd > 0) {
      const hours   = Math.floor(cd / 3600000);
      const minutes = Math.floor((cd % 3600000) / 60000);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('⏰ Already Claimed')
          .setDescription(`You need to wait **${hours}h ${minutes}m** before claiming again.`)
          .setFooter({ text: `Daily rewards reset ${formatDuration(cfg.cooldownMs) || '24h'} after you claim them` })],
        flags: MessageFlags.Ephemeral,
      });
    }

    const tier = rollTier();
    let reward = Math.floor(Math.random() * (tier.max - tier.min + 1)) + tier.min;
    const boost = getEffect(userId, guildId, 'coin_boost');
    if (boost) reward = Math.floor(reward * (boost.multiplier || 1.5));
    reward = scalePayout(guildId, reward, cfg.payScale);

    addCoins(userId, reward);
    setCooldown(userId, 'daily');

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(tier.color)
        .setTitle(`${tier.emoji} ${tier.label}!`)
        .setDescription(`You claimed your daily reward and earned **${fmt(reward)}** coins!${boost ? `\n💰 *Coin Boost active — ${boost.multiplier || 1.5}× earnings!*` : ''}${boostNote(guildId) ? `\n${boostNote(guildId)}` : ''}`)
        .addFields({ name: '💰 Balance', value: `**${fmt(getBalance(userId))}** coins`, inline: true })
        .setFooter({ text: `Come back in ${formatDuration(cfg.cooldownMs) || '24h'} for more` })
        .setTimestamp()],
    });
  },
};
