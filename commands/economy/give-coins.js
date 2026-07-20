'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { addCoins, getBalance } = require('../../utils/economyManager');

function fmt(n) { return Number(n).toLocaleString(); }

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give-coins')
    .setDescription('Give coins to a user or all users (admin only — creates coins, not a transfer)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(o => o
      .setName('amount').setDescription('Amount of coins to give').setMinValue(1).setRequired(true))
    .addUserOption(o => o
      .setName('user').setDescription('User to give coins to (leave blank when using all-users)').setRequired(false))
    .addBooleanOption(o => o
      .setName('all-users').setDescription('Give coins to every non-bot member in the server').setRequired(false)),

  async execute(interaction) {
    const amount  = interaction.options.getInteger('amount');
    const target  = interaction.options.getUser('user');
    const allMode = interaction.options.getBoolean('all-users') ?? false;

    if (!target && !allMode)
      return interaction.reply({ content: '❌ Provide a **user** or enable **all-users**.', flags: 64 });

    if (target && allMode)
      return interaction.reply({ content: '❌ Pick one: a specific **user** OR **all-users**, not both.', flags: 64 });

    // ── Single user ──────────────────────────────────────────────────────────
    if (target) {
      if (target.bot)
        return interaction.reply({ content: '❌ You cannot give coins to a bot.', flags: 64 });

      addCoins(target.id, amount);
      const newBalance = getBalance(target.id);

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('💰 Coins Granted')
        .addFields(
          { name: 'Recipient',    value: `<@${target.id}>`,             inline: true },
          { name: 'Amount Given', value: `**${fmt(amount)}** coins`,    inline: true },
          { name: 'New Balance',  value: `**${fmt(newBalance)}** coins`, inline: true },
        )
        .setFooter({ text: `Granted by ${interaction.user.tag} • Auto-deletes in 5s` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    // ── All users ────────────────────────────────────────────────────────────
    await interaction.deferReply();

    await interaction.guild.members.fetch();
    const members = interaction.guild.members.cache.filter(m => !m.user.bot);

    members.forEach(m => addCoins(m.id, amount));

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('💰 Mass Coins Granted')
      .setDescription(`**${fmt(amount)}** coins given to every member.`)
      .addFields(
        { name: 'Recipients', value: `**${fmt(members.size)}** members`, inline: true },
        { name: 'Each Gets',  value: `**${fmt(amount)}** coins`,         inline: true },
        { name: 'Total Out',  value: `**${fmt(members.size * amount)}** coins`, inline: true },
      )
      .setFooter({ text: `Granted by ${interaction.user.tag} • Auto-deletes in 10s` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 10000);
  },
};
