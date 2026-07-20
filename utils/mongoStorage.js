'use strict';

/**
 * mongoStorage.js
 *
 * Drop-in persistent backend for jsonStorage.js.
 *
 * - `connect(uri)` must be awaited once at startup (bot/index.js).
 * - After connect, `readJson` / `writeJson` are fully synchronous — they
 *   operate on an in-memory cache that is warm before any command fires.
 * - Every write attempt is assigned a monotonically increasing sequence
 *   number. Failed writes are placed into a retry queue and retried every
 *   RETRY_INTERVAL_MS. The sequence number ensures:
 *     a) A stale flush never removes a newer queued entry (race #1).
 *     b) A later successful write always evicts older queued entries so a
 *        delayed retry can never overwrite fresher data (race #2).
 * - If MONGODB_URI is missing or the connection fails, the module silently
 *   falls back to the original local-file behaviour so the bot still works.
 */

const fs   = require('node:fs');
const path = require('node:path');

const dataDir = path.join(__dirname, '..', 'data');

// fileName → parsed data (populated at connect time)
const cache = new Map();

// null = file-mode fallback, set to the real collection after connect()
let col = null;

// ── Write-ahead retry queue ───────────────────────────────────────────────
//
// retryQueue : fileName → { data, seq }
//   Holds the most-recent failed write for each file.
//
// lastWriteSeq : fileName → seq
//   The sequence number of the most-recent write *attempt* (success or fail)
//   for each file. Used to detect stale queue entries.
//
// Correctness invariants
//  I1. A queued entry is only applied if its seq === lastWriteSeq[fileName].
//      (Prevents a stale retry from overwriting a newer successful write.)
//  I2. On a successful write, any queued entry with seq ≤ successful seq is
//      evicted. (Prevents a pending flush from rolling back fresh data.)
//  I3. flushRetryQueue is serialised via flushInProgress so two concurrent
//      flushes cannot both snapshot and both delete the same entry.

const retryQueue   = new Map(); // fileName → { data, seq }
const lastWriteSeq = new Map(); // fileName → seq
let   seqCounter   = 0;

const RETRY_INTERVAL_MS = 30_000; // retry every 30 s
let retryTimer     = null;
let flushInProgress = false;

// ── Persistent queue file ─────────────────────────────────────────────────

const QUEUE_FILE = path.join(dataDir, '_retry_queue.json');

/**
 * Write the current retryQueue to disk so a crash or restart doesn't drop
 * pending writes.  Overwrites the file atomically-ish via a temp file.
 * Safe to call synchronously from a signal handler.
 */
function persistQueue() {
  try {
    ensureDataDir();
    if (retryQueue.size === 0) {
      // Nothing pending — remove stale file if present.
      if (fs.existsSync(QUEUE_FILE)) fs.unlinkSync(QUEUE_FILE);
      return;
    }
    const payload = {};
    for (const [fileName, entry] of retryQueue) {
      payload[fileName] = entry;
    }
    const tmp = QUEUE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, QUEUE_FILE);
    console.log(`[Storage] 💾 Persisted ${retryQueue.size} queued write(s) to disk.`);
  } catch (err) {
    console.error('[Storage] ⚠️  Could not persist retry queue to disk:', err.message);
  }
}

/**
 * Load a previously persisted queue from disk into memory.
 * Called once at startup, before the MongoDB connection is established, so
 * that queued entries are available immediately once the connection is ready.
 */
function loadPersistedQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    let count = 0;
    for (const [fileName, entry] of Object.entries(raw)) {
      if (!entry || typeof entry.seq !== 'number') continue;
      // Only restore if no in-memory write has already superseded this entry.
      const currentSeq = lastWriteSeq.get(fileName);
      if (currentSeq === undefined || entry.seq > currentSeq) {
        retryQueue.set(fileName, entry);
        lastWriteSeq.set(fileName, entry.seq);
        // Keep seqCounter ahead of any restored sequence number so new writes
        // always receive a strictly higher seq.
        if (entry.seq >= seqCounter) seqCounter = entry.seq + 1;
        count += 1;
      }
    }
    if (count > 0) {
      console.log(`[Storage] 📂 Loaded ${count} persisted queued write(s) from disk.`);
    }
  } catch (err) {
    console.error('[Storage] ⚠️  Could not read persisted retry queue:', err.message);
  }
}

