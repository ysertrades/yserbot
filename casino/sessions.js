'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory session store.  One session per userId, auto-expires after 10 min.
// ─────────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10 * 60 * 1000;
const store = new Map();

function _resetTimer(session) {
  clearTimeout(session._timer);
  session._timer = setTimeout(() => store.delete(session.userId), TIMEOUT_MS);
}

function getSession(userId) {
  return store.get(userId) ?? null;
}

function createSession(userId, guildId, messageId) {
  const existing = store.get(userId);
  if (existing) clearTimeout(existing._timer);

  const session = {
    userId,
    guildId,
    messageId,
    game: null,       // 'coinflip' | 'blackjack' | 'trading' | null
    bet: 0,
    locked: false,    // double-click guard
    bjState: null,
    tradeState: null,
    lastResult: null, // { outcome, delta } for the main embed
  };
  _resetTimer(session);
  store.set(userId, session);
  return session;
}

function updateSession(userId, updates) {
  const s = store.get(userId);
  if (!s) return null;
  Object.assign(s, updates);
  _resetTimer(s);
  return s;
}

function clearSession(userId) {
  const s = store.get(userId);
  if (s) clearTimeout(s._timer);
  store.delete(userId);
}

/** Attempt to lock the session.  Returns false if already locked. */
function tryLock(userId) {
  const s = store.get(userId);
  if (!s || s.locked) return false;
  s.locked = true;
  return true;
}

function unlock(userId) {
  const s = store.get(userId);
  if (s) s.locked = false;
}

module.exports = { getSession, createSession, updateSession, clearSession, tryLock, unlock };
