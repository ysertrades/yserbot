const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, removeCoins, addCoins } = require('../../utils/economyManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transfer')
    .setDescription('Transfer coins to another user')
    .addUserOption(opt => opt.setName('user').setDescription('User to transfer to').setRequired(true))
    .addNumberOption(opt => opt.setName('amount').setDescription('Amount to transfer').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const recipient = interaction.options.getUser('user');
    const amount = Math.floor(interaction.options.getNumber('amount'));
    const sender = interaction.user;

    if (recipient.id === sender.id) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Error')
        .setDescription('You cannot transfer to yourself.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (recipient.bot) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Error')
        .setDescription('You cannot transfer to bots.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const senderBalance = getBalance(sender.id);
    if (senderBalance < amount) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('❌ Insufficient Balance')
        .setDescription('You only have **' + senderBalance + '** coins.');
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    removeCoins(sender.id, amount);
    addCoins(recipient.id, amount);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('✅ Transfer Successful')
      .addFields(
        { name: '📤 From', value: sender.username, inline: true },
        { name: '📥 To', value: recipient.username, inline: true },
        { name: '💰 Amount', value: '**' + amount + '** coins', inline: true }
      )
      .setFooter({ text: 'Transfer completed' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
