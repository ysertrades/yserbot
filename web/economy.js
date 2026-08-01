'use strict';

/**
 * web/economy.js
 *
 * The economy, from the panel.
 *
 * Everything /work, /daily, /jobs, /fish, /mine, /trivia, /rob and /bank run on
 * was a constant in eight source files until utils/economySettings.js gathered
 * them up. This is the window onto that store: it reads the field descriptions
 * from the same table the bot validates against, so the form can only ever
 * offer values the bot would accept.
 *
 * Durations arrive as `30m` / `2h` / `1d` — the same strings /giveaway and
 * /mute take — rather than as milliseconds, because nobody wants to type
 * 7200000 into a box.
 */

const {
  ACTIVITIES, ACTIVITY_KEYS, GLOBAL_DEFAULTS,
  getSettings, setSettings, boostActive,
} = require('../utils/economySettings');
const { parseDuration, formatDuration } = require('../utils/duration');
const { JOBS } = require('../commands/economy/jobs');

/* ─── reading ────────────────────────────────────────────────────────────── */

/** Everything the Economy screen shows about the activities. */
function read(guildId) {
  const s = getSettings(guildId);

  const activities = ACTIVITY_KEYS.map(key => {
    const meta = ACTIVITIES[key];
    return {
      key,
      label: meta.label,
      emoji: meta.emoji,
      command: meta.command,
      blurb: meta.blurb,
      fields: meta.fields.map(f => ({ ...f })),
      values: Object.fromEntries(meta.fields.map(f => [
        f.key,
        // A duration is shown as the string it will be typed back in as, so
        // what the box holds and what you would write are the same thing.
        f.type === 'duration' ? formatDuration(s[key][f.key]) : s[key][f.key],
      ])),
      defaults: Object.fromEntries(meta.fields.map(f => [
        f.key,
        f.type === 'duration' ? formatDuration(meta.defaults[f.key]) : meta.defaults[f.key],
      ])),
      enabled: s[key].enabled !== false,
    };
  });

  return {
    activities,
    jobs: JOBS.map(j => ({
      id: j.id,
      label: `${j.emoji} ${j.name}`,
      // The scaled band, so the panel shows what a shift actually pays after
      // the pay scale rather than the number in the source.
      pay: `${Math.round(j.min * s.jobs.payScale).toLocaleString()}–${Math.round(j.max * s.jobs.payScale).toLocaleString()}`,
      shift: formatDuration(Math.round(j.cooldownMs * s.jobs.cooldownScale)) || '—',
      open: s.jobs.closed[j.id] !== true,
    })),
    global: {
      multiplier: s.multiplier,
      boost: { ...s.boost },
      active: boostActive(guildId),
      defaults: GLOBAL_DEFAULTS,
    },
  };
}

/* ─── validation ─────────────────────────────────────────────────────────── */

function coerce(field, incoming) {
  switch (field.type) {
    case 'bool':
      if (typeof incoming !== 'boolean') return { error: 'bad_bool' };
      return { value: incoming };
    case 'int': {
      const n = Number(incoming);
      if (!Number.isInteger(n) || n < field.min || n > field.max) return { error: 'bad_number' };
      return { value: n };
    }
    case 'float': {
      const n = Number(incoming);
      if (!Number.isFinite(n) || n < field.min || n > field.max) return { error: 'bad_number' };
      // Two decimals is as fine as a multiplier ever needs to be, and it keeps
      // a stored 1.7000000000000002 out of the file.
      return { value: Math.round(n * 100) / 100 };
    }
    case 'duration': {
      // Zero is a real answer for a cooldown — it means "no cooldown" — and
      // parseDuration deliberately refuses "0m", so it is handled here.
      const raw = String(incoming ?? '').trim();
      if (raw === '' || /^0[smhd]?$/i.test(raw)) {
        return field.min === 0 ? { value: 0 } : { error: 'bad_duration' };
      }
      const ms = parseDuration(raw);
      if (ms === null || ms < field.min || ms > field.max) return { error: 'bad_duration' };
      return { value: ms };
    }
    default:
      return { error: 'bad_field' };
  }
}

/* ─── writing ────────────────────────────────────────────────────────────── */

