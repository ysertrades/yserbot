'use strict';

/**
 * mentionTarget.js
 *
 * Who a posted message pings, in the one shape everything agrees on.
 *
 * There are two halves to this and they were in different files: the panel
 * checked what you picked (web/features.js) and the schedule runner worked out
 * what to actually send (utils/scheduleRunner.js). The Composer needed both,
 * which would have been a third copy, so they live here together.
 *
 * The rule the whole thing exists to enforce: a ping happens because somebody
 * chose it, never because a message happened to contain the text. `parse: []`
 * is the default in every path, and the returned allowedMentions only ever
 * permits the one target that was picked — so an @everyone typed into a
 * template's body stays inert no matter who posts it.
 */

/**
 * What a picked value means, or null for "no ping".
 *
 * Returns undefined — distinct from null — when the value is not something
 * this guild can ping, so a caller can tell "left blank" from "sent a role id
 * that does not exist here" and refuse the second.
 *
 * @param {string|null} value  '@everyone', '@here', a role id, or <@&id>
 * @param {object} guild       needed to confirm the role is really this guild's
 */
function normaliseMention(value, guild) {
  if (!value) return null;
  if (value === '@everyone' || value === '@here') return value;
  const id = String(value).replace(/^<@&|>$/g, '');
  if (guild?.roles?.cache?.has(id)) return `<@&${id}>`;
  return undefined;
}

/**
 * The line to put above a post, and the allowedMentions that make it ring.
 *
 * Accepts more shapes than normaliseMention returns, because /schedule takes
 * its mention as free text — a bare id or a user mention are both things
 * somebody has typed into it, and both worked before this was shared code.
 *
 * Anything unrecognised is passed through as plain text with pinging off,
 * which is the safe half of the old behaviour: it still reads as intended and
 * simply does not notify.
 *
 * @returns {{text: string|null, allowedMentions: object}}
 */
function mentionSend(mention) {
  const off = { parse: [] };
  if (!mention) return { text: null, allowedMentions: off };

  if (mention === '@everyone') return { text: '@everyone', allowedMentions: { parse: ['everyone'] } };
  if (mention === '@here')     return { text: '@here',     allowedMentions: { parse: ['here'] } };

  const role = String(mention).match(/^<@&(\d+)>$/) || String(mention).match(/^(\d+)$/);
  if (role) return { text: `<@&${role[1]}>`, allowedMentions: { roles: [role[1]] } };

  const user = String(mention).match(/^<@!?(\d+)>$/);
  if (user) return { text: `<@${user[1]}>`, allowedMentions: { users: [user[1]] } };

  return { text: String(mention), allowedMentions: off };
}

module.exports = { normaliseMention, mentionSend };
