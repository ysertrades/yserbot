'use strict';

/**
 * web/owner.js
 *
 * The bot operator's own console — every guild the bot is in, and who
 * besides that guild's own Discord managers has been let into its panel.
 *
 * A guild's Manage Server permission is that guild's own to grant, through
 * its own roles, and this bot has no say in it. What it does have a say in
 * is a second, narrower list underneath that one: accounts the operator has
 * personally let into a given guild's panel, kept in web/auth.js alongside
 * the rest of the session and access machinery this leans on — this module
 * is the shaping and validation in front of it, not a second copy of it.
 */

const auth = require('./auth');
const api = require('./api');

/** Every guild the bot is in, with who currently holds a staff grant there. */
function listGuilds(client) {
  return [...client.guilds.cache.values()]
    .map(g => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 64 }),
      members: g.memberCount,
      joinedAt: g.joinedTimestamp,
      staff: auth.listStaff(g.id)
        .map(rec => ({
          userId: rec.userId,
          name: g.members.cache.get(rec.userId)?.displayName
            || g.members.cache.get(rec.userId)?.user?.username
            || null,
          addedAt: rec.addedAt,
        }))
        .sort((a, b) => a.addedAt - b.addedAt),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The members one guild's pickers can offer — granting and signing out both
 * need a name to attach the action to, never a typed id. Same cap and shape
 * web/features.js already uses for its own member picker, so the two do not
 * drift into offering a different list for what is the same underlying
 * question ("who is actually in this server").
 */
async function listMembers(guildId, client) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return [];
  await api.ensureMembers(guild);
  return [...guild.members.cache.values()]
    .filter(m => !m.user?.bot)
    .slice(0, 500)
    .map(m => ({ id: m.id, name: m.displayName || m.user?.username || m.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Grants a staff seat, once the account is confirmed to actually be in that
 * guild — the same membership fetch listMembers uses, run again here rather
 * than trusted from whatever the picker last showed, because the picker's
 * list can be a few minutes stale and granting access to an id that turned
 * out to belong to nobody in the guild is not a mistake worth allowing.
 */
async function grantStaff(guildId, userId, addedBy, client) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { error: 'unknown_guild' };
  await api.ensureMembers(guild);
  if (!guild.members.cache.has(userId)) return { error: 'not_a_member' };
  auth.grantStaff(guildId, userId, addedBy);
  return { ok: true };
}

function revokeStaffGrant(guildId, userId) {
  const removed = auth.revokeStaff(guildId, userId);
  return removed ? { ok: true } : { error: 'unknown_grant' };
}

/**
 * Ends every session this account holds, anywhere — not scoped to one
 * guild, because the credential it kills is not scoped to one either: a
 * cookie, a stored bearer token and a Whop embed link are all the same
 * signed session underneath. Works on anyone with a Discord id, not only a
 * staff grant — a native manager who should no longer be trusted is exactly
 * as much this button's business as a revoked staff seat.
 */
function signOut(userId) {
  if (!/^\d{5,25}$/.test(String(userId))) return { error: 'bad_user' };
  auth.revokeSessions(userId);
  return { ok: true };
}

module.exports = { listGuilds, listMembers, grantStaff, revokeStaffGrant, signOut };
