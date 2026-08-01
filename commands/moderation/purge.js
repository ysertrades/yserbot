'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getModLogSettings } = require('../../utils/modConfig');
const { postCustomLog, suppressDeleteLog } = require('../../utils/modLog');
const { serverAction, memberAction } = require('../../utils/modEmbed');

const DEL_DELAY  = 2000; // 2 seconds for clear messages
const TWO_WEEKS  = 1209600000; // Discord's bulkDelete cutoff, in ms

// Discord's bulk-delete endpoint refuses anything older than 14 days, so those
// have to go through individual message.delete() calls instead. Those aren't
// batched, so they're slower and subject to normal per-message rate limits —
// callers should expect this to take longer for larger old-message counts.
// Each is marked suppressed first so the generic message-delete logger
// doesn't post one noisy log entry per message on top of the summary below.
async function deleteOld(messages) {
  let count = 0;
  for (const msg of messages.values()) {
    suppressDeleteLog(msg.id);
    try { await msg.delete(); count++; } catch { /* already gone / no perms on this one — skip it */ }
  }
  return count;
}

async function logPurge(guild, moderator, member, channel, deleted, targetUser = null) {
  if (!getModLogSettings(guild.id).purges) return;
  // Administrators don't get logged for their own purges — only non-admin
  // moderators do, so staff accountability logging stays focused on the
  // tier that isn't already fully trusted.
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return;
  const embed = new EmbedBuilder()
    .setColor(0x95A5A6)
    .setTitle('🧹 Purge Run')
    .addFields(
      { name: 'Moderator', value: `${moderator}`, inline: true },
      { name: 'Channel',   value: `${channel}`,    inline: true },
      { name: 'Deleted',   value: `${deleted}`,     inline: true },
    )
    .setTimestamp();
  if (targetUser) embed.addFields({ name: 'Target User', value: `${targetUser}`, inline: true });
  await postCustomLog(guild, embed);
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
      const statusMsg = await interaction.reply({ embeds: [serverAction({ guild: interaction.guild, title: `Clearing ${amount} messages…` })], fetchReply: true });

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
        await interaction.editReply({ embeds: [serverAction({ guild: interaction.guild, title: `Deleted ${deleted} message${deleted === 1 ? '' : 's'}`, note: note.trim() || null, color: 0x2ECC71 })] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
        await logPurge(interaction.guild, interaction.user, interaction.member, channel, deleted);
      } catch {
        await interaction.editReply({ embeds: [serverAction({ guild: interaction.guild, title: 'Could not delete those messages', color: 0xE74C3C })] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      }

    } else if (sub === 'user') {
      const user      = interaction.options.getUser('user');
      const amount    = interaction.options.getInteger('number');
      const statusMsg = await interaction.reply({ embeds: [memberAction({ user, action: 'purge', note: `Clearing up to ${amount} of their messages…` })], fetchReply: true });

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
        await interaction.editReply({ embeds: [memberAction({ user, action: 'purged', note: `**Deleted:** ${deleted} message${deleted === 1 ? '' : 's'}${note}` })] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
        await logPurge(interaction.guild, interaction.user, interaction.member, channel, deleted, user);
      } catch {
        await interaction.editReply({ embeds: [serverAction({ guild: interaction.guild, title: 'Could not delete those messages', color: 0xE74C3C })] });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      }
    }
  },
};
