'use strict';

/**
 * Emergency stub — replace with full writes.js as soon as possible.
 * Exists only so require('./writes') does not crash the bot process.
 */
async function apply(op, guildId, body, ctx) {
  console.error('[writes] STUB in use — restore full web/writes.js');
  return { error: 'writes_stub', detail: 'Panel writes are temporarily disabled. Restore web/writes.js.' };
}
module.exports = { apply, OPS: {} };
