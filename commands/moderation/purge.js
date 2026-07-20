'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');

const DEL_DELAY = 2000; // 2 seconds for clear messages

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge').setDescription('Delete messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName('amount').setDescription('Delete recent messages')
      .addIntegerOption(o => o.setName('number').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true)))
    .addSubcommand(s => s.setName('user').setDescription('Delete messages from a specific user')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption(o => o.setName('number').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true))),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const channel = interaction.channel;

    if (sub === 'amount') {
      const amount    = interaction.options.getInteger('number');
      const statusMsg = await interaction.reply({ embeds: [createServerEmbed('info', { title: '🧹 Clearing...', description: `Deleting **${amount}** messages.` }, interaction.guild)], fetchReply: true });

      try {
        const fetched  = await channel.messages.fetch({ limit: amount + 1 });
        const toDelete = fetched.filter(m => m.id !== statusMsg.id && Date.now() - m.createdTimestamp < 1209600000);
        await channel.bulkDelete(toDelete, true);
        await interaction.editReply({ embeds: [createServerEmbed('success', { title: '✅ Cleared', description: `Deleted **${toDelete.size}** messages.` }, interaction.guild)] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      } catch {
        await interaction.editReply({ embeds: [createServerEmbed('error', { title: '❌ Error', description: 'Failed. Messages older than 14 days cannot be bulk deleted.' }, interaction.guild)] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      }

    } else if (sub === 'user') {
      const user      = interaction.options.getUser('user');
      const amount    = interaction.options.getInteger('number');
      const statusMsg = await interaction.reply({ embeds: [createServerEmbed('info', { title: '🧹 Clearing...', description: `Deleting up to **${amount}** messages from **${user.tag}**.` }, interaction.guild)], fetchReply: true });

      try {
        let deleted = 0, lastId = null;
        const cutoff = Date.now() - 1209600000;
        while (deleted < amount) {
          const opts    = { limit: 100 };
          if (lastId) opts.before = lastId;
          const fetched = await channel.messages.fetch(opts);
          if (fetched.size === 0) break;
          const userMsgs = fetched.filter(m => m.author.id === user.id && m.id !== statusMsg.id && m.createdTimestamp > cutoff);
          if (userMsgs.size === 0) { lastId = fetched.last().id; continue; }
          const toDelete = userMsgs.first(Math.min(amount - deleted, userMsgs.size));
          await channel.bulkDelete(toDelete, true);
          deleted += toDelete.length;
          lastId  = fetched.last().id;
        }
        await interaction.editReply({ embeds: [createServerEmbed('success', { title: '✅ Cleared', description: `Deleted **${deleted}** messages from **${user.tag}**.` }, interaction.guild)] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      } catch {
        await interaction.editReply({ embeds: [createServerEmbed('error', { title: '❌ Error', description: 'Failed to delete messages.' }, interaction.guild)] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      }
    }
  },
};
