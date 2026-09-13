'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getModLogSettings } = require('../../utils/modConfig');
const { postCustomLog, suppressDeleteLog } = require('../../utils/modLog');
const { serverAction, memberAction } = require('../../utils/modEmbed');

const DEL_DELAY = 2000;
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

/**
 * Discord bulk-delete needs 2–100 messages, all < 14 days.
 * A single message, missing IDs, or a race with another delete → 10008 Unknown Message.
 * This helper never throws for those cases.
 */
async function deleteMessagesSafe(channel, messages) {
  const list = [...messages].filter(m => m && m.id);
  if (!list.length) return 0;

  for (const m of list) suppressDeleteLog(m.id);

  // One message: bulkDelete is invalid — use single delete
  if (list.length === 1) {
    try {
      await list[0].delete();
      return 1;
    } catch {
      return 0;
    }
  }

  try {
    const deleted = await channel.bulkDelete(list, true);
    return deleted?.size ?? list.length;
  } catch (err) {
    // 10008 Unknown Message, partial race, etc. — fall back one-by-one
    if (err?.code !== 10008 && err?.code !== 50034) {
      console.warn('[purge] bulkDelete failed, falling back:', err.message || err);
    }
    let n = 0;
    for (const m of list) {
      try {
        await m.delete();
        n++;
      } catch {
        /* already gone / too old / no perms */
      }
    }
    return n;
  }
}

async function deleteOld(messages) {
  let count = 0;
  for (const msg of messages.values ? messages.values() : messages) {
    suppressDeleteLog(msg.id);
    try {
      await msg.delete();
      count++;
    } catch {
      /* already gone */
    }
  }
  return count;
}

async function logPurge(guild, moderator, member, channel, deleted, targetUser = null) {
  if (!getModLogSettings(guild.id).purges) return;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return;
  const embed = new EmbedBuilder()
    .setColor(0x95A5A6)
    .setTitle('🧹 Purge Run')
    .addFields(
      { name: 'Moderator', value: `${moderator}`, inline: true },
      { name: 'Channel', value: `${channel}`, inline: true },
      { name: 'Deleted', value: `${deleted}`, inline: true },
    )
    .setTimestamp();
  if (targetUser) embed.addFields({ name: 'Target User', value: `${targetUser}`, inline: true });
  await postCustomLog(guild, embed).catch(() => {});
}

