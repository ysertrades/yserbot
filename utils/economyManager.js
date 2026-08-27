const { readJson, writeJson } = require('./jsonStorage');
const { getEffect } = require('./effectsManager');

const ECONOMY_FILE = 'economy.json';
const COOLDOWNS_FILE = 'cooldowns.json';

function getBalance(userId) {
  const data = readJson(ECONOMY_FILE, {});
  return data[userId] || 0;
}

function setBalance(userId, amount) {
  const data = readJson(ECONOMY_FILE, {});
  data[userId] = Math.max(0, amount);
  writeJson(ECONOMY_FILE, data);
  return data[userId];
}

function addCoins(userId, amount) {
  const current = getBalance(userId);
  return setBalance(userId, current + amount);
}

function removeCoins(userId, amount) {
  const current = getBalance(userId);
  return setBalance(userId, current - amount);
}

function hasEnough(userId, amount) {
  return getBalance(userId) >= amount;
}

function getLeaderboard(limit = 10) {
  const data = readJson(ECONOMY_FILE, {});
  return Object.entries(data)
    .map(([userId, balance]) => ({ userId, balance }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

// `guildId` is optional — when passed and the user has an active Cooldown
// Skip effect in that guild, every cooldown check reports "ready" without
// even touching the stored timestamp, so the bypass just lasts as long as
// the purchased effect does.
function checkCooldown(userId, action, duration, guildId) {
  if (guildId && getEffect(userId, guildId, 'cooldown_skip')) return 0;
  const cooldowns = readJson(COOLDOWNS_FILE, {});
  const key = userId + '_' + action;
  const now = Date.now();
  const expirationTime = (cooldowns[key] || 0) + duration;

  if (now < expirationTime) {
    return expirationTime - now;
  }
  return 0;
}

function setCooldown(userId, action) {
  const cooldowns = readJson(COOLDOWNS_FILE, {});
  const key = userId + '_' + action;
  cooldowns[key] = Date.now();
  writeJson(COOLDOWNS_FILE, cooldowns);
}

function clearCooldown(userId, action) {
  const cooldowns = readJson(COOLDOWNS_FILE, {});
  delete cooldowns[userId + '_' + action];
  writeJson(COOLDOWNS_FILE, cooldowns);
}

// Clears every cooldown key belonging to userId whose action name passes
// matchAction(action) — e.g. skipping every gather/casino/job cooldown at
// once for a "cooldown skip" shop item, without hardcoding every job id.
function clearCooldownsMatching(userId, matchAction) {
  const cooldowns = readJson(COOLDOWNS_FILE, {});
  const prefix = userId + '_';
  let changed = false;
  for (const key of Object.keys(cooldowns)) {
    if (!key.startsWith(prefix)) continue;
    if (matchAction(key.slice(prefix.length))) {
      delete cooldowns[key];
      changed = true;
    }
  }
  if (changed) writeJson(COOLDOWNS_FILE, cooldowns);
  return changed;
}

module.exports = {
  getBalance,
  setBalance,
  addCoins,
  removeCoins,
  hasEnough,
  getLeaderboard,
  checkCooldown,
  setCooldown,
  clearCooldown,
  clearCooldownsMatching,
};
