'use strict';

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { readJson } = require('../../utils/jsonStorage');
const { generateRankImage, tierColor } = require('../../utils/rankVisual');
const { getEquipped } = require('../../utils/badgeManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank').setDescription('Check your rank')
        .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(false)),
    async execute(interaction) {
        const user = interaction.options.getUser('user') || interaction.user;
        const levels = readJson('levels.json', {});
        const guildData = levels[interaction.guild.id] || { users: {}, settings: { baseXp: 100, multiplier: 1.5 } };
        const userData = guildData.users[user.id] || { xp: 0, level: 1, messages: 0, totalXp: 0 };
        const settings = guildData.settings || { baseXp: 100, multiplier: 1.5 };

        const neededXp = Math.floor(settings.baseXp * Math.pow(userData.level, settings.multiplier));

        const shop = readJson('shop.json', {});
        const shopItems = shop[interaction.guild.id]?.items || {};
        const equippedBadges = getEquipped(user.id, interaction.guild.id)
            .map(itemId => shopItems[itemId])
            .filter(Boolean)
            .map(item => ({ icon: item.badgeIcon, label: item.name }));

        const imageName = `rank_${user.id}_${Date.now()}.png`;
        const attachment = new AttachmentBuilder(generateRankImage({
            username: user.username,
            level: userData.level,
            xp: userData.xp,
            neededXp,
            totalXp: userData.totalXp || 0,
            messages: userData.messages || 0,
            equippedBadges,
        }), { name: imageName });

        const [r, g, b] = tierColor(userData.level);
        const embed = new EmbedBuilder()
            .setColor((r << 16) | (g << 8) | b)
            .setImage(`attachment://${imageName}`);

        await interaction.reply({ embeds: [embed], files: [attachment] });
    },
};
