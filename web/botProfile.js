'use strict';

/**
 * web/botProfile.js
 *
 * Bot identity for the control panel.
 *
 * Two layers, on purpose:
 *
 *   1. GLOBAL (username, avatar, bio) — one bot, one face. Changing these
 *      changes the bot in every server at once. Only PANEL_OWNER_IDS may
 *      touch them. Discord rate-limits username changes hard; the panel
 *      surfaces that instead of pretending it is free.
 *
 *   2. PER-GUILD nickname — the only identity a single server can own without
 *      stepping on every other server. Guild owners may set it only when the
 *      operator has flipped allowGuildNickname on.
 *
 * The master switch lives in panel_bot_profile.json so a revoke is immediate
 * and does not depend on a session snapshot.
 */

const { readJson, writeJson } = require('../utils/jsonStorage');
const auth = require('./auth');

const FLAG_FILE = 'panel_bot_profile.json';

function flags() {
  const f = readJson(FLAG_FILE, {});
  return {
    // Default off: server owners cannot rename the bot in their server until
    // the operator turns it on. Safer for a multi-tenant bot.
    allowGuildNickname: !!f.allowGuildNickname,
  };
}

function setFlags(partial) {
  const next = { ...flags(), ...partial };
  writeJson(FLAG_FILE, {
    allowGuildNickname: !!next.allowGuildNickname,
  });
  return flags();
}

/**
 * What the panel needs to render the Bot profile card for one guild.
 * Global fields are always present for the owner; nickname is always the
 * current guild nick; the allow flag tells non-owners whether the nick
 * field is editable.
 */
function read(guildId, client, session) {
  const me = client.user;
  const guild = client.guilds.cache.get(guildId);
  const member = guild?.members?.me || null;
  const owner = auth.isOwner(session.uid);
  const f = flags();

  return {
    isOwner: owner,
    allowGuildNickname: f.allowGuildNickname,
    canEditNickname: owner || f.allowGuildNickname,
    canEditGlobal: owner,
    global: {
      username: me?.username || null,
      // Global display name when the bot has one set; falls back to username.
      globalName: me?.globalName || me?.username || null,
      avatarUrl: me?.displayAvatarURL?.({ size: 256 }) || null,
      // Discord exposes bio on some user payloads; keep null when absent.
      bio: me?.bio ?? null,
    },
    guild: {
      nickname: member?.nickname || null,
      displayName: member?.displayName || me?.username || null,
    },
  };
}

/**
 * Apply a global identity change. Owner only — enforced by the caller too.
 *
 * body may carry:
 *   username  string (2–32)
 *   bio       string (0–190) or null to clear
 *   avatar    data URI (image/png|jpeg|gif|webp) or null to clear
 *
 * Returns { ok, profile } or { error }.
 */
async function applyGlobal(body, client) {
  const patch = {};

  if ('username' in body) {
    const name = String(body.username || '').trim();
    if (name.length < 2 || name.length > 32) return { error: 'bad_username' };
    patch.username = name;
  }

  if ('bio' in body) {
    if (body.bio == null || body.bio === '') {
      patch.bio = null;
    } else {
      const bio = String(body.bio);
      if (bio.length > 190) return { error: 'bad_bio' };
      patch.bio = bio;
    }
  }

  if ('avatar' in body) {
    if (body.avatar == null || body.avatar === '') {
      patch.avatar = null;
    } else {
      const a = String(body.avatar);
      // discord.js setAvatar accepts a Buffer, path, or data URI. We only
      // accept https URLs or data URIs so a panel cannot feed a local path.
      if (!/^https:\/\//i.test(a) && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(a)) {
        return { error: 'bad_avatar' };
      }
      patch.avatar = a;
    }
  }

  if (!Object.keys(patch).length) return { error: 'nothing_to_change' };

  try {
    await client.user.edit(patch);
  } catch (err) {
    // Username changes are tightly rate-limited; surface that cleanly.
    const msg = String(err?.message || err);
    if (/rate limit|You are changing your username too fast/i.test(msg)) {
      return { error: 'username_rate_limited' };
    }
    console.error('[Panel] bot profile global edit failed:', err);
    return { error: 'discord_rejected' };
  }

  return {
    ok: true,
    global: {
      username: client.user.username,
      globalName: client.user.globalName || client.user.username,
      avatarUrl: client.user.displayAvatarURL({ size: 256 }),
      bio: client.user.bio ?? null,
    },
  };
}

/**
 * Set the bot's nickname in one guild. Empty string clears it.
 */
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

module.exports = {
  flags, setFlags, read, applyGlobal, applyNickname,
};
