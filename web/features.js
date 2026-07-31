'use strict';

/**
 * web/features.js
 *
 * The rest of the bot's adjustable surface: casino limits, the lottery
 * channel, card drops, levelling, verification, scheduled posts, auto-replies
 * and direct coin adjustments.
 *
 * Same shape as web/settings.js and for the same reason — these are a dozen
 * small settings that differ only in where they live and what counts as a
 * valid value, so they're described as data. A per-setting function each would
 * be a dozen chances for the validation to drift apart.
 *
 * The list-shaped things (schedules, auto-replies, level roles) can't be
 * expressed that way, so they get real handlers underneath.
 */

const { readJson, writeJson } = require('../utils/jsonStorage');
const { getBalance, addCoins, setBalance } = require('../utils/economyManager');
const { generateScheduleId, parseScheduleTime, nextWeekdayTimestamp } = require('../utils/scheduler');

// Exactly what utils/scheduler.js implements. It special-cases 'once' and
// 'weekdays' and treats everything else as daily — so offering 'weekly' would
// have produced a schedule that silently fired every day.
const FREQUENCIES = [
  { value: 'once',     label: 'Once' },
  { value: 'everyday', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
];
const FREQUENCY_VALUES = FREQUENCIES.map(f => f.value);

// file → the settings inside it, so one table covers several stores.
const GROUPS = {
  casino: {
    file: 'casino-settings.json',
    label: 'Casino',
    fields: [
      { key: 'minBet', label: 'Minimum bet', type: 'int', min: 1, max: 1e7, fallback: 10 },
      { key: 'maxBet', label: 'Maximum bet', type: 'int', min: 1, max: 1e9, fallback: 500000 },
    ],
  },
  cards: {
    file: 'cards_config.json',
    label: 'Card drops',
    fields: [
      { key: 'channelId', label: 'Drop channel', type: 'channel' },
      { key: 'chance', label: 'Drop chance (%)', type: 'int', min: 1, max: 100, fallback: 5 },
      { key: 'interval', label: 'Messages between drops', type: 'int', min: 1, max: 1000, fallback: 25 },
    ],
  },
};

// These live under config.json[guildId], like web/settings.js.
const CONFIG_GROUPS = {
  lottery: {
    label: 'Lottery',
    fields: [{ key: 'channelId', path: ['lotterySettings', 'channelId'], label: 'Results channel', type: 'channel' }],
  },
  verify: {
    label: 'Verification',
    fields: [
      { key: 'roleId', path: ['verifySettings', 'roleId'], label: 'Role given on verify', type: 'role' },
      { key: 'channelId', path: ['verifySettings', 'channelId'], label: 'Verify channel', type: 'channel' },
      { key: 'rulesText', path: ['verifySettings', 'rulesText'], label: 'Rules text', type: 'text', max: 3000 },
    ],
  },
};

const LEVEL_FIELDS = [
  { key: 'xpMin', label: 'XP per message (min)', type: 'int', min: 1, max: 500, fallback: 10 },
  { key: 'xpMax', label: 'XP per message (max)', type: 'int', min: 1, max: 500, fallback: 20 },
  { key: 'baseXp', label: 'XP for level 1', type: 'int', min: 10, max: 100000, fallback: 150 },
  { key: 'multiplier', label: 'Growth per level (×)', type: 'float', min: 1.01, max: 5, fallback: 1.5 },
];

const dig = (o, p) => p.reduce((x, k) => (x == null ? x : x[k]), o);
function put(o, p, v) {
  let cur = o;
  for (const k of p.slice(0, -1)) { if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}; cur = cur[k]; }
  cur[p[p.length - 1]] = v;
}

/* ─── reading ────────────────────────────────────────────────────────────── */