/** One activity's settings. */
function saveActivity(guildId, body) {
  const key = String(body.activity || '');
  const meta = ACTIVITIES[key];
  if (!meta) return { error: 'unknown_activity' };

  const current = getSettings(guildId)[key];
  const patch = {};
  const changed = [];

  for (const f of meta.fields) {
    if (!(f.key in body)) continue;
    const r = coerce(f, body[f.key]);
    if (r.error) return { error: r.error, field: f.key };
    if (r.value === current[f.key]) continue;
    patch[f.key] = r.value;
    changed.push(f.type === 'duration'
      ? `${f.label.toLowerCase()} ${formatDuration(r.value) || 'off'}`
      : f.type === 'bool'
        ? `${r.value ? 'on' : 'off'}`
        : `${f.label.toLowerCase()} ${r.value}`);
  }

  // Checked against what will be stored rather than what arrived: changing
  // only the minimum still has to leave a band the command can roll inside.
  if (meta.pair) {
    const [lo, hi] = meta.pair;
    const nextLo = patch[lo] ?? current[lo];
    const nextHi = patch[hi] ?? current[hi];
    if (nextLo > nextHi) return { error: 'min_above_max' };
  }

  if (!changed.length) return { unchanged: true };
  setSettings(guildId, { [key]: patch });
  return { ok: true, activity: key, label: meta.label, changed };
}

/** Which jobs are hiring. */
function saveJobs(guildId, body) {
  if (!body.jobs || typeof body.jobs !== 'object') return { error: 'bad_jobs' };

  const current = getSettings(guildId).jobs.closed;
  const closed = { ...current };
  const turned = [];

  for (const job of JOBS) {
    const want = body.jobs[job.id];
    if (typeof want !== 'boolean') continue;
    const isOpen = closed[job.id] !== true;
    if (want === isOpen) continue;
    // Deleted rather than written as false, so the stored map only ever holds
    // the jobs that are actually closed.
    if (want) delete closed[job.id];
    else closed[job.id] = true;
    turned.push(`${job.name} ${want ? 'hiring' : 'closed'}`);
  }

  if (!turned.length) return { unchanged: true };
  // At least one job has to stay open — a hub with nothing in it is a command
  // that does nothing rather than a command that is off, and "off" is what the
  // enabled switch is for.
  if (JOBS.every(j => closed[j.id] === true)) return { error: 'all_jobs_closed' };

  setSettings(guildId, { jobs: { closed } });
  return { ok: true, changed: turned };
}

/** The server-wide multiplier and the boost window. */
function saveGlobal(guildId, body) {
  const current = getSettings(guildId);
  const patch = {};
  const changed = [];

  if ('multiplier' in body) {
    const n = Number(body.multiplier);
    if (!Number.isFinite(n) || n < 0.1 || n > 10) return { error: 'bad_multiplier' };
    const rounded = Math.round(n * 100) / 100;
    if (rounded !== current.multiplier) {
      patch.multiplier = rounded;
      changed.push(`payouts at ${rounded}×`);
    }
  }

  if (body.boost && typeof body.boost === 'object') {
    const next = { ...current.boost };
    const notes = [];

    if (typeof body.boost.enabled === 'boolean' && body.boost.enabled !== next.enabled) {
      next.enabled = body.boost.enabled;
      notes.push(next.enabled ? 'on' : 'off');
    }
    if ('multiplier' in body.boost) {
      const n = Number(body.boost.multiplier);
      if (!Number.isFinite(n) || n < 1 || n > 10) return { error: 'bad_boost' };
      const rounded = Math.round(n * 100) / 100;
      if (rounded !== next.multiplier) { next.multiplier = rounded; notes.push(`${rounded}×`); }
    }
    for (const key of ['startHour', 'endHour']) {
      if (!(key in body.boost)) continue;
      const n = Number(body.boost[key]);
      if (!Number.isInteger(n) || n < 0 || n > 23) return { error: 'bad_boost' };
      if (n !== next[key]) { next[key] = n; notes.push(key === 'startHour' ? `from ${n}:00` : `to ${n}:00`); }
    }
    if ('offsetMinutes' in body.boost) {
      const n = Number(body.boost.offsetMinutes);
      // Real UTC offsets run -12:00 to +14:00.
      if (!Number.isInteger(n) || n < -720 || n > 840) return { error: 'bad_boost' };
      if (n !== next.offsetMinutes) { next.offsetMinutes = n; notes.push('timezone'); }
    }

    // An hour range of nothing is never what was meant, and boostActive reads
    // it as permanently closed — so it is refused rather than silently stored.
    if (next.enabled && next.startHour === next.endHour) return { error: 'empty_window' };

    if (notes.length) {
      patch.boost = next;
      changed.push(`boost hour ${notes.join(' ')}`);
    }
  }

  if (!changed.length) return { unchanged: true };
  setSettings(guildId, patch);
  return { ok: true, changed };
}

module.exports = { read, saveActivity, saveJobs, saveGlobal, coerce };