/**
 * Flush every pending retry entry to MongoDB.
 * Serialised: concurrent callers return immediately if a flush is running.
 */
async function flushRetryQueue() {
  if (!col || retryQueue.size === 0 || flushInProgress) return;
  flushInProgress = true;

  try {
    // Snapshot current queue at the moment the flush begins.
    const snapshot = [...retryQueue.entries()].map(([fileName, entry]) => ({
      fileName,
      data: entry.data,
      seq:  entry.seq,
    }));

    await Promise.allSettled(
      snapshot.map(({ fileName, data, seq }) => {
        // I1: skip if a newer write has already been attempted for this file.
        if (lastWriteSeq.get(fileName) !== seq) {
          retryQueue.delete(fileName);
          return Promise.resolve();
        }

        return col.updateOne({ _id: fileName }, { $set: { data } }, { upsert: true })
          .then(() => {
            // Remove only if no newer write arrived while the network call
            // was in flight (guards against race #1).
            const current = retryQueue.get(fileName);
            if (current && current.seq === seq) {
              retryQueue.delete(fileName);
              console.log(`[Storage] ✅ Retry succeeded — flushed queued write for ${fileName}`);
            }
          })
          .catch(err => {
            console.warn(`[Storage] ⚠️  Retry still failing for ${fileName}: ${err.message}`);
          });
      }),
    );

    if (retryQueue.size === 0) {
      // All entries were drained — remove the persisted file so it doesn't
      // get re-loaded on the next startup.
      try {
        if (fs.existsSync(QUEUE_FILE)) fs.unlinkSync(QUEUE_FILE);
      } catch { /* non-fatal */ }
      console.log('[Storage] ✅ Retry queue fully drained.');
    } else {
      // Some entries are still pending — keep the file up to date.
      persistQueue();
    }
  } finally {
    flushInProgress = false;
  }
}

function startRetryTimer() {
  if (retryTimer) return; // already running
  retryTimer = setInterval(() => {
    if (retryQueue.size > 0) {
      console.log(`[Storage] ⏳ Retrying ${retryQueue.size} queued write(s)…`);
      flushRetryQueue().catch(() => {});
    }
  }, RETRY_INTERVAL_MS);
  if (retryTimer.unref) retryTimer.unref(); // don't keep process alive
}

/**
 * Enqueue a failed write.  Only queues if `seq` is still the latest write
 * attempt for this file — if a newer attempt already succeeded or failed with
 * a higher seq, this entry is already obsolete and is silently dropped.
 */
function enqueueRetry(fileName, data, seq) {
  // Drop if a newer write has already superseded this attempt.
  if (lastWriteSeq.get(fileName) !== seq) return;

  const alreadyQueued = retryQueue.has(fileName);
  retryQueue.set(fileName, { data, seq });

  if (!alreadyQueued) {
    console.warn(`[Storage] ⚠️  Write failed for ${fileName} — queued for retry (queue size: ${retryQueue.size})`);
  } else {
    console.warn(`[Storage] ⚠️  Write still failing for ${fileName} — updated queued value (queue size: ${retryQueue.size})`);
  }

  // Persist immediately so a hard crash between now and the next retry cycle
  // or graceful shutdown cannot drop this queued write.
  persistQueue();

  startRetryTimer();
}

// ── File-system fallback helpers ──────────────────────────────────────────

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function readFile(fileName, defaultValue) {
  ensureDataDir();
  const fp = path.join(dataDir, fileName);
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
  try   { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return defaultValue; }
}

function writeFile(fileName, data) {
  ensureDataDir();
  fs.writeFileSync(path.join(dataDir, fileName), JSON.stringify(data, null, 2));
}

// ── MongoDB connect + seed ────────────────────────────────────────────────

