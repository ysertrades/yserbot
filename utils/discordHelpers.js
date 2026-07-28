'use strict';

/**
 * Filters bot accounts out of a list of user IDs. Used to keep economy/XP/
 * card leaderboards restricted to real members — a bot account can end up
 * with a balance (e.g. via /give-coins) and shouldn't show up next to human
 * players. Falls back to treating an unresolvable ID as human rather than
 * hiding a real user over a transient fetch failure.
 */
async function filterNonBotIds(client, userIds) {
  const flagged = await Promise.all(userIds.map(async (id) => {
    let user = client.users.cache.get(id);
    if (!user) {
      try { user = await client.users.fetch(id); } catch { return null; }
    }
    return user?.bot ? id : null;
  }));
  const botSet = new Set(flagged.filter(Boolean));
  return userIds.filter(id => !botSet.has(id));
}

module.exports = { filterNonBotIds };
