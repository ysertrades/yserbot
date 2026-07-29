'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { addCoins, getBalance, checkCooldown, setCooldown } = require('../../utils/economyManager');
const { getEffect } = require('../../utils/effectsManager');
const { generateMineImage } = require('../../utils/mineVisual');

const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const fmt = n => Number(n).toLocaleString();

const FINDS = [
  { name: 'Loose Pebble',      rarity: 'junk',      weight: 18, min: 0,   max: 15 },
  { name: 'Chunk of Coal',     rarity: 'junk',      weight: 16, min: 5,   max: 20 },
  { name: 'Cracked Rock',      rarity: 'junk',      weight: 14, min: 0,   max: 10 },
  { name: 'Iron Ore',          rarity: 'common',     weight: 18, min: 30,  max: 90 },
  { name: 'Copper Ore',        rarity: 'common',     weight: 14, min: 40,  max: 100 },
  { name: 'Tin Ore',           rarity: 'common',     weight: 10, min: 35,  max: 95 },
  { name: 'Silver Vein',       rarity: 'uncommon',   weight: 8,  min: 120, max: 230 },
  { name: 'Gold Nugget',       rarity: 'uncommon',   weight: 6,  min: 160, max: 280 },
  { name: 'Emerald',           rarity: 'rare',       weight: 3,  min: 300, max: 500 },
  { name: 'Diamond',           rarity: 'rare',       weight: 2,  min: 380, max: 600 },
  { name: 'Ancient Relic',     rarity: 'legendary',  weight: 1,  min: 700, max: 1200 },
];
const TOTAL_WEIGHT = FINDS.reduce((s, f) => s + f.weight, 0);

function rollFind() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const f of FINDS) {
    r -= f.weight;
    if (r <= 0) return f;
  }
  return FINDS[FINDS.length - 1];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mine')
    .setDescription('Swing your pickaxe and see what you dig up (2 hour cooldown)'),

  async execute(interaction) {
    const userId  = interaction.user.id;
    const guildId = interaction.guild?.id;
    const cd = checkCooldown(userId, 'mine', COOLDOWN_MS);

    if (cd > 0) {
      const hours   = Math.floor(cd / 3600000);
      const minutes = Math.floor((cd % 3600000) / 60000);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xe74c3c)
          .setTitle('⛏️ Pickaxe Needs Rest')
          .setDescription(`You need to wait **${hours}h ${minutes}m** before mining again.`)],
        ephemeral: true,
      });
    }

    const find = rollFind();
    let reward = Math.floor(Math.random() * (find.max - find.min + 1)) + find.min;
    const boost = getEffect(userId, guildId, 'coin_boost');
    if (boost) reward = Math.floor(reward * 1.5);

    addCoins(userId, reward);
    setCooldown(userId, 'mine');

    const imageName = `mine_${Date.now()}.png`;
    const attachment = new AttachmentBuilder(generateMineImage({ name: find.name, rarity: find.rarity, reward }), { name: imageName });

    const embed = new EmbedBuilder()
      .setColor(0xB98A46)
      .setTitle('⛏️ Mining')
      .setDescription(`**Balance:** ${fmt(getBalance(userId))} coins${boost ? '\n💰 *Coin Boost active — 1.5× earnings!*' : ''}`)
      .setImage(`attachment://${imageName}`);

    return interaction.reply({ embeds: [embed], files: [attachment] });
  },
};
