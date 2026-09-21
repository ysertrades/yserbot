'use strict';

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { generateRankImage, tierColor } = require('../../utils/rankVisual');
const { getEquipped } = require('../../utils/badgeManager');
const { readJson } = require('../../utils/jsonStorage');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Your trading rank card — level, XP, and activity mix')
    .addUserOption(opt => opt.setName('user').setDescription('Member to view').setRequired(false)),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({ content: 'Leveling is turned off on this server.', ephemeral: true });
    }

    const user = interaction.options.getUser('user') || interaction.user;
    const snap = levelingEngine.getUserRank(interaction.guild.id, user.id);
    const userData = snap.user;
    const settings = levelingEngine.ensureGuild(levelingEngine.loadAll(), interaction.guild.id).settings;

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
      neededXp: userData.neededXp,
      totalXp: userData.totalXp || 0,
      messages: userData.messages || 0,
      equippedBadges,
    }), { name: imageName });

    const [r, g, b] = tierColor(userData.level);
    const embed = new EmbedBuilder()
      .setColor((r << 16) | (g << 8) | b)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ size: 64 }) })
      .setTitle(snap.mode === 'trading' ? 'Trading rank' : 'Rank')
      .setImage(`attachment://${imageName}`);

    const lines = [];
    if (snap.rank) lines.push(`**#${snap.rank}** of ${snap.tracked} tracked`);
    lines.push(`Level **${userData.level}** · **${(userData.totalXp || 0).toLocaleString()}** total XP`);
    lines.push(`Progress **${userData.xp.toLocaleString()}** / **${userData.neededXp.toLocaleString()}** to next`);

    if (snap.mode === 'trading') {
      const by = userData.dayBySignal || {};
      const bits = Object.entries(by)
        .filter(([, v]) => v && (v.xp || v.n))
        .map(([k, v]) => `${k.replace(/_/g, ' ')} +${v.xp || 0}`)
        .slice(0, 6);
      if (bits.length) lines.push(`Today · ${bits.join(' · ')}`);
      else lines.push('Today · no trading signals yet');
    }

    if (settings.seasonEnabled) {
      lines.push(`Season **${settings.seasonKey || 'active'}** · **${(userData.seasonXp || 0).toLocaleString()}** XP`);
    }

    embed.setDescription(lines.join('\n'));
    await interaction.reply({ embeds: [embed], files: [attachment] });
  },
};
