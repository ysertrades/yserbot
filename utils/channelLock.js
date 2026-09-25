'use strict';

/**
 * Channel lock / unlock — shared by /lock, /unlock, emoji shortcuts, and panel.
 * Modes deny different permission sets on @everyone while keeping mod/admin access.
 */

const { PermissionFlagsBits } = require('discord.js');
const { readJson, writeJson } = require('./jsonStorage');

const LOCK_FILE = 'locked_channels.json';

const MODES = {
  // Default lock: silence chat + uploads. Reactions stay as the channel already allows.
  media: {
    label: 'Chat + media',
    blurb: 'No messages or files',
    perms: [
      'SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads',
      'AttachFiles', 'EmbedLinks',
    ],
  },
  // Hard lock: nothing through — including reactions and external emoji/stickers.
  full: {
    label: 'Full lockdown',
    blurb: 'No messages, files, or reactions',
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

/** Normalize mode; legacy "chat" maps to media (new default). */
function resolveMode(mode) {
  let m = String(mode || 'media').toLowerCase();
  if (m === 'chat') m = 'media';
  return MODES[m] ? m : 'media';
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
      mode: resolveMode(rec.mode),
      modeLabel: (MODES[resolveMode(rec.mode)] || MODES.media).label,
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
  mode = 'media',
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
  const perms = (MODES[modeKey] || MODES.media).perms;
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
  if (!locks[guildId] || !locks[guildId][channel.id]) {
    return { ok: false, error: 'not_locked' };
  }
  const record = locks[guildId][channel.id];
  const snap = record.snapshot && typeof record.snapshot === 'object' ? record.snapshot : {};
  const everyoneSnap = snap.everyone && typeof snap.everyone === 'object' ? snap.everyone : null;
  const roleSnaps = snap.roles && typeof snap.roles === 'object' ? snap.roles : {};

  try {
    if (everyoneSnap && channel.guild?.roles?.everyone) {
      await channel.permissionOverwrites.edit(
        channel.guild.roles.everyone.id,
        everyoneSnap,
        { reason: `Channel unlocked by ${unlockedByTag || 'staff'}` },
      );
    }
    for (const [roleId, overwrite] of Object.entries(roleSnaps)) {
      if (!overwrite || typeof overwrite !== 'object') continue;
      if (!channel.guild.roles.cache.has(roleId)) continue;
      await channel.permissionOverwrites.edit(roleId, overwrite, {
        reason: `Channel unlocked by ${unlockedByTag || 'staff'}`,
      });
    }
  } catch (err) {
    console.error('[channelLock.unlock]', err);
    return { ok: false, error: 'perm_failed', detail: String(err && err.message || err) };
  }

  delete locks[guildId][channel.id];
  if (!Object.keys(locks[guildId]).length) delete locks[guildId];
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
