'use strict';

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'link_permits.json';

// A permit is granted by an admin approving a link request, with a cooldown
// they choose. It doesn't mean "unlimited links from now on" — it means
// "exactly one link every `cooldownMs`". Post one, the clock restarts; try
// to post another before the cooldown is up, and the permit is revoked
// entirely, putting the user back to square one (new request required).
function key(guildId, userId) { return `${guildId}:${userId}`; }

function getPermit(guildId, userId) {
  const all = readJson(FILE, {});
  return all[key(guildId, userId)] || null;
}

function grantPermit(guildId, userId, cooldownMs) {
  const all = readJson(FILE, {});
  all[key(guildId, userId)] = { cooldownMs, lastPostAt: Date.now() };
  writeJson(FILE, all);
}

function revokePermit(guildId, userId) {
  const all = readJson(FILE, {});
  delete all[key(guildId, userId)];
  writeJson(FILE, all);
}

/** Restarts the cooldown clock — call when a permitted link is let through. */
function consumePermit(guildId, userId) {
  const all = readJson(FILE, {});
  const k = key(guildId, userId);
  if (!all[k]) return;
  all[k].lastPostAt = Date.now();
  writeJson(FILE, all);
}

/** { allowed, secondsLeft } — allowed=true means the cooldown has elapsed
 *  and this user's next link should be let through automatically. */
function checkPermit(guildId, userId) {
  const permit = getPermit(guildId, userId);
  if (!permit) return { allowed: false, secondsLeft: 0 };
  const elapsed = Date.now() - permit.lastPostAt;
  if (elapsed >= permit.cooldownMs) return { allowed: true, secondsLeft: 0 };
  return { allowed: false, secondsLeft: Math.ceil((permit.cooldownMs - elapsed) / 1000) };
}

module.exports = { getPermit, grantPermit, revokePermit, consumePermit, checkPermit };
