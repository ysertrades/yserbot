'use strict';

/**
 * Panel feature toggles. On save, updates Discord command permissions for
 * this guild so disabled features' commands cannot be used.
 * Does not touch global command registration or ready.js.
 */

const { FEATURE_GROUPS, readFlags, setFeatures } = require('../utils/featureToggles');
const { applyFeatureCommandPermissions } = require('../utils/commandVisibility');

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

async function save(guildId, body, ctx = {}) {
  const updates = {};
  const known = new Set(FEATURE_GROUPS.map(g => g.key));
  for (const [key, value] of Object.entries(body || {})) {
    if (!known.has(key)) continue;
    updates[key] = !!value;
  }
  if (Object.keys(updates).length === 0) return { unchanged: true };

  const result = setFeatures(guildId, updates);
  if (result.unchanged) return result;

  if (ctx.client) {
    try {
      await applyFeatureCommandPermissions(ctx.client, guildId);
    } catch (err) {
      console.warn('[featureToggles] command visibility:', err.message);
    }
  }
  // Return fresh groups so the panel can update nav/toggles without a refresh.
  return { ...result, featureToggles: read(guildId) };
}

module.exports = { read, save };
