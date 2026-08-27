'use strict';

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'link_permits.json';

// A permit is granted by an admin approving a link request, with a cooldown
// they choose. It means "exactly one link every `cooldownMs`" — not
// unlimited links from now on, and critically not "one link, then request
// again whenever you feel like it": posting early doesn't just cost the
// permit, it locks the user out of submitting a *new* request until the
// original cooldown would have elapsed anyway. Without that lock, someone
// could burn through the cooldown instantly by spamming "Request Approval"
// and hoping a moderator re-approves — the lock is what actually makes the
// cooldown mean something instead of just gating the automatic pass-through.
function key(guildId, userId) { return `${guildId}:${userId}`; }

function getRecord(guildId, userId) {
  const all = readJson(FILE, {});
  return all[key(guildId, userId)] || null;
}

function setRecord(guildId, userId, record) {
  const all = readJson(FILE, {});
  all[key(guildId, userId)] = record;
  writeJson(FILE, all);
}

function clearRecord(guildId, userId) {
  const all = readJson(FILE, {});
  delete all[key(guildId, userId)];
  writeJson(FILE, all);
}

/** Every permit record for a guild, for the /automod cooldowns list. */
function getAllPermits(guildId) {
  const all    = readJson(FILE, {});
  const prefix = `${guildId}:`;
  return Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, rec]) => ({ userId: k.slice(prefix.length), ...rec }));
}

/** Called when an admin approves a request. Starts the cooldown clock —
 *  the just-approved/reposted link IS their one link for this cycle, so
 *  the next one isn't allowed until a full cooldown from now. */
function grantPermit(guildId, userId, cooldownMs) {
  setRecord(guildId, userId, { cooldownMs, nextAllowedAt: Date.now() + cooldownMs, lockedUntil: 0 });
}

/**
 * Evaluate a link attempt against this user's permit state:
 *  - 'none'    — no permit at all, normal request-approval flow applies
 *  - 'locked'  — they violated their cooldown before; blocked from even
 *                submitting a new request until `secondsLeft` has passed
 *  - 'waiting' — has a permit, cooldown hasn't elapsed yet — posting now
 *                is a fresh violation (caller should lock them)
 *  - 'allowed' — cooldown has elapsed, this link should go through
 */
function evaluate(guildId, userId) {
  const rec = getRecord(guildId, userId);
  if (!rec) return { state: 'none' };
  const now = Date.now();
  if (rec.lockedUntil && now < rec.lockedUntil) {
    return { state: 'locked', secondsLeft: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  if (now < rec.nextAllowedAt) {
    return { state: 'waiting', secondsLeft: Math.ceil((rec.nextAllowedAt - now) / 1000) };
  }
  return { state: 'allowed' };
}

/** A link was let through automatically — restart the cycle. */
function consumeAllowed(guildId, userId) {
  const rec = getRecord(guildId, userId);
  if (!rec) return;
  rec.nextAllowedAt = Date.now() + rec.cooldownMs;
  setRecord(guildId, userId, rec);
}

/** A violation occurred — lock new requests out until the original cooldown
 *  would have elapsed, so repeated "Request Approval" clicks can't shortcut it. */
function lockAfterViolation(guildId, userId) {
  const rec = getRecord(guildId, userId);
  if (!rec) return;
  rec.lockedUntil = rec.nextAllowedAt;
  setRecord(guildId, userId, rec);
}

module.exports = { getRecord, grantPermit, evaluate, consumeAllowed, lockAfterViolation, clearRecord, getAllPermits };
