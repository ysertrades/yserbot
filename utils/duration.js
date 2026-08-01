'use strict';

/**
 * duration.js
 *
 * The `10s` / `10m` / `10h` / `10d` format the bot already accepts.
 *
 * This exact parser was written out three times — /mute, /giveaway and
 * /coinsgiveaway each had their own byte-identical copy — and the panel needed
 * a fourth. One copy instead, so the panel cannot drift into accepting
 * something the slash commands reject, or the other way round.
 *
 * Semantics are unchanged from those three: a whole number followed by one
 * unit letter, nothing else. Deliberately not compound (`1h30m`) — the
 * commands never took it, and the panel accepting more than they do would be
 * its own kind of inconsistency.
 */

const UNIT_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000 };

/**
 * @param   {string} str e.g. "30m"
 * @returns {number|null} milliseconds, or null when it does not parse
 */
function parseDuration(str) {
  const match = String(str ?? '').trim().match(/^(\d+)([smhd])$/i);
  if (!match) return null;
  const ms = parseInt(match[1], 10) * UNIT_MS[match[2].toLowerCase()];
  // "0m" parses but is not a duration anyone means.
  return ms > 0 ? ms : null;
}

/** Milliseconds back to the shortest exact form, for showing what was stored. */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  for (const unit of ['d', 'h', 'm', 's']) {
    if (ms % UNIT_MS[unit] === 0) return `${ms / UNIT_MS[unit]}${unit}`;
  }
  return `${Math.round(ms / 1000)}s`;
}

module.exports = { parseDuration, formatDuration, UNIT_MS };
