'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');

const DEL_DELAY  = 2000; // 2 seconds for clear messages
const TWO_WEEKS  = 1209600000; // Discord's bulkDelete cutoff, in ms

// Discord's bulk-delete endpoint refuses anything older than 14 days, so those
// have to go through individual message.delete() calls instead. Those aren't
// batched, so they're slower and subject to normal per-message rate limits —
// callers should expect this to take longer for larger old-message counts.
async function deleteOld(messages) {
  let count = 0;
  for (const msg of messages.values()) {
    try { await msg.delete(); count++; } catch { /* already gone / no perms on this one — skip it */ }
  }
  return count;
}

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
        // Paginate in batches of <=100 (Discord's fetch cap) rather than one
        // fetch({ limit: amount + 1 }) — that broke as soon as amount hit 100
        // (limit 101 is rejected outright by the API). Looping like this also
        // means a request for more messages than the channel actually has
        // just naturally stops once the channel runs out, instead of erroring.
        let deleted = 0, oldDeleted = 0, lastId = null;
        while (deleted < amount) {
          const opts = { limit: 100 };
          if (lastId) opts.before = lastId;
          const fetched = await channel.messages.fetch(opts);
          if (fetched.size === 0) break;
          lastId = fetched.last().id;

          const target = fetched.filter(m => m.id !== statusMsg.id);
          if (target.size === 0) continue;

          const wanted = target.first(Math.min(amount - deleted, target.size));
          const recent = wanted.filter(m => Date.now() - m.createdTimestamp < TWO_WEEKS);
          const old    = wanted.filter(m => Date.now() - m.createdTimestamp >= TWO_WEEKS);

          if (recent.length > 0) { await channel.bulkDelete(recent, true); deleted += recent.length; }
          if (old.length > 0)    { const n = await deleteOld(old); deleted += n; oldDeleted += n; }
        }

        const note = oldDeleted > 0 ? ` (${oldDeleted} older than 14 days, deleted individually)` : '';
        await interaction.editReply({ embeds: [createServerEmbed('success', { title: '✅ Cleared', description: `Deleted **${deleted}** messages.${note}` }, interaction.guild)] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      } catch {
        await interaction.editReply({ embeds: [createServerEmbed('error', { title: '❌ Error', description: 'Failed to delete messages.' }, interaction.guild)] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      }

    } else if (sub === 'user') {
      const user      = interaction.options.getUser('user');
      const amount    = interaction.options.getInteger('number');
      const statusMsg = await interaction.reply({ embeds: [createServerEmbed('info', { title: '🧹 Clearing...', description: `Deleting up to **${amount}** messages from **${user.tag}**.` }, interaction.guild)], fetchReply: true });

      try {
        let deleted = 0, oldDeleted = 0, lastId = null;
        while (deleted < amount) {
          const opts = { limit: 100 };
          if (lastId) opts.before = lastId;
          const fetched = await channel.messages.fetch(opts);
          if (fetched.size === 0) break;
          lastId = fetched.last().id;

          const userMsgs = fetched.filter(m => m.author.id === user.id && m.id !== statusMsg.id);
          if (userMsgs.size === 0) continue;

          const wanted = userMsgs.first(Math.min(amount - deleted, userMsgs.size));
          const recent = wanted.filter(m => Date.now() - m.createdTimestamp < TWO_WEEKS);
          const old    = wanted.filter(m => Date.now() - m.createdTimestamp >= TWO_WEEKS);

          if (recent.length > 0) { await channel.bulkDelete(recent, true); deleted += recent.length; }
          if (old.length > 0)    { const n = await deleteOld(old); deleted += n; oldDeleted += n; }
        }
        const note = oldDeleted > 0 ? ` (${oldDeleted} older than 14 days, deleted individually)` : '';
        await interaction.editReply({ embeds: [createServerEmbed('success', { title: '✅ Cleared', description: `Deleted **${deleted}** messages from **${user.tag}**.${note}` }, interaction.guild)] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      } catch {
        await interaction.editReply({ embeds: [createServerEmbed('error', { title: '❌ Error', description: 'Failed to delete messages.' }, interaction.guild)] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      }
    }
  },
};
