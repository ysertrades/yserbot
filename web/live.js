'use strict';

/**
 * web/live.js
 *
 * Pushing changes to an open panel, so nothing has to be reloaded to be seen.
 *
 * The panel used to be a snapshot: it read the whole overview once when it
 * opened and then showed you that until you refreshed. Someone entering a
 * giveaway, a report arriving, an account starting to fail — none of it
 * appeared until you pulled to refresh, which meant the number on screen was
 * only ever true at the moment you last looked at it.
 *
 * ── Why Server-Sent Events ───────────────────────────────────────────────
 *
 * The traffic here is entirely one-way — the server has news, the page does
 * not — and SSE is the one transport for that which needs no library, no
 * upgrade handshake and no reconnect logic of our own. The browser reconnects
 * by itself, and a dropped connection costs one missed tick rather than a
 * broken page. A WebSocket would have meant a dependency and a keepalive
 * protocol to write, for a channel that never sends anything upstream.
 *
 * ── Why it polls itself rather than being told ───────────────────────────
 *
 * Every write in this bot goes through a different module, and threading a
 * "something changed" call through all of them would be twenty places to
 * forget one. Instead this rebuilds the overview on a timer and pushes it
 * only when it differs from what that guild's watchers were last sent — which
 * is also the only way to notice a change the panel did not cause, and those
 * are precisely the ones worth pushing: a giveaway entry comes from Discord,
 * not from here.
 *
 * The overview is only built for guilds somebody is actually watching, and
 * only while they are. With nobody connected this does nothing at all.
 */

const api = require('./api');

// How often to look. Three seconds is under the threshold where a number
// changing feels like it lagged, and it costs one overview build per watched
// guild — which is reads out of an in-memory cache, not disk.
const TICK_MS = 3_000;

// Proxies and phone networks close a connection that has been silent for a
// minute or two. A comment line keeps it open and costs three bytes.
const HEARTBEAT_MS = 25_000;

// Per guild. High enough for a few devices and tabs, low enough that a page
// stuck in a reconnect loop cannot pile up connections forever.
const MAX_PER_GUILD = 8;

/** guildId → Set<{ res, id }> */
const watchers = new Map();
/** guildId → the JSON last pushed, so an unchanged tick sends nothing. */
const lastSent = new Map();

let timer = null;
let heartbeat = null;
let nextId = 1;

function countFor(guildId) {
  return watchers.get(guildId)?.size ?? 0;
}

/**
 * Attaches a response as a watcher of one guild.
 *
 * The first payload goes out immediately: a page that has just connected
 * should not have to wait a tick to be current, and it is also what tells the
 * client the stream is genuinely working.
 */
function subscribe(guildId, res, req, client) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    // Nginx and friends buffer a streaming response into uselessness without
    // this; it is a no-op everywhere else.
    'x-accel-buffering': 'no',
  });
  // Tell the browser not to hammer us if the connection drops.
  res.write('retry: 5000\n\n');

  const entry = { res, id: nextId++ };
  if (!watchers.has(guildId)) watchers.set(guildId, new Set());
  const set = watchers.get(guildId);
  set.add(entry);

  // Oldest first, so a page that reconnected repeatedly does not evict the
  // one somebody is actually looking at.
  while (set.size > MAX_PER_GUILD) {
    const oldest = set.values().next().value;
    set.delete(oldest);
    try { oldest.res.end(); } catch { /* already gone */ }
  }

  const drop = () => {
    set.delete(entry);
    // Only tear the guild's slot down if this *is* still the guild's slot.
    //
    // A reload closes the old connection and opens a new one, and the close
    // event can land after the new one has registered. This used to compare
    // the size of the closure's own Set and then delete the map entry by key
    // — so a stale, now-empty Set unregistered the live connection that had
    // replaced it and stopped the ticker with it. One payload arrived and
    // then nothing ever again, which is indistinguishable from the feature
    // simply not working.
    if (watchers.get(guildId) === set && set.size === 0) {
      watchers.delete(guildId);
      lastSent.delete(guildId);
    }
    stopIfIdle();
  };
  res.on('close', drop);
  res.on('error', drop);
  req.on('aborted', drop);

  // First payload, straight away.
  api.guildOverview(guildId, client)
    .then(overview => {
      const body = JSON.stringify(overview);
      lastSent.set(guildId, body);
      writeEvent(entry, 'overview', body);
    })
    .catch(err => console.error('[Live] first payload failed:', err.message));

  start(client);
  return entry;
}

function writeEvent(entry, event, data) {
  try {
    // Data has to be one line per SSE's framing, and JSON.stringify never
    // emits a raw newline — but a payload that somehow did would silently
    // truncate the event, so it is split rather than trusted.
    const lines = String(data).split('\n').map(l => `data: ${l}`).join('\n');
    entry.res.write(`event: ${event}\n${lines}\n\n`);
  } catch { /* the socket went away between the check and the write */ }
}

/** Rebuild each watched guild's overview and push the ones that moved. */
async function tick(client) {
  for (const [guildId, set] of watchers) {
    if (set.size === 0) continue;
    let body;
    try {
      body = JSON.stringify(await api.guildOverview(guildId, client));
    } catch (err) {
      // A guild the bot has been removed from, mid-tick. Not worth tearing
      // the stream down for — the next tick will either work or it will not.
      console.error('[Live] could not build the overview:', err.message);
      continue;
    }
    if (body === lastSent.get(guildId)) continue;
    lastSent.set(guildId, body);
    for (const entry of set) writeEvent(entry, 'overview', body);
  }
}

function start(client) {
  if (timer) return;
  timer = setInterval(() => { tick(client).catch(err => console.error('[Live]', err)); }, TICK_MS);
  heartbeat = setInterval(() => {
    for (const set of watchers.values()) {
      for (const entry of set) {
        try { entry.res.write(': ping\n\n'); } catch { /* dropped */ }
      }
    }
  }, HEARTBEAT_MS);
}

/** With nobody watching, the timers come down entirely. */
function stopIfIdle() {
  if (watchers.size > 0) return;
  if (timer) clearInterval(timer);
  if (heartbeat) clearInterval(heartbeat);
  timer = null;
  heartbeat = null;
}

function stop() {
  for (const set of watchers.values()) {
    for (const entry of set) { try { entry.res.end(); } catch { /* gone */ } }
  }
  watchers.clear();
  lastSent.clear();
  stopIfIdle();
}

function stats() {
  return {
    guilds: watchers.size,
    watchers: [...watchers.values()].reduce((n, s) => n + s.size, 0),
    running: !!timer,
  };
}

module.exports = { subscribe, tick, stop, stats, countFor, TICK_MS, MAX_PER_GUILD };
