const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, getLeaderboard } = require('../../utils/economyManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your balance or view leaderboard')
    .addSubcommand(sub => sub.setName('me').setDescription('Check your balance'))
    .addSubcommand(sub => sub.setName('user').setDescription('Check another user\'s balance').addUserOption(opt => opt.setName('user').setDescription('User to check').setRequired(true)))
    .addSubcommand(sub => sub.setName('top').setDescription('View top 10 richest users')),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'me') {
      const balance = getBalance(interaction.user.id);
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('💰 Your Balance')
        .setDescription('You have **' + balance + '** coins')
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: 'Use /work for more coins' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } else if (subcommand === 'user') {
      const user = interaction.options.getUser('user');
      const balance = getBalance(user.id);
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('💰 ' + user.username + '\'s Balance')
        .setDescription(user.username + ' has **' + balance + '** coins')
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    } else if (subcommand === 'top') {
      const leaderboard = getLeaderboard(10);
      let description = '';
      for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
        description += medal + ' <@' + entry.userId + '> - **' + entry.balance + '** coins\n';
      }

      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle('🏆 Top 10 Richest Users')
        .setDescription(description || 'No users yet')
        .setFooter({ text: 'Climb the ranks!' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }
  },
};
