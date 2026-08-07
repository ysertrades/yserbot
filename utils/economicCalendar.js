'use strict';

// Sources the weekly economic calendar from a free, public mirror of
// ForexFactory's own calendar data — no paid API needed. The mirror is
// rate-limited by its operator (documented guidance: a couple of pulls per
// 5 minutes, refresh weekly not per-tick) so results are cached and only
// re-fetched every few hours; forecasts rarely change mid-week anyway.
const { readJson, writeJson } = require('./jsonStorage');

/**
 * Tried in order, first usable answer wins.
 *
 * The two faireconomy addresses are the source's own, so they lead. The third
 * is an independent mirror of the same file and sits last deliberately: it is
 * only reached when both of the originals are unreachable, which keeps the
 * canonical source canonical and makes the mirror what it should be — a way
 * for the calendar to survive an outage rather than a second opinion nobody
 * asked for.
 */
const FEED_URLS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://media.levlhq.com/cal',
];
const CACHE_FILE          = 'econcal_cache.json';
const REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3h — well inside the mirror's rate limit

const IMPACT_LEVELS = ['High', 'Medium', 'Low', 'Holiday'];
const CURRENCIES    = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY'];

function eventId(raw) {
  return `${raw.date}|${raw.country}|${raw.title}`;
}

function parseEvents(raw) {
  const events = [];
  for (const item of raw) {
    if (!item?.date || !item?.title) continue;
    const date = new Date(item.date);
    if (isNaN(date)) continue;
    events.push({
      id: eventId(item),
      title: String(item.title).trim(),
      currency: String(item.country || '').trim().toUpperCase(),
      date,
      timestamp: date.getTime(),
      impact: item.impact || 'Low',
      forecast: item.forecast || '',
      previous: item.previous || '',
    });
  }
  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

/**
 * The first mirror that answers with a usable week.
 *
 * "Usable" is checked rather than assumed, and that matters more now there is
 * a third address in the list. A mirror that has been repointed, or that hands
 * back an error page with a 200 on it, produces valid JSON that is not a
 * calendar — and the old code would take an empty array as gospel, cache it,
 * and report a week with nothing scheduled in it. A quiet wrong answer during
 * an outage is worse than the outage.
 *
 * So a response only counts if it is a list that parsed into at least one
 * event. Anything else moves to the next address, and if none of them manage
 * it the caller falls back to the last good cache.
 */
async function fetchFromMirror() {
  let lastErr;
  for (const url of FEED_URLS) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)' } });
      if (!res.ok) { lastErr = new Error(`Economic calendar mirror returned ${res.status}`); continue; }

      const raw = await res.json();
      if (!Array.isArray(raw)) {
        lastErr = new Error(`${url} did not answer with a list`);
        continue;
      }

      const events = parseEvents(raw);
      if (events.length === 0) {
        // Every week this feed publishes has releases in it, so nothing at all
        // means the answer is not the calendar rather than that the week is
        // quiet.
        lastErr = new Error(`${url} answered with no events`);
        continue;
      }

      // Named, because "the calendar is stale" and "the calendar has been
      // coming from the backup for a fortnight" are different problems and
      // only one of them is visible without this.
      if (url !== FEED_URLS[0]) console.warn(`[ECONCAL] Served by fallback mirror: ${url}`);
      return events;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Economic calendar mirror unreachable');
}

// Returns this week's events, refreshing from the mirror only when the
// cache is stale. Falls back to a stale cache (instead of throwing) if a
// refresh attempt fails, so a transient network hiccup doesn't wipe out an
// already-scheduled week of reminders.
async function getWeekEvents({ forceRefresh = false } = {}) {
  const cache = readJson(CACHE_FILE, { fetchedAt: 0, events: [] });
  const isStale = forceRefresh || (Date.now() - cache.fetchedAt) > REFRESH_INTERVAL_MS;

  if (!isStale && cache.events.length > 0) {
    return cache.events.map(e => ({ ...e, date: new Date(e.timestamp) }));
  }

  try {
    const events = await fetchFromMirror();
    writeJson(CACHE_FILE, { fetchedAt: Date.now(), events });
    return events;
  } catch (err) {
    if (cache.events.length > 0) {
      console.warn('[ECONCAL] Refresh failed, serving stale cache:', err.message);
      return cache.events.map(e => ({ ...e, date: new Date(e.timestamp) }));
    }
    throw err;
  }
}

function filterEvents(events, { impactFilter = [], currencyFilter = [] } = {}) {
  return events.filter(e => {
    if (impactFilter.length > 0 && !impactFilter.includes(e.impact)) return false;
    if (currencyFilter.length > 0 && !currencyFilter.includes(e.currency)) return false;
    return true;
  });
}

// Narrows to a single calendar day — dayOffset 0 = today, 1 = tomorrow —
// measured in the given UTC-offset timezone (same shift trick used for the
// weekly-post scheduling slot), not the server's own local time.
function filterEventsByDay(events, dayOffset, offsetMinutes = 0) {
  const shiftedNow = Date.now() + offsetMinutes * 60000;
  const d = new Date(shiftedNow);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOffset, 0, 0, 0, 0) - offsetMinutes * 60000;
  const dayEnd = dayStart + 86400000;
  return events.filter(e => e.timestamp >= dayStart && e.timestamp < dayEnd);
}

module.exports = { IMPACT_LEVELS, CURRENCIES, getWeekEvents, filterEvents, filterEventsByDay, parseEvents, eventId };