async function safeEditReply(interaction, payload) {
  try {
    await interaction.editReply(payload);
  } catch (err) {
    // 10008 = reply already deleted; ignore
    if (err?.code !== 10008) {
      console.warn('[purge] editReply:', err.message || err);
    }
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s =>
      s.setName('amount').setDescription('Delete recent messages')
        .addIntegerOption(o =>
          o.setName('number').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true)))
    .addSubcommand(s =>
      s.setName('user').setDescription('Delete messages from a user')
        .addUserOption(o => o.setName('user').setDescription('Whose messages').setRequired(true))
        .addIntegerOption(o =>
          o.setName('number').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.channel;

    if (!channel?.isTextBased?.() || !channel.messages) {
      return interaction.reply({
        embeds: [serverAction({
          guild: interaction.guild,
          title: 'Cannot purge here',
          color: 0xE74C3C,
        })],
        ephemeral: true,
      }).catch(() => {});
    }

    if (sub === 'amount') {
      const amount = interaction.options.getInteger('number');
      const statusMsg = await interaction.reply({
        embeds: [serverAction({
          guild: interaction.guild,
          title: `Clearing ${amount} messages…`,
        })],
        fetchReply: true,
      });

      try {
        let deleted = 0;
        let oldDeleted = 0;
        let lastId = null;
        let emptyStreak = 0;

        while (deleted < amount) {
          const opts = { limit: 100 };
          if (lastId) opts.before = lastId;

          const fetched = await channel.messages.fetch(opts);
          if (fetched.size === 0) break;

          lastId = fetched.last().id;

          const target = fetched.filter(m => m.id !== statusMsg.id);
          if (target.size === 0) {
            emptyStreak++;
            if (emptyStreak > 3) break;
            continue;
          }
          emptyStreak = 0;

          const wanted = target.first(Math.min(amount - deleted, target.size));
          const batch = Array.isArray(wanted) ? wanted : [wanted];
          const recent = batch.filter(m => Date.now() - m.createdTimestamp < TWO_WEEKS);
          const old = batch.filter(m => Date.now() - m.createdTimestamp >= TWO_WEEKS);

          if (recent.length > 0) {
            deleted += await deleteMessagesSafe(channel, recent);
          }
          if (old.length > 0) {
            const n = await deleteOld(old);
            deleted += n;
            oldDeleted += n;
          }

          // Safety: no progress this page
          if (recent.length === 0 && old.length === 0) break;
        }

        const note = oldDeleted > 0
          ? ` (${oldDeleted} older than 14 days, deleted individually)`
          : '';
        await safeEditReply(interaction, {
          embeds: [serverAction({
            guild: interaction.guild,
            title: `Deleted ${deleted} message${deleted === 1 ? '' : 's'}`,
            note: note.trim() || null,
            color: 0x2ECC71,
          })],
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
        await logPurge(interaction.guild, interaction.user, interaction.member, channel, deleted);
      } catch (err) {
        console.warn('[purge amount]', err.message || err);
        await safeEditReply(interaction, {
          embeds: [serverAction({
            guild: interaction.guild,
            title: 'Could not delete those messages',
            color: 0xE74C3C,
          })],
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      }

    } else if (sub === 'user') {
      const user = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('number');
      const statusMsg = await interaction.reply({
        embeds: [memberAction({
          guild: interaction.guild,
          user,
          action: 'purge',
          tokens: { count: `${amount} of their message${amount === 1 ? '' : 's'}` },
        })],
        fetchReply: true,
      });

      try {
        let deleted = 0;
        let oldDeleted = 0;
        let lastId = null;
        let emptyStreak = 0;

        while (deleted < amount) {
          const opts = { limit: 100 };
          if (lastId) opts.before = lastId;

          const fetched = await channel.messages.fetch(opts);
          if (fetched.size === 0) break;

          lastId = fetched.last().id;

          const userMsgs = fetched.filter(
            m => m.author.id === user.id && m.id !== statusMsg.id,
          );
          if (userMsgs.size === 0) {
            emptyStreak++;
            if (emptyStreak > 5) break;
            continue;
          }
          emptyStreak = 0;

          const wanted = userMsgs.first(Math.min(amount - deleted, userMsgs.size));
          const batch = Array.isArray(wanted) ? wanted : [wanted];
          const recent = batch.filter(m => Date.now() - m.createdTimestamp < TWO_WEEKS);
          const old = batch.filter(m => Date.now() - m.createdTimestamp >= TWO_WEEKS);

          if (recent.length > 0) {
            deleted += await deleteMessagesSafe(channel, recent);
          }
          if (old.length > 0) {
            const n = await deleteOld(old);
            deleted += n;
            oldDeleted += n;
          }

          if (recent.length === 0 && old.length === 0) break;
        }

        const note = oldDeleted > 0
          ? ` (${oldDeleted} older than 14 days, deleted individually)`
          : '';
        await safeEditReply(interaction, {
          embeds: [memberAction({
            guild: interaction.guild,
            user,
            action: 'purged',
            tokens: {
              count: `${deleted} message${deleted === 1 ? '' : 's'}${note}`,
            },
          })],
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
        await logPurge(
          interaction.guild, interaction.user, interaction.member, channel, deleted, user,
        );
      } catch (err) {
        console.warn('[purge user]', err.message || err);
        await safeEditReply(interaction, {
          embeds: [serverAction({
            guild: interaction.guild,
            title: 'Could not delete those messages',
            color: 0xE74C3C,
          })],
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), DEL_DELAY);
      }
    }
  },
};
