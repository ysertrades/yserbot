'use strict';

/**
 * renderCache.js
 *
 * Memoises PNG generators.
 *
 * Every visual in this bot is drawn pixel by pixel in pure JS, synchronously,
 * on the same thread that answers Discord interactions. A single render is
 * 60-210 ms, and for that whole time the bot answers nothing — no buttons, no
 * commands, no gateway heartbeats. That is the stall behind the bot
 * occasionally feeling slow.
 *
 * Most of those renders are avoidable. The seven embed-template images take no
 * arguments at all, so every call produces a byte-identical buffer; the rest
 * are keyed on a handful of values that repeat constantly. Caching turns the
 * repeat cost into a Map lookup.
 *
 * Keyed on the arguments rather than hardcoded to zero-arg generators, so the
 * same wrapper keeps working when a generator grows parameters — which is
 * exactly what the banner previewer will need.
 */

// Bounded so a generator that turns out to be high-cardinality (a per-user
// card, say) degrades into a small LRU instead of leaking memory forever.
const DEFAULT_MAX_ENTRIES = 16;

const registry = [];

/**
 * Wraps a PNG generator so identical arguments reuse the previous buffer.
 *
 * @param {Function} fn      generator returning a Buffer
 * @param {object}   opts
 *   name — label used by warmAll()/stats() reporting
 *   max  — how many distinct argument sets to keep
 * @returns {Function} same signature as `fn`
 */
function memoizeRender(fn, { name = fn.name || 'anonymous', max = DEFAULT_MAX_ENTRIES } = {}) {
  const cache = new Map(); // key → Buffer
  const stat = { name, hits: 0, misses: 0, ms: 0 };
  registry.push(stat);

  const wrapped = function (...args) {
    // Arguments are plain scalars/objects in every current call site. If one
    // is ever passed something unserialisable (a Client, a circular object),
    // fall through to an uncached render rather than throwing.
    let key;
    try {
      key = args.length === 0 ? '' : JSON.stringify(args);
    } catch {
      return fn.apply(this, args);
    }
    if (key === undefined) return fn.apply(this, args);

    const hit = cache.get(key);
    if (hit !== undefined) {
      stat.hits++;
      // Re-insert so the most recently used key is last — Map preserves
      // insertion order, which is what makes the eviction below an LRU.
      cache.delete(key);
      cache.set(key, hit);
      // A defensive copy costs microseconds against a 60-210 ms render, and
      // means a caller that ever writes into the buffer cannot poison the
      // entry for everyone after it.
      return Buffer.from(hit);
    }

    stat.misses++;
    const started = process.hrtime.bigint();
    const out = fn.apply(this, args);
    stat.ms += Number(process.hrtime.bigint() - started) / 1e6;

    if (Buffer.isBuffer(out)) {
      cache.set(key, out);
      if (cache.size > max) cache.delete(cache.keys().next().value); // oldest
      return Buffer.from(out);
    }
    return out; // not a Buffer — leave it alone, don't cache it
  };

  wrapped.clear = () => cache.clear();
  wrapped.cacheSize = () => cache.size;

  // Answers "would this call block?" without making it. Callers that pace
  // renders need to know before they commit, not after — checking afterwards
  // would mean the thread was already blocked and the limit achieved nothing.
  wrapped.peek = (...args) => {
    let key;
    try { key = args.length === 0 ? '' : JSON.stringify(args); } catch { return undefined; }
    const hit = cache.get(key);
    if (hit === undefined) return undefined;
    cache.delete(key); cache.set(key, hit); // keep LRU ordering honest
    return Buffer.from(hit);
  };

  return wrapped;
}

/** Render totals, for the /botstats style reporting the panel will want. */
function stats() {
  return registry.map(s => ({ ...s, ms: Math.round(s.ms) }));
}

module.exports = { memoizeRender, stats };
