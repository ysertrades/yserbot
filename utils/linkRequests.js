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

function updateRequest(id, patch) {
  const all = readJson(FILE, {});
  if (!all[id]) return null;
  all[id] = { ...all[id], ...patch };
  writeJson(FILE, all);
  return all[id];
}

module.exports = { createRequest, getRequest, updateRequest, extractLink, LINK_REGEX };
