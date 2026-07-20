const { readJson, writeJson } = require('./jsonStorage');

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

function checkCooldown(userId, action, duration) {
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

module.exports = {
  getBalance,
  setBalance,
  addCoins,
  removeCoins,
  hasEnough,
  getLeaderboard,
  checkCooldown,
  setCooldown,
};
