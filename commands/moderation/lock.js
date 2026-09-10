use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { sendTempReply } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

const LOCK_FILE = 'locked_channels.json';
const LOCKABLE_PERMS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'];

function _snapshot(channel, roleId) {
  const ow = channel.permissionOverwrites.cache.get(roleId);
  const snap = {};
  for (const perm of LOCKABLE_PERMS) {
    if (ow?.allow.has(PermissionFlagsBits[perm])) snap[perm] = true;
    else if (ow?.deny.has(PermissionFlagsBits[perm])) snap[perm] = false;
    else snap[perm] = null;
  }
  return snap;
}

function _modAdminRoleIds(guildId) {
  const config = readJson('config.json', {});
  const setup = config[guildId]?.cmdSetup || {};
  return [...new Set([...(setup.modRoles || []), ...(setup.adminRoles || [])])];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock').setDescription('Lock a channel so only moderators/admins can send messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName('channel').setDescription('Channel to lock (defaults to this channel)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Reason for locking').setRequired(false)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason  = interaction.options.getString('reason') || null;
    const guildId = interaction.guild.id;

    if (!channel.isTextBased() || channel.isThread()) {
      return sendTempReply(interaction, {
        content: 'Only text or announcement channels can be locked.',
      });
    }

    const locks = readJson(LOCK_FILE, {});
    if (locks[guildId]?.[channel.id]) {
      return sendTempReply(interaction, {
        content: `${channel} is already locked. Use \`/unlock\` when you are ready to open it again.`,
      });
    }

    await interaction.deferReply();

    const everyoneId = interaction.guild.roles.everyone.id;
    const modAdminRoleIds = _modAdminRoleIds(guildId);

    const snapshot = { everyone: _snapshot(channel, everyoneId), roles: {} };
    for (const roleId of modAdminRoleIds) snapshot.roles[roleId] = _snapshot(channel, roleId);

    try {
      const denyAll = Object.fromEntries(LOCKABLE_PERMS.map(p => [p, false]));
      await channel.permissionOverwrites.edit(everyoneId, denyAll, {
        reason: `Channel locked by ${interaction.user.tag}${reason ? `: ${reason}` : ''}`,
      });

      for (const roleId of modAdminRoleIds) {
        const allowAll = Object.fromEntries(LOCKABLE_PERMS.map(p => [p, true]));
        await channel.permissionOverwrites.edit(roleId, allowAll, {
          reason: `Channel locked by ${interaction.user.tag}: keep mod/admin access`,
        });
      }
    } catch (err) {
      console.error('[LOCK]', err);
      return interaction.editReply({
        content: 'Could not lock this channel — check that I can manage channel permissions.',
      });
    }

    if (!locks[guildId]) locks[guildId] = {};
    locks[guildId][channel.id] = {
      snapshot, reason, lockedBy: interaction.user.id, lockedByTag: interaction.user.tag, timestamp: Date.now(),
    };
    writeJson(LOCK_FILE, locks);

    const who = interaction.user;
    const why = reason ? `\nReason: **${reason}**` : '';
    const msg =
      `🔒 **Channel locked**\n` +
      `${channel} is closed for regular members.\n` +
      `Mods and admins can still talk.` +
      why +
      `\nLocked by ${who}`;

    await interaction.editReply({ content: msg });

    if (channel.id !== interaction.channelId) {
      try {
        await channel.send({ content: msg });
      } catch { /* missing send perms in target */ }
    }
  },
};
