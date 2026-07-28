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

module.exports = {
  createRequest, getRequest, updateRequest, deleteRequest,
  findActiveRequest, getAllActiveRequests, extractLink, LINK_REGEX,
};
