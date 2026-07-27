'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { createServerEmbed } = require('../../utils/embedBuilder');
const { readJson, writeJson } = require('../../utils/jsonStorage');

const LOCK_FILE = 'locked_channels.json';
const LOCKABLE_PERMS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'];

// Snapshot of a role's current overwrite for the permissions we're about to
// touch, so unlock can restore the exact prior state instead of guessing.
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
    const reason  = interaction.options.getString('reason') || 'No reason provided';
    const guildId = interaction.guild.id;

    if (!channel.isTextBased() || channel.isThread()) {
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Only text/announcement channels can be locked.' }, interaction.guild)], ephemeral: true });
    }

    const locks = readJson(LOCK_FILE, {});
    if (locks[guildId]?.[channel.id]) {
      return interaction.reply({ embeds: [createServerEmbed('error', { title: 'Already Locked', description: `${channel} is already locked. Use \`/unlock\` first.` }, interaction.guild)], ephemeral: true });
    }

    await interaction.deferReply();

    const everyoneId = interaction.guild.roles.everyone.id;
    const modAdminRoleIds = _modAdminRoleIds(guildId);

    const snapshot = { everyone: _snapshot(channel, everyoneId), roles: {} };
    for (const roleId of modAdminRoleIds) snapshot.roles[roleId] = _snapshot(channel, roleId);

    try {
      const denyAll = Object.fromEntries(LOCKABLE_PERMS.map(p => [p, false]));
      await channel.permissionOverwrites.edit(everyoneId, denyAll, { reason: `Channel locked by ${interaction.user.tag}: ${reason}` });

      for (const roleId of modAdminRoleIds) {
        const allowAll = Object.fromEntries(LOCKABLE_PERMS.map(p => [p, true]));
        await channel.permissionOverwrites.edit(roleId, allowAll, { reason: `Channel locked by ${interaction.user.tag}: keep mod/admin access` });
      }
    } catch (err) {
      console.error('[LOCK]', err);
      return interaction.editReply({ embeds: [createServerEmbed('error', { title: 'Error', description: 'Missing permissions to edit this channel\'s overwrites.' }, interaction.guild)] });
    }

    if (!locks[guildId]) locks[guildId] = {};
    locks[guildId][channel.id] = {
      snapshot, reason, lockedBy: interaction.user.id, lockedByTag: interaction.user.tag, timestamp: Date.now(),
    };
    writeJson(LOCK_FILE, locks);

    const embed = createServerEmbed('success', {
      title: '🔒 Channel Locked',
      description: `${channel} has been locked.\nOnly **moderators and admins** can send messages here until \`/unlock\` is run.`,
      fields: [
        { name: '📋 Reason', value: reason, inline: false },
        { name: '👮 Locked By', value: `<@${interaction.user.id}>`, inline: true },
      ],
    }, interaction.guild);

    await interaction.editReply({ embeds: [embed] });

    if (channel.id !== interaction.channelId) {
      try {
        await channel.send({ embeds: [createServerEmbed('warning', { title: '🔒 Channel Locked', description: `This channel has been locked by <@${interaction.user.id}>.\n**Reason:** ${reason}` }, interaction.guild)] });
      } catch {}
    }
  },
};
