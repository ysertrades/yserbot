'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getBalance, addCoins, removeCoins } = require('../../utils/economyManager');
const { readJson, writeJson } = require('../../utils/jsonStorage');

const BANK_FILE     = 'bank.json';
const INTEREST_RATE = 0.02;                    // 2% per period
const PERIOD_MS     = 12 * 60 * 60 * 1000;    // 12 hours

const fmt = n => Number(n).toLocaleString();

function getBank(userId) {
  const data = readJson(BANK_FILE, {});
  return data[userId] || { balance: 0, lastInterest: Date.now() };
}

function saveBank(userId, bankData) {
  const data = readJson(BANK_FILE, {});
  data[userId] = bankData;
  writeJson(BANK_FILE, data);
}

function calcInterest(bankData) {
  if (bankData.balance <= 0) return { interest: 0, periods: 0 };
  const periods   = Math.floor((Date.now() - bankData.lastInterest) / PERIOD_MS);
  const interest  = Math.floor(bankData.balance * INTEREST_RATE * periods);
  return { interest, periods };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bank')
    .setDescription('Deposit coins, earn 2% interest every 12 hours, and grow your wealth')
    .addSubcommand(sub => sub
      .setName('balance').setDescription('View your bank balance and pending interest'))
    .addSubcommand(sub => sub
      .setName('deposit').setDescription('Move coins from your wallet into the bank')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to deposit').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('withdraw').setDescription('Move coins from the bank back to your wallet')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to withdraw').setMinValue(1).setRequired(true)))
    .addSubcommand(sub => sub
      .setName('collect').setDescription('Collect all accrued interest into your bank balance')),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (sub === 'balance') {
      const bankData  = getBank(userId);
      const wallet    = getBalance(userId);
      const { interest, periods } = calcInterest(bankData);
      const nextTs    = Math.floor((bankData.lastInterest + PERIOD_MS) / 1000);

      const embed = new EmbedBuilder()
        .setColor(0x27AE60)
        .setTitle('🏦  Your Bank Account')
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '💵 Wallet',     value: `\`${fmt(wallet)}\` coins`,          inline: true },
          { name: '🏦 Bank',       value: `\`${fmt(bankData.balance)}\` coins`, inline: true },
          { name: '📊 Total',      value: `\`${fmt(wallet + bankData.balance)}\` coins`, inline: true },
          {
            name: '💹 Interest',
            value: interest > 0
              ? `> **+${fmt(interest)} coins** ready!\n> Use \`/bank collect\` to claim.`
              : `> Next drop in <t:${nextTs}:R>`,
            inline: false,
          },
        )
        .setFooter({ text: '📈 2% interest every 12 hours on your bank balance' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'deposit') {
      const amount = interaction.options.getInteger('amount');
      const wallet = getBalance(userId);
      if (wallet < amount)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('❌ Insufficient Wallet').setDescription(`You only have **${fmt(wallet)}** coins in your wallet.`)], ephemeral: true });

      removeCoins(userId, amount);
      const bankData = getBank(userId);
      bankData.balance += amount;
      saveBank(userId, bankData);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x27AE60)
        .setTitle('🏦  Deposit Successful')
        .setDescription(`> 💸 **${fmt(amount)}** coins deposited.`)
        .addFields(
          { name: '💵 New Wallet', value: `\`${fmt(getBalance(userId))}\` coins`,   inline: true },
          { name: '🏦 New Bank',   value: `\`${fmt(bankData.balance)}\` coins`,     inline: true },
        )
        .setFooter({ text: 'Earning 2% interest every 12 hours' })
        .setTimestamp()] });
    }

    if (sub === 'withdraw') {
      const amount   = interaction.options.getInteger('amount');
      const bankData = getBank(userId);
      if (bankData.balance < amount)
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('❌ Insufficient Bank Balance').setDescription(`Your bank holds **${fmt(bankData.balance)}** coins.`)], ephemeral: true });

      bankData.balance -= amount;
      saveBank(userId, bankData);
      addCoins(userId, amount);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('🏦  Withdrawal Successful')
        .setDescription(`> 💸 **${fmt(amount)}** coins returned to your wallet.`)
        .addFields(
          { name: '💵 New Wallet', value: `\`${fmt(getBalance(userId))}\` coins`,   inline: true },
          { name: '🏦 New Bank',   value: `\`${fmt(bankData.balance)}\` coins`,     inline: true },
        )
        .setTimestamp()] });
    }

    if (sub === 'collect') {
      const bankData = getBank(userId);
      const { interest, periods } = calcInterest(bankData);
      if (interest <= 0) {
        const nextTs = Math.floor((bankData.lastInterest + PERIOD_MS) / 1000);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4757).setTitle('⏳ No Interest Yet').setDescription(`Next interest period: <t:${nextTs}:R>`)], ephemeral: true });
      }
      bankData.lastInterest += periods * PERIOD_MS;
      bankData.balance      += interest;
      saveBank(userId, bankData);

      return interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle('💹  Interest Collected!')
        .setDescription(`> 🎉 **+${fmt(interest)} coins** added to your bank!`)
        .addFields(
          { name: '🏦 New Bank Balance', value: `\`${fmt(bankData.balance)}\` coins`, inline: true },
          { name: '📈 Rate',             value: `2% × ${periods} period${periods > 1 ? 's' : ''}`, inline: true },
        )
        .setFooter({ text: 'Keep coins in the bank to grow your wealth!' })
        .setTimestamp()] });
    }
  },
};
