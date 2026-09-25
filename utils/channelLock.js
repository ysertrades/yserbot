'use strict';

/**
 * Channel lock / unlock — shared by /lock, /unlock, emoji shortcuts, and panel.
 * Modes deny different permission sets on @everyone while keeping mod/admin access.
 */

const { PermissionFlagsBits } = require('discord.js');
const { readJson, writeJson } = require('./jsonStorage');

const LOCK_FILE = 'locked_channels.json';

const MODES = {
  chat: {
    label: 'Chat only',
    blurb: 'Blocks sending messages and threads',
    perms: ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'],
  },
  media: {
    label: 'Chat + media',
    blurb: 'Blocks messages, files, embeds, and reactions',
    perms: [
      'SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads',
      'AttachFiles', 'EmbedLinks', 'AddReactions',
    ],
  },
  full: {
    label: 'Full lockdown',
    blurb: 'Blocks messages, media, reactions, and external emoji/stickers',
    perms: [
      'SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads',
      'AttachFiles', 'EmbedLinks', 'AddReactions',
      'UseExternalEmojis', 'UseExternalStickers',
    ],
  },
};

function modeKeys() {
  return Object.keys(MODES);
}

function resolveMode(mode) {
  const m = String(mode || 'chat').toLowerCase();
  return MODES[m] ? m : 'chat';
}

function _modAdminRoleIds(guildId) {
  const config = readJson('config.json', {});
  const setup = config[guildId]?.cmdSetup || {};
  return [...new Set([...(setup.modRoles || []), ...(setup.adminRoles || [])])];
}

function _snapshot(channel, roleId, perms) {
  const ow = channel.permissionOverwrites.cache.get(roleId);
  const snap = {};
  for (const perm of perms) {
    if (!PermissionFlagsBits[perm]) continue;
    if (ow?.allow.has(PermissionFlagsBits[perm])) snap[perm] = true;
    else if (ow?.deny.has(PermissionFlagsBits[perm])) snap[perm] = false;
    else snap[perm] = null;
  }
  return snap;
}

function listLocked(guildId, guild) {
  const locks = readJson(LOCK_FILE, {});
  const map = locks[guildId] || {};
  const out = [];
  for (const [channelId, rec] of Object.entries(map)) {
    const ch = guild?.channels?.cache?.get(channelId);
    out.push({
      channelId,
      channelName: ch?.name || rec.channelName || channelId,
      mode: rec.mode || 'chat',
      modeLabel: (MODES[rec.mode] || MODES.chat).label,
      reason: rec.reason || null,
      lockedBy: rec.lockedBy || null,
      lockedByTag: rec.lockedByTag || null,
      timestamp: rec.timestamp || null,
    });
  }
  out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  return out;
}

function isLocked(guildId, channelId) {
  const locks = readJson(LOCK_FILE, {});
  return !!(locks[guildId] && locks[guildId][channelId]);
}

/**
 * @returns {{ ok: boolean, error?: string, record?: object }}
 */
async function lockChannel(channel, {
  guildId,
  mode = 'chat',
  reason = null,
  lockedBy = null,
  lockedByTag = null,
}) {
  if (!channel?.isTextBased?.() || channel.isThread?.()) {
    return { ok: false, error: 'not_text' };
  }
  const locks = readJson(LOCK_FILE, {});
  if (locks[guildId]?.[channel.id]) {
    return { ok: false, error: 'already_locked' };
  }

  const modeKey = resolveMode(mode);
  const perms = MODES[modeKey].perms;
  const everyoneId = channel.guild.roles.everyone.id;
  const modAdminRoleIds = _modAdminRoleIds(guildId);

  const snapshot = { everyone: _snapshot(channel, everyoneId, perms), roles: {} };
  for (const roleId of modAdminRoleIds) {
    snapshot.roles[roleId] = _snapshot(channel, roleId, perms);
  }

  try {
    const denyAll = Object.fromEntries(perms.map((p) => [p, false]));
    await channel.permissionOverwrites.edit(everyoneId, denyAll, {
      reason: `Channel locked (${modeKey}) by ${lockedByTag || lockedBy || 'staff'}${reason ? `: ${reason}` : ''}`,
    });
    for (const roleId of modAdminRoleIds) {
      const allowAll = Object.fromEntries(perms.map((p) => [p, true]));
      await channel.permissionOverwrites.edit(roleId, allowAll, {
        reason: `Channel locked: keep mod/admin access`,
      });
    }
  } catch (err) {
    console.error('[channelLock.lock]', err);
    return { ok: false, error: 'perm_failed', detail: err.message };
  }

  if (!locks[guildId]) locks[guildId] = {};
  const record = {
    snapshot,
    mode: modeKey,
    perms,
    reason,
    channelName: channel.name,
    lockedBy,
    lockedByTag,
    timestamp: Date.now(),
  };
  locks[guildId][channel.id] = record;
  writeJson(LOCK_FILE, locks);
  return { ok: true, record, mode: modeKey };
}

async function unlockChannel(channel, { guildId, unlockedByTag = null }) {
  const locks = readJson(LOCK_FILE, {});
  const record = locks[guildId]?.[channel.id];
  if (!record) return { ok: false, error: 'not_locked' };

  try {
    if (record.snapshot?.everyone) {
      await channel.permissionOverwrites.edit(
        channel.guild.roles.everyone.id,
        record.snapshot.everyone,
        { reason: `Channel unlocked by ${unlockedByTag || 'staff'}` },
      );
    }
    for (const [roleId, perms] of Object.entries(record.snapshot?.roles || {})) {
      if (!channel.guild.roles.cache.has(roleId)) continue;
      await channel.permissionOverwrites.edit(roleId, perms, {
        reason: `Channel unlocked by ${unlockedByTag || 'staff'}`,
      });
    }
  } catch (err) {
    console.error('[channelLock.unlock]', err);
    return { ok: false, error: 'perm_failed', detail: err.message };
  }

  delete locks[guildId][channel.id];
  writeJson(LOCK_FILE, locks);
  return { ok: true };
}

function isStaffMember(member) {
  if (!member) return false;
  try {
    if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    if (member.permissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  } catch {}
  return false;
}

module.exports = {
  LOCK_FILE,
  MODES,
  modeKeys,
  resolveMode,
  listLocked,
  isLocked,
  lockChannel,
  unlockChannel,
  isStaffMember,
};
