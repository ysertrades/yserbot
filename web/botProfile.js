'use strict';

/**
 * web/botProfile.js
 *
 * Bot identity + presence for the control panel.
 *
 * Two layers for identity:
 *   1. GLOBAL (username, avatar, bio) — owner only
 *   2. PER-GUILD nickname — owner or allowGuildNickname flag
 *
 * Presence (status mode + activity text) is owner-only and is stored so it
 * survives restarts.
 */

const { ActivityType } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const auth = require('./auth');

const FLAG_FILE = 'panel_bot_profile.json';

const STATUS_MODES = ['online', 'idle', 'dnd', 'invisible'];
const ACTIVITY_TYPES = {
  playing:   ActivityType.Playing,
  watching:  ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};

function flags() {
  const f = readJson(FLAG_FILE, {});
  return {
    allowGuildNickname: !!f.allowGuildNickname,
    // Presence is kept so a restart does not wipe what the panel set.
    presence: {
      status: STATUS_MODES.includes(f.presence?.status) ? f.presence.status : 'online',
      activityType: f.presence?.activityType && ACTIVITY_TYPES[f.presence.activityType]
        ? f.presence.activityType
        : 'watching',
      activityText: typeof f.presence?.activityText === 'string'
        ? f.presence.activityText.slice(0, 128)
        : '',
    },
  };
}

function setFlags(partial) {
  const cur = flags();
  const next = {
    allowGuildNickname: partial.allowGuildNickname !== undefined
      ? !!partial.allowGuildNickname
      : cur.allowGuildNickname,
    presence: partial.presence
      ? {
          status: STATUS_MODES.includes(partial.presence.status)
            ? partial.presence.status
            : cur.presence.status,
          activityType: partial.presence.activityType && ACTIVITY_TYPES[partial.presence.activityType]
            ? partial.presence.activityType
            : cur.presence.activityType,
          activityText: typeof partial.presence.activityText === 'string'
            ? partial.presence.activityText.slice(0, 128)
            : cur.presence.activityText,
        }
      : cur.presence,
  };
  writeJson(FLAG_FILE, next);
  return flags();
}

/**
 * Apply stored presence to the live client.
 * Call this once after the bot is ready so a restart restores the panel setting.
 */
async function applyStoredPresence(client) {
  const p = flags().presence;
  try {
    await client.user.setPresence({
      status: p.status,
      activities: p.activityText
        ? [{ name: p.activityText, type: ACTIVITY_TYPES[p.activityType] || ActivityType.Watching }]
        : [],
    });
  } catch (err) {
    console.warn('[Panel] could not restore bot presence:', err.message || err);
  }
}

function read(guildId, client, session) {
  const me = client.user;
  const guild = client.guilds.cache.get(guildId);
  const member = guild?.members?.me || null;
  const owner = auth.isOwner(session.uid);
  const f = flags();

  // Live presence from Discord when available; fall back to stored.
  const liveStatus = me?.presence?.status || f.presence.status;
  const liveActivity = me?.presence?.activities?.[0];
  let activityType = f.presence.activityType;
  let activityText = f.presence.activityText;
  if (liveActivity) {
    const typeMap = {
      [ActivityType.Playing]: 'playing',
      [ActivityType.Watching]: 'watching',
      [ActivityType.Listening]: 'listening',
      [ActivityType.Competing]: 'competing',
    };
    activityType = typeMap[liveActivity.type] || activityType;
    activityText = liveActivity.name || activityText;
  }

  return {
    isOwner: owner,
    allowGuildNickname: f.allowGuildNickname,
    canEditNickname: owner || f.allowGuildNickname,
    canEditGlobal: owner,
    canEditPresence: owner,
    global: {
      username: me?.username || null,
      globalName: me?.globalName || me?.username || null,
      avatarUrl: me?.displayAvatarURL?.({ size: 256 }) || null,
      bio: me?.bio ?? null,
    },
    guild: {
      nickname: member?.nickname || null,
      displayName: member?.displayName || me?.username || null,
    },
    presence: {
      status: liveStatus,
      activityType,
      activityText,
    },
  };
}

