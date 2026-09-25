'use strict';

/**
 * Channel lock / unlock — panel + Discord 🔒/🔓.
 * Two modes only: media (chat+files; reactions left alone) and full.
 */

const { PermissionFlagsBits } = require('discord.js');
const { readJson, writeJson } = require('./jsonStorage');

const LOCK_FILE = 'locked_channels.json';

const MODES = {
  media: {
    label: 'Chat + media',
    blurb: 'No messages or files',
    perms: [
      'SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads',
      'AttachFiles', 'EmbedLinks',
    ],
  },
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

function resolveMode(mode) {
  let m = String(mode || 'media').toLowerCase().trim();
  if (m === 'chat') m = 'media';
  return MODES[m] ? m : 'media';
}

function modePerms(modeKey) {
  const list = (MODES[modeKey] || MODES.media).perms;
  return Array.isArray(list) ? list.filter((p) => PermissionFlagsBits[p]) : MODES.media.perms.slice();
}

function _modAdminRoleIds(guildId, guild) {
  const config = readJson('config.json', {});
  const setup = (config[guildId] && config[guildId].cmdSetup) || {};
  const ids = [...new Set([...(setup.modRoles || []), ...(setup.adminRoles || [])])]
    .filter((id) => id && (!guild || guild.roles.cache.has(id)));
  return ids;
}

function _snapshot(channel, roleId, perms) {
  const ow = channel.permissionOverwrites?.cache?.get(roleId);
  const snap = {};
  for (const perm of perms) {
    if (!PermissionFlagsBits[perm]) continue;
    try {
      if (ow?.allow?.has?.(PermissionFlagsBits[perm])) snap[perm] = true;
      else if (ow?.deny?.has?.(PermissionFlagsBits[perm])) snap[perm] = false;
      else snap[perm] = null;
    } catch {
      snap[perm] = null;
    }
  }
  return snap;
}

function listLocked(guildId, guild) {
  const locks = readJson(LOCK_FILE, {});
  const map = locks[guildId] || {};
  const out = [];
  for (const [channelId, rec] of Object.entries(map)) {
    if (!rec || typeof rec !== 'object') continue;
    const ch = guild?.channels?.cache?.get(channelId);
    const mode = resolveMode(rec.mode);
    out.push({
      channelId,
      channelName: ch?.name || rec.channelName || channelId,
      mode,
      modeLabel: (MODES[mode] || MODES.media).label,
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

async function lockChannel(channel, {
  guildId,
  mode = 'media',
  reason = null,
  lockedBy = null,
  lockedByTag = null,
}) {
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    return { ok: false, error: 'not_text', detail: 'Not a text channel' };
  }
  if (typeof channel.isThread === 'function' && channel.isThread()) {
    return { ok: false, error: 'not_text', detail: 'Cannot lock a thread' };
  }

  const locks = readJson(LOCK_FILE, {});
  if (locks[guildId]?.[channel.id]) {
    return { ok: false, error: 'already_locked', detail: 'Already locked' };
  }

  const modeKey = resolveMode(mode);
  const perms = modePerms(modeKey);
  if (!perms.length) {
    return { ok: false, error: 'bad_mode', detail: 'No permissions for mode' };
  }

  const everyoneId = channel.guild.roles.everyone.id;
  const modAdminRoleIds = _modAdminRoleIds(guildId, channel.guild);

  const snapshot = {
    everyone: _snapshot(channel, everyoneId, perms),
    roles: {},
  };
  for (const roleId of modAdminRoleIds) {
    snapshot.roles[roleId] = _snapshot(channel, roleId, perms);
  }

  const denyAll = {};
  for (const p of perms) denyAll[p] = false;
  const allowAll = {};
  for (const p of perms) allowAll[p] = true;

  try {
    const jobs = [
      channel.permissionOverwrites.edit(everyoneId, denyAll, {
        reason: `Lock (${modeKey}) by ${lockedByTag || lockedBy || 'staff'}${reason ? `: ${reason}` : ''}`,
      }),
    ];
    for (const roleId of modAdminRoleIds) {
      jobs.push(channel.permissionOverwrites.edit(roleId, allowAll, {
        reason: 'Lock: keep staff access',
      }));
    }
    await Promise.all(jobs);
  } catch (err) {
    console.error('[channelLock.lock]', err);
    return {
      ok: false,
      error: 'perm_failed',
      detail: String(err?.message || err).slice(0, 180),
    };
  }

  if (!locks[guildId]) locks[guildId] = {};
  locks[guildId][channel.id] = {
    snapshot,
    mode: modeKey,
    perms,
    reason,
    channelName: channel.name,
    lockedBy,
    lockedByTag,
    timestamp: Date.now(),
  };
  writeJson(LOCK_FILE, locks);
  return { ok: true, mode: modeKey };
}

async function unlockChannel(channel, { guildId, unlockedByTag = null }) {
  const locks = readJson(LOCK_FILE, {});
  if (!locks[guildId] || !locks[guildId][channel.id]) {
    return { ok: false, error: 'not_locked', detail: 'Not locked' };
  }
  const record = locks[guildId][channel.id];
  const snap = record && typeof record.snapshot === 'object' ? record.snapshot : {};
  const everyoneSnap = snap.everyone && typeof snap.everyone === 'object' ? snap.everyone : null;
  const roleSnaps = snap.roles && typeof snap.roles === 'object' ? snap.roles : {};

  try {
    const jobs = [];
    if (everyoneSnap && channel.guild?.roles?.everyone) {
      jobs.push(channel.permissionOverwrites.edit(
        channel.guild.roles.everyone.id,
        everyoneSnap,
        { reason: `Unlock by ${unlockedByTag || 'staff'}` },
      ));
    }
    for (const [roleId, overwrite] of Object.entries(roleSnaps)) {
      if (!overwrite || typeof overwrite !== 'object') continue;
      if (!channel.guild.roles.cache.has(roleId)) continue;
      jobs.push(channel.permissionOverwrites.edit(roleId, overwrite, {
        reason: `Unlock by ${unlockedByTag || 'staff'}`,
      }));
    }
    if (jobs.length) await Promise.all(jobs);
  } catch (err) {
    console.error('[channelLock.unlock]', err);
    return {
      ok: false,
      error: 'perm_failed',
      detail: String(err?.message || err).slice(0, 180),
    };
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
