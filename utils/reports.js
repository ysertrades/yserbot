'use strict';

/**
 * reports.js
 *
 * Where user reports live.
 *
 * They did not live anywhere before. /report built an embed, posted it to the
 * report channel with a Take Action button, and that message *was* the record
 * — so a report could only be found by scrolling the channel it landed in, and
 * nothing outside Discord could see the queue at all.
 *
 * The Discord message is still the thing staff see first; this is the record
 * behind it. `messageId` keeps the two attached so a report handled from the
 * panel can strike through the card in the channel, and one handled from the
 * channel disappears from the panel.
 */

const crypto = require('node:crypto');
const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'reports.json';

// Enough history to be useful without the file growing without bound on a
// busy server. Handled reports are the ones trimmed; open ones never are.
const KEEP_HANDLED = 200;

function create({ guildId, channelId, messageId, reporterId, reporterTag, targetId, targetTag, reason, link }) {
  const all = readJson(FILE, {});
  const id = crypto.randomBytes(6).toString('hex');
  all[id] = {
    id, guildId, channelId, messageId,
    reporterId, reporterTag, targetId, targetTag,
    reason: reason || '', link: link || '',
    status: 'open', createdAt: Date.now(),
    handledBy: null, handledAt: null, action: null,
  };
  writeJson(FILE, prune(all));
  return all[id];
}

function get(id) {
  return readJson(FILE, {})[id] || null;
}

function update(id, patch) {
  const all = readJson(FILE, {});
  if (!all[id]) return null;
  all[id] = { ...all[id], ...patch };
  writeJson(FILE, all);
  return all[id];
}

function remove(id) {
  const all = readJson(FILE, {});
  delete all[id];
  writeJson(FILE, all);
}

/** Open reports, oldest first — the order they should be worked through. */
function open(guildId) {
  return Object.values(readJson(FILE, {}))
    .filter(r => r.guildId === guildId && r.status === 'open')
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Recently handled, newest first. */
function handled(guildId, limit = 20) {
  return Object.values(readJson(FILE, {}))
    .filter(r => r.guildId === guildId && r.status !== 'open')
    .sort((a, b) => (b.handledAt || 0) - (a.handledAt || 0))
    .slice(0, limit);
}

/**
 * Finds the record behind a Discord report card.
 *
 * The Take Action button predates this store, so its custom id carries the
 * target and channel rather than a report id. Matching on the message is what
 * lets an old button still mark the right record handled.
 */
function findByMessage(guildId, messageId) {
  return Object.values(readJson(FILE, {}))
    .find(r => r.guildId === guildId && r.messageId === messageId) || null;
}

/** How many times this member has been reported, and how those went. */
function historyFor(guildId, targetId) {
  let open = 0, actioned = 0, dismissed = 0;
  for (const r of Object.values(readJson(FILE, {}))) {
    if (r.guildId !== guildId || r.targetId !== targetId) continue;
    if (r.status === 'open') open++;
    else if (r.status === 'dismissed') dismissed++;
    else actioned++;
  }
  return { open, actioned, dismissed, total: open + actioned + dismissed };
}

function prune(all) {
  const done = Object.values(all)
    .filter(r => r.status !== 'open')
    .sort((a, b) => (b.handledAt || 0) - (a.handledAt || 0));
  for (const stale of done.slice(KEEP_HANDLED)) delete all[stale.id];
  return all;
}

module.exports = { create, get, update, remove, open, handled, findByMessage, historyFor };