async function connect(uri) {
  // Restore any writes that were queued before a previous crash/restart.
  loadPersistedQueue();

  if (!uri) {
    console.warn('[Storage] MONGODB_URI not set — using local JSON files (data will not persist across deploys).');
    return;
  }

  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10_000,
    });
    await client.connect();

    const db = client.db('yser_bot');
    col = db.collection('bot_storage');

    // ── Drain any writes that were queued before we connected ────────────
    if (retryQueue.size > 0) {
      console.log(`[Storage] 🔄 Connection established — draining ${retryQueue.size} queued write(s) before serving new writes…`);
      await flushRetryQueue();
    }

    // ── Load all existing docs into cache ────────────────────────────────
    const docs = await col.find({}).toArray();
    for (const doc of docs) {
      cache.set(doc._id, doc.data);
    }

    // ── Seed from local JSON files (one-time migration) ──────────────────
    ensureDataDir();
    const existingKeys = new Set(docs.map(d => d._id));
    const localFiles   = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && f !== '_retry_queue.json');

    const seedOps = [];
    for (const file of localFiles) {
      if (existingKeys.has(file)) continue; // already in DB
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
        cache.set(file, data);
        seedOps.push(
          col.updateOne({ _id: file }, { $set: { data } }, { upsert: true }),
        );
        console.log(`[Storage] Seeded  → ${file}`);
      } catch { /* malformed file — skip */ }
    }
    if (seedOps.length) await Promise.all(seedOps);

    console.log(`[Storage] ✅ MongoDB connected — ${cache.size} document(s) loaded.`);

    // Graceful shutdown — persist any queued writes before exiting so they
    // survive a crash or deploy restart and are replayed on the next boot.
    const shutdown = async (signal) => {
      console.log(`[Storage] 🛑 ${signal} received — persisting retry queue before exit…`);
      persistQueue();
      await client.close();
      process.exit(0);
    };
    process.on('SIGINT',  () => shutdown('SIGINT').catch(() => process.exit(1)));
    process.on('SIGTERM', () => shutdown('SIGTERM').catch(() => process.exit(1)));
  } catch (err) {
    const hint = err.message.includes('SSL') || err.message.includes('ssl') || err.message.includes('tls')
      ? '\n[Storage]    ↳ TLS/SSL error: in MongoDB Atlas, go to Network Access and add 0.0.0.0/0 to allow connections from Replit.'
      : '';
    console.error('[Storage] ⚠️  MongoDB connection failed — falling back to local JSON files.');
    console.error('[Storage]    Reason:', err.message + hint);
    col = null;
  }
}

// ── Public sync API ───────────────────────────────────────────────────────

function readJson(fileName, defaultValue = {}) {
  if (!col) return readFile(fileName, defaultValue);

  if (cache.has(fileName)) return cache.get(fileName);

  // Key not in DB yet — initialise with default and persist.
  cache.set(fileName, defaultValue);

  seqCounter += 1;
  const seq = seqCounter;
  lastWriteSeq.set(fileName, seq);

  col.updateOne({ _id: fileName }, { $set: { data: defaultValue } }, { upsert: true })
    .then(() => {
      // I2: successful write — evict any stale queued entry.
      const queued = retryQueue.get(fileName);
      if (queued && queued.seq <= seq) {
        retryQueue.delete(fileName);
        // Mirror the deletion to disk so a restart can't replay stale data.
        persistQueue();
      }
    })
    .catch(err => {
      console.warn(`[Storage] ⚠️  Init write failed for ${fileName} — queuing for retry: ${err.message}`);
      enqueueRetry(fileName, defaultValue, seq);
    });

  return defaultValue;
}

function writeJson(fileName, data) {
  if (!col) { writeFile(fileName, data); return; }

  cache.set(fileName, data);

  seqCounter += 1;
  const seq = seqCounter;
  lastWriteSeq.set(fileName, seq);

  col.updateOne({ _id: fileName }, { $set: { data } }, { upsert: true })
    .then(() => {
      // I2: successful write — evict any stale queued entry.
      const queued = retryQueue.get(fileName);
      if (queued && queued.seq <= seq) {
        retryQueue.delete(fileName);
        // Mirror the deletion to disk so a restart can't replay stale data.
        persistQueue();
      }
    })
    .catch(err => {
      console.warn(`[Storage]    ↳ Write error detail for ${fileName}: ${err.message}`);
      enqueueRetry(fileName, data, seq);
    });
}

module.exports = { connect, readJson, writeJson };
