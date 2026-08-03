'use strict';

/**
 * panelPosts.js
 *
 * The messages the Composer has posted, so it can push an update into one
 * later instead of reposting and losing the message's place in the channel.
 *
 * The store only ever grew. Deleting a posted message in Discord left its
 * record behind, so "Already posted" filled up with rows pointing at nothing
 * — and pressing Push update on one of them failed with "message not found"
 * rather than the row simply not being there.
 *
 * Two things keep it honest now, because neither is enough on its own:
 *
 *   · The delete events forget a record the moment its message goes. Free,
 *     instant, and covers the normal case.
 *
 *   · A sweep verifies the rest against Discord when the panel is read. That
 *     is what catches everything the events cannot: messages deleted while
 *     the bot was offline, and every message deleted before any of this
 *     existed. A record with no `checkedAt` has never been verified, which is
 *     exactly the backlog, so the first read of each guild clears it out.
 *
 * The one rule that matters: a record is only ever dropped when Discord says
 * the message is *gone*. A rate limit, a missing permission or a network
 * blip leaves it alone — forgetting a live message would silently take away
 * the ability to update it.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'panel_posts.json';

// Discord's "it does not exist" codes. Anything else is a problem with the
// request, not proof of a deletion.
const GONE_CODES = new Set([
  10003, // Unknown Channel
  10004, // Unknown Guild
  10008, // Unknown Message
]);

// How long a verified record is trusted before it is checked again. The
// delete events cover deletions inside this window, so it only has to be
// short enough to catch what happened while the bot was down.
const RECHECK_MS = 10 * 60 * 1000;

// A ceiling on how much network one panel load will spend on this. Anything
// left over is checked on the next read, so a guild with a long history costs
// a few loads rather than one slow one.
const MAX_CHECKS_PER_SWEEP = 40;
const CONCURRENCY = 8;

/* ─── the store ──────────────────────────────────────────────────────────── */

function allPosts() {
  return readJson(FILE, {});
}

/** Everything remembered for one guild. */
function forGuild(guildId) {
  return allPosts()[guildId] || {};
}

/** One record, or undefined. */
function get(guildId, messageId) {
  return forGuild(guildId)[messageId];
}

/**
 * Records one posted message.
 *
 * Capped so the file cannot grow without bound — the oldest records are the
 * least likely to still point at a message anyone wants to edit.
 */
const MAX_RECORDS = 200;

function remember(guildId, messageId, record) {
  const all = allPosts();
  if (!all[guildId]) all[guildId] = {};
  all[guildId][messageId] = record;

  const entries = Object.entries(all[guildId]).sort((a, b) => (b[1].sentAt || 0) - (a[1].sentAt || 0));
  if (entries.length > MAX_RECORDS) all[guildId] = Object.fromEntries(entries.slice(0, MAX_RECORDS));

  writeJson(FILE, all);
}

/**
 * Drops one or more records.
 *
 * Returns the ids it actually removed, so a caller can tell "this was ours"
 * from "this was some other message" without reading the file twice.
 */
function forget(guildId, messageIds) {
  const ids = Array.isArray(messageIds) ? messageIds : [messageIds];
  const all = allPosts();
  const guild = all[guildId];
  if (!guild) return [];

  const removed = ids.filter(id => Object.hasOwn(guild, id));
  if (!removed.length) return [];

  for (const id of removed) delete guild[id];
  writeJson(FILE, all);
  return removed;
}

/** Marks records as confirmed-alive, so the sweep can skip them for a while. */
function markChecked(guildId, messageIds, at = Date.now()) {
  if (!messageIds.length) return;
  const all = allPosts();
  const guild = all[guildId];
  if (!guild) return;
  for (const id of messageIds) {
    if (guild[id]) guild[id].checkedAt = at;
  }
  writeJson(FILE, all);
}

/* ─── the sweep ──────────────────────────────────────────────────────────── */

/** Whether an error from Discord means the thing is genuinely not there. */
function meansGone(err) {
  return GONE_CODES.has(err?.code) || GONE_CODES.has(err?.rawError?.code);
}

/**
 * Is this message still in Discord?
 *
 * Three answers, not two: 'alive', 'gone', and 'unknown' for anything that
 * did not actually answer the question. Only 'gone' is allowed to delete a
 * record.
 */
async function checkOne(guild, record) {
  let channel = guild.channels?.cache?.get(record.channelId);
  if (!channel) {
    try {
      channel = await guild.channels.fetch(record.channelId);
    } catch (err) {
      return meansGone(err) ? 'gone' : 'unknown';
    }
    if (!channel) return 'gone';
  }
  if (!channel.isTextBased?.()) return 'gone';

  try {
    await channel.messages.fetch(record.messageId);
    return 'alive';
  } catch (err) {
    return meansGone(err) ? 'gone' : 'unknown';
  }
}

/** Runs `worker` over `items`, a few at a time. */
async function pooled(items, limit, worker) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Verifies remembered posts and forgets the ones Discord no longer has.
 *
 * Never throws: this runs on the way to rendering a screen, and a panel that
 * fails to load because a cleanup could not reach Discord would be a far
 * worse trade than a stale row.
 *
 * @returns {Promise<string[]>} the message ids that were dropped
 */
async function prune(guild) {
  if (!guild?.id) return [];
  try {
    const posts = forGuild(guild.id);
    const now = Date.now();

    const due = Object.entries(posts)
      // Never checked first — that is the backlog from before any of this
      // existed, and it is the whole point of the sweep.
      .filter(([, p]) => !p.checkedAt || now - p.checkedAt > RECHECK_MS)
      .sort((a, b) => (a[1].checkedAt || 0) - (b[1].checkedAt || 0))
      .slice(0, MAX_CHECKS_PER_SWEEP)
      .map(([messageId, p]) => ({ ...p, messageId }));

    if (!due.length) return [];

    const results = await pooled(due, CONCURRENCY, r => checkOne(guild, r));

    const gone = [];
    const alive = [];
    due.forEach((r, idx) => {
      if (results[idx] === 'gone') gone.push(r.messageId);
      else if (results[idx] === 'alive') alive.push(r.messageId);
    });

    if (gone.length) forget(guild.id, gone);
    if (alive.length) markChecked(guild.id, alive, now);
    return gone;
  } catch (err) {
    console.error('[PanelPosts] sweep failed (records left as they were):', err.message);
    return [];
  }
}

module.exports = {
  FILE, MAX_RECORDS, RECHECK_MS,
  allPosts, forGuild, get, remember, forget, markChecked, prune,
};
