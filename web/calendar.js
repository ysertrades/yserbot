'use strict';

/**
 * web/calendar.js
 *
 * The week ahead, as the panel needs to see it.
 *
 * /econcal can already post today's, tomorrow's or the week's releases into a
 * channel, but it posts blind: you pick a scope, pick a channel, and find out
 * what you sent by reading it afterwards. The panel has room to do better, so
 * this hands back the same three scopes the command offers *with their
 * contents*, already narrowed by the impact and currency filters that guild
 * has set — the agenda you are about to publish, before you publish it.
 *
 * Everything here reads through utils/economicCalendar, which caches the
 * mirror's data for three hours and falls back to a stale cache rather than
 * throwing. So this is cheap on every call but the first, and it is
 * deliberately not folded into the overview: the overview must never wait on
 * a network fetch, and this is the one read in the panel that might.
 */

const {
  getWeekEvents, filterEvents, filterEventsByDay,
} = require('../utils/economicCalendar');
const { getEconCalSettings } = require('../utils/modConfig');

const SCOPES = ['today', 'tomorrow', 'week'];

/** How many events travel to the browser per scope. */
const MAX_LISTED = 40;

function shape(e) {
  return {
    id: e.id,
    title: e.title,
    currency: e.currency,
    impact: e.impact,
    timestamp: e.timestamp,
    forecast: e.forecast || '',
    previous: e.previous || '',
  };
}

/**
 * The three scopes for one guild, each already filtered the way that guild's
 * own settings filter its reminders — so the count on a scope is the number
 * of events that would actually be posted, not the number the mirror carries.
 *
 * `truncated` is honest about the cap rather than silently showing a short
 * list: the count is the real total, the array may be shorter.
 */
async function agenda(guildId) {
  const settings = getEconCalSettings(guildId);
  // The same offset the weekly post is scheduled in. A "today" that means
  // today where the server's members are is the only one worth having.
  const offsetMinutes = settings.weeklyPost?.offsetMinutes || 0;

  const all = await getWeekEvents();
  const scopes = {};

  for (const scope of SCOPES) {
    const scoped = scope === 'week'
      ? all
      : filterEventsByDay(all, scope === 'today' ? 0 : 1, offsetMinutes);
    const filtered = filterEvents(scoped, {
      impactFilter: settings.impactFilter,
      currencyFilter: settings.currencyFilter,
    });
    scopes[scope] = {
      count: filtered.length,
      truncated: filtered.length > MAX_LISTED,
      events: filtered.slice(0, MAX_LISTED).map(shape),
    };
  }

  return {
    offsetMinutes,
    // What the filters currently are, so the panel can say "narrowed by" out
    // loud instead of leaving a short list looking like a quiet week.
    impact: settings.impactFilter || [],
    currencies: settings.currencyFilter || [],
    channelId: settings.channelId ?? null,
    scopes,
  };
}

/** The events one scope would post, for the write that actually posts them. */
async function eventsFor(guildId, scope) {
  const settings = getEconCalSettings(guildId);
  const offsetMinutes = settings.weeklyPost?.offsetMinutes || 0;
  const all = await getWeekEvents();
  const scoped = scope === 'week'
    ? all
    : filterEventsByDay(all, scope === 'today' ? 0 : 1, offsetMinutes);
  return filterEvents(scoped, {
    impactFilter: settings.impactFilter,
    currencyFilter: settings.currencyFilter,
  });
}

module.exports = { agenda, eventsFor, SCOPES };
