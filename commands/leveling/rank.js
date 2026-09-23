'use strict';

const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { generateRankImage, tierColor } = require('../../utils/rankVisual');
const levelingEngine = require('../../utils/levelingEngine');
const { isFeatureEnabled } = require('../../utils/featureToggles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Your Quantlab rank card — level and XP')
    .addUserOption(opt => opt.setName('user').setDescription('Member to view').setRequired(false)),

  async execute(interaction) {
    if (!isFeatureEnabled(interaction.guild.id, 'leveling')) {
      return interaction.reply({ content: 'Leveling is turned off on this server.', ephemeral: true });
    }

    await interaction.deferReply();

    const user = interaction.options.getUser('user') || interaction.user;
    const snap = levelingEngine.getUserRank(interaction.guild.id, user.id);
    const u = snap.user;

    let attachment = null;
    let imageName = null;
    try {
      imageName = `rank_${user.id}.png`;
      const buf = generateRankImage({
        username: user.username,
        level: u.level,
        xp: u.xp,
        neededXp: u.neededXp,
        totalXp: u.totalXp || 0,
        messages: u.messages || 0,
        equippedBadges: [],
      });
      attachment = new AttachmentBuilder(buf, { name: imageName });
    } catch (err) {
      console.warn('[rank] image', err.message);
    }

    const [r, g, b] = tierColor(u.level);
    const embed = new EmbedBuilder()
      .setColor((r << 16) | (g << 8) | b)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL({ size: 64 }) })
      .setTitle('Quantlab rank');

    const lines = [];
    if (snap.rank) lines.push(`**#${snap.rank}** of ${snap.tracked} ranked`);
    else lines.push('Not ranked yet — chat to earn XP');
    lines.push(`Level **${u.level}** · **${(u.totalXp || 0).toLocaleString()}** total XP`);
    lines.push(`Progress **${u.xp.toLocaleString()}** / **${u.neededXp.toLocaleString()}** to next level`);
    embed.setDescription(lines.join('\n'));
    if (imageName) embed.setImage(`attachment://${imageName}`);

    const payload = { embeds: [embed] };
    if (attachment) payload.files = [attachment];
    return interaction.editReply(payload);
  },
};
