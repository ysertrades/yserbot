'use strict';

const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');
const { generateLeaderboardImage } = require('../../utils/leaderboardVisual');

// QuantLab Phantom palette — purple (#9397EE)
const BRAND_PURPLE = 0x9397EE;

function displayName(guild, userId) {
  try {
    const m = guild?.members?.cache?.get(userId);
    if (m) return m.displayName || m.user?.globalName || m.user?.username || userId;
    const u = guild?.client?.users?.cache?.get(userId);
    if (u) return u.globalName || u.username || userId;
  } catch {}
  return userId;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top members by Quantlab XP'),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({ content: 'Leveling is turned off on this server.', ephemeral: true });
    }

    await interaction.deferReply();

    const ranked = levelingEngine.getLeaderboard(interaction.guild.id, 10);

    if (!ranked.length) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(BRAND_PURPLE)
          .setTitle('XP leaderboard')
          .setDescription('No ranks yet — chat in allowed channels to earn 15–25 XP per message.')],
      });
    }

    const entries = ranked.map((u, i) => ({
      rank: i + 1,
      name: displayName(interaction.guild, u.id),
      level: u.level,
      totalXp: u.totalXp,
      id: u.id,
    }));

    let attachment = null;
    const imageName = 'leaderboard.png';
    try {
      const buf = generateLeaderboardImage({
        entries,
        title: 'QuantLab Ranks',
        subtitle: 'Top 10 by XP',
      });
      attachment = new AttachmentBuilder(buf, { name: imageName });
    } catch (err) {
      console.warn('[leaderboard] image', err.message || err);
    }

    const topLine = entries.slice(0, 3)
      .map(e => `**#${e.rank}** <@${e.id}>`)
      .join(' · ');

    const embed = new EmbedBuilder()
      .setColor(BRAND_PURPLE)
      .setTitle('XP leaderboard')
      .setDescription(`All-time · Quantlab\n${topLine}`)
      .setFooter({ text: 'Top 10 · 15–25 XP / msg · 60s cooldown' });

    if (attachment) embed.setImage(`attachment://${imageName}`);

    const payload = { embeds: [embed] };
    if (attachment) payload.files = [attachment];
    return interaction.editReply(payload);
  },
};
