'use strict';

/**
 * modActions.js
 *
 * Warn, timeout, kick and ban, in one place.
 *
 * Three copies of this existed: /warn (via warnUtil), the report card's Take
 * Action buttons, and the auto-mod escalation path — each appending its own
 * case, sending its own DM and writing its own mod-log line, in slightly
 * different orders and with slightly different fields. Adding the control
 * panel would have made four.
 *
 * Case numbering is the part that most wants one owner: every copy computed
 * the next id as `length + 1` against its own read of the file, so two actions
 * close together could be handed the same case number.
 */

const { readJson, writeJson } = require('./jsonStorage');
const { sendModLog, dmUser } = require('./modLog');

const FILE = 'cases.json';

const ACTIONS = {
  warn:    { label: 'warned',    verb: 'Warn' },
  timeout: { label: 'timed out', verb: 'Timeout' },
  kick:    { label: 'kicked',    verb: 'Kick' },
  ban:     { label: 'banned',    verb: 'Ban' },
};

/**
 * The next case number, and the write, in one step.
 *
 * Read-modify-write against the same file is the only safe way to number these
 * while every caller shares it; handing out an id and letting the caller
 * append later is what allowed duplicates.
 */
function appendCase(guildId, entry) {
  const cases = readJson(FILE, {});
  const list = cases[guildId] || [];
  const id = list.length + 1;
  const record = { id, timestamp: Date.now(), ...entry };
  list.push(record);
  cases[guildId] = list;
  writeJson(FILE, cases);
  return record;
}

function casesFor(guildId) {
  return readJson(FILE, {})[guildId] || [];
}

function warningsFor(guildId, userId) {
  return casesFor(guildId).filter(c => c.type === 'warn' && c.userId === userId);
}

/**
 * Clears a member's warnings.
 *
 * The other case types stay: a kick or a ban is a record of something that
 * happened, not a strike that can be forgiven.
 */
function clearWarnings(guildId, userId) {
  const cases = readJson(FILE, {});
  const list = cases[guildId] || [];
  const before = list.length;
  cases[guildId] = list.filter(c => !(c.type === 'warn' && c.userId === userId));
  writeJson(FILE, cases);
  return before - cases[guildId].length;
}

/**
 * Carries out a moderation action end to end.
 *
 * Order matters and is deliberate: the member is told before they are removed,
 * because a kicked or banned member cannot be DMed afterwards. The case is
 * written first so the action is on record even if Discord then refuses it.
 *
 * @param {object} opts
 *   guild, moderator {id, tag}, targetUser, member (may be null), action,
 *   reason, durationMs (timeout only)
 */
async function apply({ guild, moderator, targetUser, member, action, reason, durationMs = 3600000 }) {
  const meta = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!meta) return { ok: false, error: 'bad_action' };

  const record = appendCase(guild.id, {
    type: action, userId: targetUser.id, userTag: targetUser.tag,
    moderatorId: moderator.id, moderatorTag: moderator.tag, reason,
    ...(action === 'timeout' ? { durationMs } : {}),
  });

  // Told first — after a kick or ban there is no channel left to tell them in.
  await dmUser(targetUser, action === 'timeout' ? 'mute' : action, guild, reason, { caseId: record.id }).catch(() => {});

  try {
    if (action === 'kick') {
      if (!member) return { ok: false, error: 'not_in_server', caseId: record.id };
      await member.kick(reason);
    } else if (action === 'ban') {
      await guild.members.ban(targetUser.id, { reason });
    } else if (action === 'timeout') {
      if (!member) return { ok: false, error: 'not_in_server', caseId: record.id };
      await member.timeout(durationMs, reason);
    }
  } catch (err) {
    // The case stays: an attempted action that Discord refused is still worth
    // a record, and silently dropping it would hide a permissions problem.
    return { ok: false, error: 'discord_refused', detail: err.message.slice(0, 140), caseId: record.id };
  }

  await sendModLog(guild, action === 'timeout' ? 'mute' : action, targetUser, moderator, reason, { caseId: record.id }).catch(() => {});

  const warnCount = action === 'warn' ? warningsFor(guild.id, targetUser.id).length : null;
  return { ok: true, caseId: record.id, label: meta.label, warnCount };
}

module.exports = { apply, appendCase, casesFor, warningsFor, clearWarnings, ACTIONS };
