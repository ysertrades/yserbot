'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory session store.  One session per userId, auto-expires after 10 min.
// ─────────────────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10 * 60 * 1000;
// A handler that locks and then throws used to leave locked=true until the
// whole session timed out (10 min). 30s is long enough for any legitimate
// animation (slots/crash) and short enough that a stuck lock recovers itself.
const LOCK_TTL_MS = 30 * 1000;
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
  if (existing) {
    clearTimeout(existing._timer);
    clearTimeout(existing._lockTimer);
  }

  const session = {
    userId,
    guildId,
    messageId,
    game: null,
    bet: 0,
    locked: false,
    lockedAt: 0,
    bjState: null,
    tradeState: null,
    hlState: null,
    monteState: null,
    lastResult: null,
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
  if (s) {
    clearTimeout(s._timer);
    clearTimeout(s._lockTimer);
  }
  store.delete(userId);
}

/** Attempt to lock the session. Returns false if already locked. */
function tryLock(userId) {
  const s = store.get(userId);
  if (!s) return false;
  // Expired lock counts as free — recovers after a thrown handler.
  if (s.locked && s.lockedAt && (Date.now() - s.lockedAt) > LOCK_TTL_MS) {
    s.locked = false;
    clearTimeout(s._lockTimer);
  }
  if (s.locked) return false;
  s.locked = true;
  s.lockedAt = Date.now();
  clearTimeout(s._lockTimer);
  s._lockTimer = setTimeout(() => {
    if (s.locked) s.locked = false;
  }, LOCK_TTL_MS);
  return true;
}

function unlock(userId) {
  const s = store.get(userId);
  if (s) {
    s.locked = false;
    s.lockedAt = 0;
    clearTimeout(s._lockTimer);
  }
}

module.exports = { getSession, createSession, updateSession, clearSession, tryLock, unlock };