function read(guildId, guild) {
  const out = { groups: {}, schedules: [], autoreplies: [], levels: null, members: [] };

  for (const [name, group] of Object.entries(GROUPS)) {
    const store = readJson(group.file, {})[guildId] || {};
    out.groups[name] = {
      label: group.label,
      fields: group.fields.map(f => ({ ...f })),
      values: Object.fromEntries(group.fields.map(f => [f.key, store[f.key] ?? f.fallback ?? null])),
    };
  }

  const conf = readJson('config.json', {})[guildId] || {};
  for (const [name, group] of Object.entries(CONFIG_GROUPS)) {
    out.groups[name] = {
      label: group.label,
      fields: group.fields.map(f => ({ ...f })),
      values: Object.fromEntries(group.fields.map(f => [f.key, dig(conf, f.path) ?? null])),
    };
  }

  // Scheduled posts, with the template and channel resolved so the panel can
  // show what they actually refer to rather than a pair of ids.
  const scheduled = readJson('schedules.json', {})[guildId] || {};
  out.schedules = Object.values(scheduled).map(s => ({
    id: s.id,
    embedName: s.embedName,
    channelId: s.channelId,
    channelName: guild.channels.cache.get(s.channelId)?.name || null,
    frequency: s.frequency,
    mention: s.mention ?? null,
    time: s.time ?? null,
    offsetMinutes: s.offsetMinutes ?? 0,
    lastRun: s.lastRun ?? null,
  })).sort((a, b) => (a.embedName || '').localeCompare(b.embedName || ''));

  const replies = readJson('autoreplies.json', {})[guildId] || {};
  out.autoreplies = Object.entries(replies).map(([key, r]) => ({
    key, trigger: r.trigger, embedName: r.embedName,
    exact: !!r.exact, cooldown: r.cooldown ?? 0, enabled: r.enabled !== false,
  })).sort((a, b) => a.trigger.localeCompare(b.trigger));

  const lv = readJson('levels.json', {})[guildId] || {};
  const s = lv.settings || {};
  const xp = Array.isArray(s.xpPerMessage) ? s.xpPerMessage : [10, 20];
  out.levels = {
    fields: LEVEL_FIELDS,
    values: { xpMin: xp[0], xpMax: xp[1], baseXp: s.baseXp ?? 150, multiplier: s.multiplier ?? 1.5 },
    roles: Object.entries(lv.roles || {}).map(([level, roleId]) => ({
      level: Number(level), roleId, roleName: guild.roles.cache.get(roleId)?.name || null,
    })).sort((a, b) => a.level - b.level),
    tracked: Object.keys(lv.users || {}).length,
  };

  // Members the panel can act on. Capped, because a large server would make
  // the overview payload enormous — and a picker nobody can scroll is no
  // better than a box you type an id into.
  out.members = guild.members?.cache
    ? [...guild.members.cache.values()]
        .filter(m => !m.user?.bot)
        .slice(0, 500)
        .map(m => ({ id: m.id, name: m.displayName || m.user?.username || m.id }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  out.frequencies = FREQUENCIES;
  return out;
}

/* ─── validation ─────────────────────────────────────────────────────────── */

function coerce(field, incoming, guild) {
  switch (field.type) {
    case 'channel': {
      if (!incoming) return { value: null };
      const ch = guild.channels.cache.get(incoming);
      if (!ch?.isTextBased?.()) return { error: 'bad_channel' };
      return { value: incoming };
    }
    case 'role': {
      if (!incoming) return { value: null };
      if (!guild.roles.cache.has(incoming)) return { error: 'bad_role' };
      return { value: incoming };
    }
    case 'int': {
      const n = Number(incoming);
      if (!Number.isInteger(n) || n < field.min || n > field.max) return { error: 'bad_number' };
      return { value: n };
    }
    case 'float': {
      const n = Number(incoming);
      if (!Number.isFinite(n) || n < field.min || n > field.max) return { error: 'bad_number' };
      return { value: Math.round(n * 100) / 100 };
    }
    case 'text':
      return { value: typeof incoming === 'string' ? incoming.slice(0, field.max || 2000) : '' };
    default:
      return { error: 'bad_field' };
  }
}

/* ─── writing ────────────────────────────────────────────────────────────── */

function saveGroup(guildId, name, body, guild) {
  const group = GROUPS[name];
  const confGroup = CONFIG_GROUPS[name];
  if (!group && !confGroup) return { error: 'unknown_group' };

  const fields = (group || confGroup).fields;
  const changed = [];

  if (group) {
    const all = readJson(group.file, {});
    if (!all[guildId]) all[guildId] = {};
    for (const f of fields) {
      if (!(f.key in body)) continue;
      const r = coerce(f, body[f.key], guild);
      if (r.error) return { error: r.error, field: f.key };
      if (all[guildId][f.key] === r.value) continue;
      all[guildId][f.key] = r.value;
      changed.push(f.label);
    }
    // Nonsense in either direction produces a casino nobody can play.
    if (name === 'casino' && all[guildId].minBet > all[guildId].maxBet) return { error: 'min_above_max' };
    if (!changed.length) return { unchanged: true };
    writeJson(group.file, all);
    return { ok: true, changed, label: group.label };
  }

  const conf = readJson('config.json', {});
  if (!conf[guildId]) conf[guildId] = {};
  for (const f of fields) {
    if (!(f.key in body)) continue;
    const r = coerce(f, body[f.key], guild);
    if (r.error) return { error: r.error, field: f.key };
    if (dig(conf[guildId], f.path) === r.value) continue;
    put(conf[guildId], f.path, r.value);
    changed.push(f.label);
  }
  if (!changed.length) return { unchanged: true };
  writeJson('config.json', conf);
  return { ok: true, changed, label: confGroup.label };
}

function saveLevels(guildId, body) {
  const all = readJson('levels.json', {});
  if (!all[guildId]) all[guildId] = { users: {}, roles: {}, settings: {} };
  const s = all[guildId].settings || {};
  const values = {};

  for (const f of LEVEL_FIELDS) {
    if (!(f.key in body)) continue;
    const r = coerce(f, body[f.key], null);
    if (r.error) return { error: r.error, field: f.key };
    values[f.key] = r.value;
  }
  if (!Object.keys(values).length) return { unchanged: true };

  const xp = Array.isArray(s.xpPerMessage) ? [...s.xpPerMessage] : [10, 20];
  if ('xpMin' in values) xp[0] = values.xpMin;
  if ('xpMax' in values) xp[1] = values.xpMax;
  if (xp[0] > xp[1]) return { error: 'min_above_max' };

  all[guildId].settings = {
    ...s,
    xpPerMessage: xp,
    baseXp: values.baseXp ?? s.baseXp ?? 150,
    multiplier: values.multiplier ?? s.multiplier ?? 1.5,
  };
  writeJson('levels.json', all);
  return { ok: true, changed: ['Levelling'] };
}

function saveLevelRole(guildId, body, guild) {
  const level = Number(body.level);
  if (!Number.isInteger(level) || level < 1 || level > 999) return { error: 'bad_number' };

  const all = readJson('levels.json', {});
  if (!all[guildId]) all[guildId] = { users: {}, roles: {}, settings: {} };
  if (!all[guildId].roles) all[guildId].roles = {};

  if (body.remove) {
    if (!(level in all[guildId].roles)) return { error: 'unknown_level_role' };
    delete all[guildId].roles[level];
    writeJson('levels.json', all);
    return { ok: true, removed: level };
  }

  if (!guild.roles.cache.has(body.roleId)) return { error: 'bad_role' };
  all[guildId].roles[level] = body.roleId;
  writeJson('levels.json', all);
  return { ok: true, level, roleId: body.roleId };
}

/**
 * A mention is either nothing, one of the two broadcast forms, or a real role
 * in this guild. Returns undefined for anything else so the caller can refuse.
 */
function normaliseMention(value, guild) {
  if (!value) return null;
  if (value === '@everyone' || value === '@here') return value;
  const id = String(value).replace(/^<@&|>$/g, '');
  if (guild.roles.cache.has(id)) return `<@&${id}>`;
  return undefined;
}

/**
 * Turns a typed time plus the browser's UTC offset into an absolute run time.
 *
 * This is why scheduling can live on the web at all: the page knows the
 * viewer's offset, so "09:30" means the same instant it would have meant if
 * you had typed it into /schedule.
 */
function resolveTime(input, offsetMinutes, frequency) {
  const offset = Number(offsetMinutes);
  if (!Number.isFinite(offset) || offset < -720 || offset > 840) return null;
  let t = parseScheduleTime(String(input || '').trim(), offset);
  if (!t) return null;
  if (frequency === 'weekdays') t = nextWeekdayTimestamp(t, offset);
  return t;
}

/** Creates a scheduled post. */
function createSchedule(guildId, body, guild) {
  const templates = readJson('embeds.json', {})[guildId] || {};
  const embedName = String(body.embedName || '').trim();
  if (!templates[embedName]) return { error: 'unknown_template' };

  const channel = guild.channels.cache.get(String(body.channelId || ''));
  if (!channel?.isTextBased?.()) return { error: 'bad_channel' };

  const frequency = FREQUENCY_VALUES.includes(body.frequency) ? body.frequency : null;
  if (!frequency) return { error: 'bad_frequency' };

  const time = resolveTime(body.time, body.offsetMinutes, frequency);
  if (!time) return { error: 'bad_time' };

  const mention = normaliseMention(body.mention, guild);
  if (mention === undefined) return { error: 'bad_mention' };

  const all = readJson('schedules.json', {});
  if (!all[guildId]) all[guildId] = {};
  const id = generateScheduleId(Object.keys(all[guildId]));

  all[guildId][id] = {
    id, embedName, channelId: channel.id, time, frequency, mention,
    offsetMinutes: Number(body.offsetMinutes) || 0,
    createdBy: body.createdBy || null, createdAt: Date.now(), lastRun: null,
  };
  writeJson('schedules.json', all);
  return { ok: true, id, embedName, channelName: channel.name, time };
}

function saveSchedule(guildId, body, guild) {
  const id = String(body.id || '').trim();
  const all = readJson('schedules.json', {});
  const entry = all[guildId]?.[id];
  if (!entry) return { error: 'unknown_schedule' };

  if (body.remove) {
    delete all[guildId][id];
    writeJson('schedules.json', all);
    return { ok: true, removed: id };
  }

  const changed = [];
  if (body.channelId && body.channelId !== entry.channelId) {
    if (!guild.channels.cache.get(body.channelId)?.isTextBased?.()) return { error: 'bad_channel' };
    entry.channelId = body.channelId;
    changed.push('channel');
  }
  if (body.embedName && body.embedName !== entry.embedName) {
    const templates = readJson('embeds.json', {})[guildId] || {};
    if (!templates[body.embedName]) return { error: 'unknown_template' };
    entry.embedName = body.embedName;
    changed.push('message');
  }
  if (body.frequency && body.frequency !== entry.frequency) {
    if (!FREQUENCY_VALUES.includes(body.frequency)) return { error: 'bad_frequency' };
    entry.frequency = body.frequency;
    changed.push('frequency');
  }
  if ('mention' in body) {
    const m = normaliseMention(body.mention, guild);
    if (m === undefined) return { error: 'bad_mention' };
    if (m !== entry.mention) { entry.mention = m; changed.push('mention'); }
  }
  if (body.time) {
    const t = resolveTime(body.time, body.offsetMinutes, entry.frequency);
    if (!t) return { error: 'bad_time' };
    entry.time = t;
    entry.offsetMinutes = Number(body.offsetMinutes) || 0;
    changed.push('time');
  }
  if (!changed.length) return { unchanged: true };
  all[guildId][id] = entry;
  writeJson('schedules.json', all);
  return { ok: true, id, changed };
}

function saveAutoreply(guildId, body) {
  const all = readJson('autoreplies.json', {});
  if (!all[guildId]) all[guildId] = {};
  const key = String(body.key || '').trim().toLowerCase();
  if (!key || key.length > 60) return { error: 'bad_trigger' };

  if (body.remove) {
    if (!all[guildId][key]) return { error: 'unknown_autoreply' };
    delete all[guildId][key];
    writeJson('autoreplies.json', all);
    return { ok: true, removed: key };
  }

  const templates = readJson('embeds.json', {})[guildId] || {};
  const embedName = String(body.embedName || '').trim();
  if (!templates[embedName]) return { error: 'unknown_template' };

  const cooldown = Number(body.cooldown);
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 86400) return { error: 'bad_number' };

  const existing = all[guildId][key];
  all[guildId][key] = {
    trigger: String(body.trigger || key).trim().slice(0, 100),
    embedName, exact: !!body.exact, cooldown,
    enabled: body.enabled !== false,
  };
  writeJson('autoreplies.json', all);
  return { ok: true, key, isNew: !existing };
}

/**
 * Direct coin adjustment.
 *
 * The most dangerous thing the panel can do, so it is the most constrained:
 * a bounded amount, a member who is actually in the guild, and an explicit
 * mode rather than a signed number that could be fat-fingered into a wipe.
 */
function adjustCoins(guildId, body, guild) {
  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) return { error: 'bad_amount' };

  const mode = ['give', 'take', 'set'].includes(body.mode) ? body.mode : null;
  if (!mode) return { error: 'bad_mode' };

  if (body.everyone) {
    if (mode === 'set') return { error: 'no_bulk_set' };
    const members = [...(guild.members?.cache?.values() || [])].filter(m => !m.user?.bot);
    if (!members.length) return { error: 'no_members' };
    for (const m of members) addCoins(m.id, mode === 'give' ? amount : -amount);
    return { ok: true, mode, amount, count: members.length };
  }

  const userId = String(body.userId || '');
  const member = guild.members?.cache?.get(userId);
  if (!member || member.user?.bot) return { error: 'bad_member' };

  const before = getBalance(userId);
  if (mode === 'set') setBalance(userId, amount);
  else addCoins(userId, mode === 'give' ? amount : -amount);

  return { ok: true, mode, amount, userId, name: member.displayName, before, after: getBalance(userId) };
}

module.exports = {
  read, saveGroup, saveLevels, saveLevelRole, createSchedule, saveSchedule, saveAutoreply, adjustCoins,
  GROUPS, CONFIG_GROUPS, LEVEL_FIELDS, FREQUENCIES, FREQUENCY_VALUES,
};
