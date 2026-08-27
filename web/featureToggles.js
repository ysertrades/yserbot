'use strict';

/**
 * web/featureToggles.js
 *
 * The panel's view onto utils/featureToggles.js: every group, its current
 * state, and a save that goes through the same setFeatures() the bot itself
 * reads — so a toggle flipped here takes effect on the very next command or
 * scheduler tick, not on some separate copy of the config.
 */

const { FEATURE_GROUPS, readFlags, setFeatures } = require('../utils/featureToggles');

function read(guildId) {
  const flags = readFlags(guildId);
  return {
    groups: FEATURE_GROUPS.map(g => ({
      key: g.key,
      label: g.label,
      description: g.description,
      enabled: flags[g.key] !== false,
    })),
  };
}

/**
 * @param {string} guildId
 * @param {Record<string, boolean>} body - group key -> desired state
 */
function save(guildId, body) {
  const updates = {};
  const known = new Set(FEATURE_GROUPS.map(g => g.key));
  for (const [key, value] of Object.entries(body || {})) {
    if (!known.has(key)) continue;
    updates[key] = !!value;
  }
  if (Object.keys(updates).length === 0) return { unchanged: true };
  return setFeatures(guildId, updates);
}

module.exports = { read, save };
