'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');
const { generateFishImage } = require('../../utils/fishVisual');

const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const fmt = n => Number(n).toLocaleString();

// Weighted so junk/common dominate and legendary is a real rarity — the
// coin range on each entry is the "creative" part users are chasing.
const CATCHES = [
  { name: 'Old Boot',              rarity: 'junk',      weight: 18, min: 0,   max: 15 },
  { name: 'Rusty Can',              rarity: 'junk',      weight: 16, min: 0,   max: 15 },
  { name: 'Tangled Seaweed',        rarity: 'junk',      weight: 14, min: 5,   max: 25 },
  { name: 'Broken Bottle',          rarity: 'junk',      weight: 12, min: 0,   max: 10 },
  { name: 'Minnow',                 rarity: 'common',    weight: 18, min: 30,  max: 80 },
  { name: 'Bluegill Bass',          rarity: 'common',    weight: 14, min: 50,  max: 110 },
  { name: 'Catfish',                rarity: 'common',    weight: 10, min: 60,  max: 130 },
  { name: 'Rainbow Trout',          rarity: 'uncommon',  weight: 8,  min: 120, max: 220 },
  { name: 'Silver Salmon',          rarity: 'uncommon',  weight: 6,  min: 150, max: 260 },
  { name: 'Golden Marlin',          rarity: 'rare',      weight: 3,  min: 300, max: 500 },
  { name: 'Great White Shark',      rarity: 'rare',      weight: 2,  min: 350, max: 550 },
  { name: 'Ancient Treasure Chest', rarity: 'legendary', weight: 1,  min: 700, max: 1200 },
];
const TOTAL_WEIGHT = CATCHES.reduce((s, c) => s + c.weight, 0);

function rollCatch() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const c of CATCHES) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return CATCHES[CATCHES.length - 1];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fish')
    .setDescription('Cast a line and see what you reel in (2 hour cooldown)'),

  async execute(interaction) {
    const userId  = interaction.user.id;
    const guildId = interaction.guild?.id;
    const cd = checkCooldown(userId, 'fish', COOLDOWN_MS);

    if (cd > 0) {
      const hours   = Math.floor(cd / 3600000);
      const minutes = Math.floor((cd % 3600000) / 60000);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('🎣 Line\'s Still Out')
          .setDescription(`You need to wait **${hours}h ${minutes}m** before fishing again.`)],
        ephemeral: true,
      });
    }

    const catchItem = rollCatch();
    let reward = Math.floor(Math.random() * (catchItem.max - catchItem.min + 1)) + catchItem.min;
    const boost = getEffect(userId, guildId, 'coin_boost');
    if (boost) reward = Math.floor(reward * 1.5);

    addCoins(userId, reward);
    setCooldown(userId, 'fish');

    const imageName = `fish_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateFishImage({ name: catchItem.name, rarity: catchItem.rarity, reward }), { name: imageName });

    const embed = new EmbedBuilder()
      .setColor(0x1D9BF0)
      .setTitle('🎣 Fishing')
      .setDescription(`**Balance:** ${fmt(getBalance(userId))} coins${boost ? '\n💰 *Coin Boost active — 1.5× earnings!*' : ''}`)
      .setImage(`attachment://${imageName}`);

    return interaction.reply({ embeds: [embed], files: [attachment] });
  },
};
