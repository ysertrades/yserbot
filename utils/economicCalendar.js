'use strict';

// Sources the weekly economic calendar from a free, public mirror of
// ForexFactory's own calendar data — no paid API needed. The mirror is
// rate-limited by its operator (documented guidance: a couple of pulls per
// 5 minutes, refresh weekly not per-tick) so results are cached and only
// re-fetched every few hours; forecasts rarely change mid-week anyway.
const { readJson, writeJson } = require('./jsonStorage');

const FEED_URLS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json',
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

async function fetchFromMirror() {
  let lastErr;
  for (const url of FEED_URLS) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)' } });
      if (!res.ok) { lastErr = new Error(`Economic calendar mirror returned ${res.status}`); continue; }
      const raw = await res.json();
      return parseEvents(raw);
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

module.exports = { IMPACT_LEVELS, CURRENCIES, getWeekEvents, filterEvents, parseEvents, eventId };
