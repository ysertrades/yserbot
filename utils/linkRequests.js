'use strict';

const crypto = require('node:crypto');
const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'link_requests.json';
const LINK_REGEX = /(https?:\/\/\S+)|(\bwww\.\S+\.\S+)/i;

function extractLink(text) {
  const m = String(text || '').match(LINK_REGEX);
  return m ? m[0] : '';
}

function createRequest({ guildId, channelId, userId, userTag, originalContent }) {
  const all = readJson(FILE, {});
  const id  = crypto.randomBytes(6).toString('hex');
  all[id] = {
    id, guildId, channelId, userId, userTag, originalContent,
    link: extractLink(originalContent), reason: '',
    status: 'pending', createdAt: Date.now(),
  };
  writeJson(FILE, all);
  return all[id];
}

function getRequest(id) {
  return readJson(FILE, {})[id] || null;
}

// A user should never be able to have more than one live request at once —
// without this, spamming links and clicking "Request Approval" repeatedly
// would pile up parallel approval cards in the mod-log channel.
function findActiveRequest(guildId, userId) {
  const all = readJson(FILE, {});
  return Object.values(all).find(r =>
    r.guildId === guildId && r.userId === userId &&
    (r.status === 'pending' || r.status === 'pending_review'),
  ) || null;
}

function updateRequest(id, patch) {
  const all = readJson(FILE, {});
  if (!all[id]) return null;
  all[id] = { ...all[id], ...patch };
  writeJson(FILE, all);
  return all[id];
}

/** Fully removes a request record — used to manually clear a stuck/orphaned
 *  request that would otherwise block that user forever via findActiveRequest. */
function deleteRequest(id) {
  const all = readJson(FILE, {});
  delete all[id];
  writeJson(FILE, all);
}

/** Every pending/pending_review request for a guild, for /automod requests. */
function getAllActiveRequests(guildId) {
  const all = readJson(FILE, {});
  return Object.values(all)
    .filter(r => r.guildId === guildId && (r.status === 'pending' || r.status === 'pending_review'))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * What this person has asked for before, so a card can say whether they are a
 * regular or a first-timer. Counted from the same store, so it needs no extra
 * bookkeeping and cannot drift out of step with the requests themselves.
 */
function getUserHistory(guildId, userId) {
  const all = readJson(FILE, {});
  let approved = 0, denied = 0, total = 0;
  for (const r of Object.values(all)) {
    if (r.guildId !== guildId || r.userId !== userId) continue;
    total++;
    if (r.status === 'approved') approved++;
    else if (r.status === 'denied') denied++;
  }
  return { approved, denied, total };
}

/** Recently decided requests, newest first — the panel's history list. */
function getDecidedRequests(guildId, limit = 20) {
  const all = readJson(FILE, {});
  return Object.values(all)
    .filter(r => r.guildId === guildId && (r.status === 'approved' || r.status === 'denied'))
    .sort((a, b) => (b.decidedAt || b.createdAt || 0) - (a.decidedAt || a.createdAt || 0))
    .slice(0, limit);
}

module.exports = {
  createRequest, getRequest, updateRequest, deleteRequest,
  findActiveRequest, getAllActiveRequests, getUserHistory, getDecidedRequests,
  extractLink, LINK_REGEX,
};
