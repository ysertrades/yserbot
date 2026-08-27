'use strict';

/**
 * utils/pollManager.js
 *
 * Where a poll's votes live.
 *
 * They used to live in a Map on the /poll module and nowhere else, which had
 * two consequences worth naming. A restart wiped every tally — and because the
 * next person to press a button rebuilt the map empty, the visible counts did
 * not merely go stale, they jumped back to zero and started again from that
 * one vote. And because nothing outside that module could see the map, a poll
 * could only be read in the channel it was posted in: no results anywhere
 * else, no way to close one, no way to know a poll existed at all.
 *
 * So the tally is stored, and stored as `userId -> optionIndex` rather than as
 * a set per option. One entry per person is what "one vote each" actually
 * means, so changing a vote is an assignment rather than a search-and-remove
 * across every option, and the same shape answers "how many" and "did I vote"
 * without a second structure.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'polls.json';

/** Discord allows five buttons on a row, and one row is the whole poll. */
const MAX_OPTIONS = 5;
const MAX_QUESTION = 240;
const MAX_OPTION = 80;

/** Kept per guild so one busy server cannot push another's polls out. */
const KEEP_PER_GUILD = 40;
const CLOSED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function all() {
  return readJson(FILE, {});
}

function save(data) {
  writeJson(FILE, data);
}

/**
 * Drops what nobody will look at again: closed polls past their month, and
 * anything beyond the most recent few dozen. Runs on write rather than on a
 * timer, because a write is the only thing that can make the file grow.
 */
function prune(list) {
  const now = Date.now();
  return list
    .filter(p => !(p.closedAt && now - p.closedAt > CLOSED_TTL_MS))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, KEEP_PER_GUILD);
}

function list(guildId) {
  const guild = all()[guildId];
  if (!Array.isArray(guild)) return [];
  return [...guild].sort((a, b) => b.createdAt - a.createdAt);
}

function get(guildId, messageId) {
  return list(guildId).find(p => p.messageId === messageId) || null;
}

/** Votes per option, in option order. */
function tally(poll) {
  const counts = poll.options.map(() => 0);
  for (const index of Object.values(poll.votes || {})) {
    if (counts[index] !== undefined) counts[index] += 1;
  }
  return counts;
}

function totalVotes(poll) {
  return Object.keys(poll.votes || {}).length;
}

function create(guildId, { channelId, messageId, question, options, createdBy, createdByName }) {
  const data = all();
  const poll = {
    messageId,
    channelId,
    question: String(question).slice(0, MAX_QUESTION),
    options: options.slice(0, MAX_OPTIONS).map(o => String(o).slice(0, MAX_OPTION)),
    votes: {},
    createdAt: Date.now(),
    createdBy: createdBy || null,
    createdByName: createdByName || null,
    closedAt: null,
  };
  data[guildId] = prune([...(data[guildId] || []), poll]);
  save(data);
  return poll;
}

/**
 * Records one person's vote, replacing whatever they picked before.
 *
 * Returns null for a poll this store has never seen — the caller decides what
 * that means. It is not the same as an error: a poll posted before any of this
 * existed is a real poll with a real message, just one with no record here.
 */
function vote(guildId, messageId, userId, optionIndex) {
  const data = all();
  const guild = data[guildId];
  if (!Array.isArray(guild)) return null;
  const poll = guild.find(p => p.messageId === messageId);
  if (!poll) return null;
  if (poll.closedAt) return { poll, closed: true };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
    return { poll, invalid: true };
  }

  poll.votes = poll.votes || {};
  const unchanged = poll.votes[userId] === optionIndex;
  poll.votes[userId] = optionIndex;
  save(data);
  return { poll, unchanged };
}

/**
 * Adopts a poll whose record is gone — one posted before this file existed,
 * or one pruned — using the options already printed on its own message. It
 * starts from an empty tally because there is genuinely nothing to recover,
 * but from then on it is a poll like any other rather than one that resets
 * itself every time the bot restarts.
 */
function adopt(guildId, { channelId, messageId, question, options }) {
  const existing = get(guildId, messageId);
  if (existing) return existing;
  return create(guildId, {
    channelId, messageId, question, options,
    createdBy: null, createdByName: null,
  });
}

function close(guildId, messageId) {
  const data = all();
  const poll = (data[guildId] || []).find(p => p.messageId === messageId);
  if (!poll) return null;
  poll.closedAt = poll.closedAt || Date.now();
  save(data);
  return poll;
}

function remove(guildId, messageId) {
  const data = all();
  const before = (data[guildId] || []).length;
  data[guildId] = (data[guildId] || []).filter(p => p.messageId !== messageId);
  if (data[guildId].length === before) return false;
  save(data);
  return true;
}

module.exports = {
  list, get, create, vote, adopt, close, remove, tally, totalVotes,
  MAX_OPTIONS, MAX_QUESTION, MAX_OPTION,
};