async function applyGlobal(body, client) {
  const patch = {};

  if ('username' in body) {
    const name = String(body.username || '').trim();
    if (name.length < 2 || name.length > 32) return { error: 'bad_username' };
    patch.username = name;
  }

  let bioValue;
  let hasBio = false;
  if ('bio' in body) {
    hasBio = true;
    if (body.bio == null || body.bio === '') bioValue = null;
    else {
      const bio = String(body.bio);
      if (bio.length > 190) return { error: 'bad_bio' };
      bioValue = bio;
    }
  }

  if ('avatar' in body) {
    if (body.avatar == null || body.avatar === '') {
      patch.avatar = null;
    } else {
      const a = String(body.avatar);
      if (/^https:\/\//i.test(a)) {
        patch.avatar = a;
      } else {
        const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(a);
        if (!m) return { error: 'bad_avatar' };
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > 900 * 1024) return { error: 'bad_avatar' };
        patch.avatar = buf;
      }
    }
  }

  if (!Object.keys(patch).length && !hasBio) return { error: 'nothing_to_change' };

  try {
    if (Object.keys(patch).length) {
      await client.user.edit(patch);
    }
  } catch (err) {
    const msg = String(err?.message || err);
    if (/rate limit|You are changing your username too fast/i.test(msg)) {
      return { error: 'username_rate_limited' };
    }
    console.error('[Panel] bot profile global edit failed:', err);
    return { error: 'discord_rejected', detail: msg.slice(0, 180) };
  }

  if (hasBio) {
    try {
      await client.user.edit({ bio: bioValue });
    } catch (err) {
      console.warn('[Panel] bot bio edit skipped:', err.message || err);
    }
  }

  return {
    ok: true,
    global: {
      username: client.user.username,
      globalName: client.user.globalName || client.user.username,
      avatarUrl: client.user.displayAvatarURL({ size: 256 }),
      bio: client.user.bio ?? bioValue ?? null,
    },
  };
}

async function applyNickname(guildId, nickname, client) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { error: 'unknown_guild' };
  const me = guild.members.me;
  if (!me) return { error: 'not_in_guild' };

  let nick = nickname == null ? null : String(nickname).trim();
  if (nick === '') nick = null;
  if (nick && nick.length > 32) return { error: 'bad_nickname' };

  try {
    await me.setNickname(nick, 'Panel: bot nickname');
  } catch (err) {
    const msg = String(err?.message || err);
    if (/Missing Permissions|Missing Access/i.test(msg)) {
      return { error: 'missing_permission' };
    }
    console.error('[Panel] bot nickname failed:', err);
    return { error: 'discord_rejected' };
  }

  return {
    ok: true,
    guild: {
      nickname: me.nickname || null,
      displayName: me.displayName,
    },
  };
}

/**
 * Owner-only. Sets status mode + optional activity text and persists it.
 */
async function applyPresence(body, client) {
  if (!client?.user) return { error: 'discord_rejected', detail: 'Bot user not ready yet.' };

  const status = String(body?.status || '').toLowerCase();
  if (!STATUS_MODES.includes(status)) return { error: 'bad_status' };

  let activityType = String(body?.activityType || 'watching').toLowerCase();
  if (!ACTIVITY_TYPES[activityType]) activityType = 'watching';

  let activityText = body?.activityText == null ? '' : String(body.activityText).trim();
  if (activityText.length > 128) return { error: 'bad_activity' };

  try {
    // Prefer setPresence (status + activities together). Fall back to the
    // older split calls if a host is on a discord.js build that rejects the
    // combined form.
    if (typeof client.user.setPresence === 'function') {
      await client.user.setPresence({
        status,
        activities: activityText
          ? [{ name: activityText, type: ACTIVITY_TYPES[activityType] }]
          : [],
      });
    } else {
      if (typeof client.user.setStatus === 'function') await client.user.setStatus(status);
      if (activityText) {
        await client.user.setActivity(activityText, { type: ACTIVITY_TYPES[activityType] });
      } else if (typeof client.user.setActivity === 'function') {
        await client.user.setActivity(null);
      }
    }
  } catch (err) {
    const msg = String(err?.message || err);
    console.error('[Panel] bot presence failed:', err);
    return { error: 'discord_rejected', detail: msg.slice(0, 180) };
  }

  // Persist so a restart restores it.
  setFlags({
    presence: { status, activityType, activityText },
  });

  return {
    ok: true,
    presence: { status, activityType, activityText },
  };
}

module.exports = {
  flags,
  setFlags,
  read,
  applyGlobal,
  applyNickname,
  applyPresence,
  applyStoredPresence,
  STATUS_MODES,
  ACTIVITY_TYPES,
};
