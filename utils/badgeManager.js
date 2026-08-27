'use strict';

const { readJson, writeJson } = require('./jsonStorage');
const FILE = 'badges.json';
const MAX_EQUIPPED = 3;

function key(userId, guildId) {
  return `${userId}_${guildId}`;
}

function getEquipped(userId, guildId) {
  const data = readJson(FILE, {});
  return data[key(userId, guildId)]?.equipped || [];
}

function isEquipped(userId, guildId, itemId) {
  return getEquipped(userId, guildId).includes(itemId);
}

// Equips itemId if not already equipped (fails once MAX_EQUIPPED is hit),
// or unequips it if it already is. Returns { ok, action, equipped } —
// action is 'equipped'/'unequipped' on success, absent when ok is false.
function toggleEquip(userId, guildId, itemId) {
  const data = readJson(FILE, {});
  const k = key(userId, guildId);
  if (!data[k]) data[k] = { equipped: [] };
  const list = data[k].equipped;

  const idx = list.indexOf(itemId);
  if (idx !== -1) {
    list.splice(idx, 1);
    writeJson(FILE, data);
    return { ok: true, action: 'unequipped', equipped: list };
  }

  if (list.length >= MAX_EQUIPPED) {
    return { ok: false, equipped: list };
  }

  list.push(itemId);
  writeJson(FILE, data);
  return { ok: true, action: 'equipped', equipped: list };
}

// Idempotent grant — used for automatic awards (a level threshold) where
// calling it twice must never undo the first grant, unlike toggleEquip()
// above which is built for a person clicking a button themselves. Silently
// no-ops once full rather than bumping something the member chose to keep
// equipped.
function equip(userId, guildId, itemId) {
  const data = readJson(FILE, {});
  const k = key(userId, guildId);
  if (!data[k]) data[k] = { equipped: [] };
  const list = data[k].equipped;
  if (list.includes(itemId)) return { ok: true, already: true, equipped: list };
  if (list.length >= MAX_EQUIPPED) return { ok: false, equipped: list };
  list.push(itemId);
  writeJson(FILE, data);
  return { ok: true, equipped: list };
}

module.exports = { MAX_EQUIPPED, getEquipped, isEquipped, toggleEquip, equip };
