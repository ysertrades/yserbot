'use strict';

/**
 * web/polls.js
 *
 * Polls, in the panel.
 *
 * /poll could post one and nothing could read one. There was no list of what
 * was running, no results anywhere but the message itself, and no way to stop
 * a poll short of deleting it by hand. This is the other half: what is open,
 * what each one has collected, and the two things you want to do to a poll
 * that has run long enough — close it, or clear it away.
 *
 * Reads and writes go through utils/pollManager, the same store the command
 * uses, so a poll opened in Discord is a poll here and a poll closed here
 * stops taking votes in Discord.
 */

const { PermissionFlagsBits } = require('discord.js');
const polls = require('../utils/pollManager');

/** The shape the panel renders, tallies already counted. */
function shape(poll, guild) {
  const counts = polls.tally(poll);
  const total = polls.totalVotes(poll);
  const channel = guild?.channels?.cache?.get(poll.channelId) || null;
  return {
    messageId: poll.messageId,
    channelId: poll.channelId,
    channel: channel?.name || null,
    question: poll.question,
    options: poll.options.map((label, i) => ({
      label,
      votes: counts[i],
      // Worked out here rather than in the browser so the bar and the number
      // can never disagree about what they are showing.
      share: total > 0 ? Math.round((counts[i] / total) * 100) : 0,
    })),
    total,
    createdAt: poll.createdAt,
    createdByName: poll.createdByName || null,
    closedAt: poll.closedAt || null,
    // A poll whose message is gone can still be cleared away, but there is
    // nothing left to close.
    link: channel ? `https://discord.com/channels/${guild.id}/${poll.channelId}/${poll.messageId}` : null,
  };
}

function read(guildId, guild) {
  const list = polls.list(guildId).map(p => shape(p, guild));
  return {
    open: list.filter(p => !p.closedAt),
    closed: list.filter(p => p.closedAt).slice(0, 10),
    limits: { options: polls.MAX_OPTIONS, question: polls.MAX_QUESTION, option: polls.MAX_OPTION },
  };
}

/**
 * Posts a new poll into a channel.
 *
 * The message is built by the command's own builder, so a poll started from
 * the panel is byte-for-byte the poll /poll would have started — same embed,
 * same buttons, same behaviour when somebody presses one.
 */
async function create(guildId, body, { guild, session }) {
  const question = String(body?.question || '').trim();
  if (!question) return { error: 'no_question' };
  if (question.length > polls.MAX_QUESTION) return { error: 'question_too_long' };

  const options = (Array.isArray(body?.options) ? body.options : [])
    .map(o => String(o || '').trim())
    .filter(Boolean);
  if (options.length < 2) return { error: 'need_two_options' };
  if (options.length > polls.MAX_OPTIONS) return { error: 'too_many_options' };
  if (options.some(o => o.length > polls.MAX_OPTION)) return { error: 'option_too_long' };

  const channel = guild.channels.cache.get(String(body?.channelId || ''));
  if (!channel || !channel.isTextBased?.()) return { error: 'bad_channel' };
  const perms = channel.permissionsFor(guild.members.me);
  if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
    return { error: 'missing_permissions' };
  }

  // Required lazily: commands/ pulls in discord.js builders, and web/api.js
  // reads this module at startup where that is a needless cost.
  const { buildPoll } = require('../commands/utility/poll');
  const draft = {
    messageId: 'pending', channelId: channel.id, question, options,
    votes: {}, createdAt: Date.now(),
    createdBy: session?.uid || null, createdByName: session?.name || null, closedAt: null,
  };

  const msg = await channel.send(buildPoll(draft));
  polls.create(guildId, {
    channelId: channel.id,
    messageId: msg.id,
    question,
    options,
    createdBy: session?.uid || null,
    createdByName: session?.name || null,
  });

  return { ok: true, note: `poll opened in <#${channel.id}> — "${question}"` };
}

/**
 * Stops a poll taking votes, and says so on the message.
 *
 * The buttons come off rather than being left to reject presses: a control
 * that is still there and no longer works is worse than one that is gone.
 */
async function close(guildId, body, { guild }) {
  const messageId = String(body?.messageId || '');
  const existing = polls.get(guildId, messageId);
  if (!existing) return { error: 'unknown_poll' };
  if (existing.closedAt) return { unchanged: true };

  const poll = polls.close(guildId, messageId);
  const { buildPoll } = require('../commands/utility/poll');

  const channel = guild.channels.cache.get(poll.channelId);
  if (channel) {
    // A message somebody deleted is not a failure to close — the poll is
    // closed either way, and the record is what stops the votes.
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (msg) await msg.edit(buildPoll(poll)).catch(() => {});
  }

  return { ok: true, note: `poll closed — "${poll.question}" (${polls.totalVotes(poll)} votes)` };
}

/** Clears the record. The message, if it is still there, is left alone. */
function remove(guildId, body) {
  const messageId = String(body?.messageId || '');
  const existing = polls.get(guildId, messageId);
  if (!existing) return { error: 'unknown_poll' };
  polls.remove(guildId, messageId);
  return { ok: true, note: `poll removed from the list — "${existing.question}"` };
}

module.exports = { read, create, close, remove };
