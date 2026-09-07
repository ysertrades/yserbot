'use strict';

/**
 * When a feature group is turned off, disable its slash commands for that
 * guild via Discord command permissions (@everyone = false).
 * Does NOT bulk-rewrite global commands (avoids Entry Point 50240).
 *
 * Note: Discord may still list disabled commands as greyed-out depending
 * on client version — they cannot be used.
 */

const { REST, Routes } = require('discord.js');
const { FEATURE_GROUPS, isFeatureEnabled } = require('./featureToggles');

let nameToIdCache = null;
let cacheAt = 0;
const CACHE_MS = 5 * 60 * 1000;

async function loadCommandIds(rest, clientId) {
  if (nameToIdCache && Date.now() - cacheAt < CACHE_MS) return nameToIdCache;
  const list = await rest.get(Routes.applicationCommands(clientId));
  const map = new Map();
  for (const c of list || []) {
    if (c?.name && c?.id && (c.type === 1 || c.type == null)) map.set(c.name, c.id);
  }
  nameToIdCache = map;
  cacheAt = Date.now();
  return map;
}

/**
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 */
async function applyFeatureCommandPermissions(client, guildId) {
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID || client?.user?.id;
  if (!token || !clientId) return { ok: false, reason: 'missing_env' };

  const rest = new REST({ version: '10' }).setToken(token);
  let nameToId;
  try {
    nameToId = await loadCommandIds(rest, clientId);
  } catch (err) {
    console.warn('[commandVisibility] list commands:', err.message);
    return { ok: false, reason: err.message };
  }

  // Build full permissions payload for every gated command
  const batch = [];
  for (const group of FEATURE_GROUPS) {
    const enabled = isFeatureEnabled(guildId, group.key);
    for (const cmdName of group.commands) {
      const id = nameToId.get(cmdName);
      if (!id) continue;
      batch.push({
        id,
        permissions: enabled
          ? [] // clear overrides → default allow
          : [{ id: guildId, type: 1, permission: false }], // deny @everyone
      });
    }
  }

  if (!batch.length) return { ok: true, count: 0 };

  // Discord caps batch size; chunk to 50
  try {
    for (let i = 0; i < batch.length; i += 50) {
      const chunk = batch.slice(i, i + 50);
      await rest.put(
        Routes.guildApplicationCommandsPermissions(clientId, guildId),
        { body: chunk },
      );
    }
    return { ok: true, count: batch.length };
  } catch (err) {
    // Fallback: per-command PUT (some apps lack batch scope)
    console.warn('[commandVisibility] batch failed, trying per-command:', err.message);
    let ok = 0;
    for (const item of batch) {
      try {
        await rest.put(
          Routes.applicationCommandPermissions(clientId, guildId, item.id),
          { body: { permissions: item.permissions } },
        );
        ok++;
      } catch (e) {
        console.warn('[commandVisibility]', item.id, e.message);
      }
    }
    return { ok: ok > 0, count: ok };
  }
}

module.exports = { applyFeatureCommandPermissions };
