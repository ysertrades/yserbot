'use strict';

/**
 * web/settings.js
 *
 * The rest of config.json — the settings that live at the guild root rather
 * than behind a modConfig helper: welcome and leave channels, the report and
 * log destinations, support and moderator roles, ticket inactivity, and the
 * warning threshold.
 *
 * These are described as a table rather than written out as one function per
 * field. There are a dozen of them, they differ only in type and where they
 * live, and a table means adding the next one is a line rather than a block —
 * and that the validation can't quietly diverge between two of them.
 */

const { readJson, writeJson } = require('../utils/jsonStorage');
const auth = require('./auth');

const WARN_ACTIONS = ['none', 'mute', 'kick', 'ban'];

/**
 * type      — how the value is validated and stored
 * path      — where it lives under config[guildId]
 * label     — what the panel calls it
 */
const FIELDS = [
  { key: 'brandName', path: ['brandName'], type: 'string', label: 'Server brand name (giveaways)', max: 32 },
  { key: 'welcomeChannel', path: ['welcomeChannel'], type: 'channel', label: 'Welcome messages' },
  { key: 'leaveChannel',   path: ['leaveChannel'],   type: 'channel', label: 'Leave messages' },
  { key: 'logsChannel',    path: ['logsChannel'],    type: 'channel', label: 'Moderation log' },
  { key: 'reportChannel',  path: ['reportChannel'],  type: 'channel', label: 'Reports' },
  { key: 'supportRoles',   path: ['supportRoles'],   type: 'roles',   label: 'Support roles' },
  { key: 'reportRoles',    path: ['reportRoles'],    type: 'roles',   label: 'Report handler roles' },
  { key: 'modRoles',       path: ['cmdSetup', 'modRoles'],   type: 'roles', label: 'Moderator roles' },
  { key: 'adminRoles',     path: ['cmdSetup', 'adminRoles'], type: 'roles', label: 'Admin roles' },
  { key: 'warnThreshold',  path: ['warnSettings', 'threshold'],    type: 'int',    label: 'Warnings before action', min: 1, max: 50 },
  { key: 'warnAction',     path: ['warnSettings', 'action'],       type: 'choice', label: 'Action at threshold', choices: WARN_ACTIONS },
  { key: 'warnMuteMs',     path: ['warnSettings', 'muteDuration'], type: 'int',    label: 'Mute length (minutes)', min: 1, max: 40320, scale: 60000 },
  // The two ticket settings that used to sit here are gone, not moved: the
  // Tickets screen already edits the same two stored fields, and this copy
  // described them wrongly in both directions. `inactivityTime` is minutes
  // everywhere in the bot — /ticket labels it "Inactivity Time (minutes)" and
  // multiplies it by 60000 — so a row reading "Close after (hours)" set a
  // value sixty times smaller than whoever typed it meant. And the feature
  // nudges a quiet ticket; it has never closed one.
];

const dig = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);

function put(obj, path, value) {
  let cur = obj;
  for (const k of path.slice(0, -1)) {
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
}

/* ─── reading ────────────────────────────────────────────────────────────── */

function read(guildId, guild, { ownerOnly = false } = {}) {
  const conf = readJson('config.json', {})[guildId] || {};
  const ownerConf = readJson('owner.json', {});
  const values = {};
  const resolved = {};
  const ownerFields = [{ key: 'errorLogChannel', path: ['errorLogChannel'], type: 'channel', label: 'Owner-only bot error logs' }];
  const fields = ownerOnly ? [...FIELDS, ...ownerFields] : FIELDS;

  for (const f of fields) {
    const raw = f.key === 'errorLogChannel' ? ownerConf.errorLogChannel : dig(conf, f.path);
    if (f.type === 'roles') {
      let ids = Array.isArray(raw) ? raw : [];
      // Migrate legacy single-role keys into the multi arrays
      if (!ids.length && f.key === 'supportRoles' && conf.supportRole) ids = [conf.supportRole];
      if (!ids.length && f.key === 'reportRoles' && conf.reportRole) ids = [conf.reportRole];
      values[f.key] = ids;
      resolved[f.key] = values[f.key].map(id => ({ id, name: guild.roles.cache.get(id)?.name || null }));
    } else if (f.type === 'channel') {
      values[f.key] = raw ?? null;
      resolved[f.key] = raw ? (guild.channels.cache.get(raw)?.name || null) : null;
    } else if (f.type === 'role') {
      values[f.key] = raw ?? null;
      resolved[f.key] = raw ? (guild.roles.cache.get(raw)?.name || null) : null;
    } else if (f.type === 'int') {
      values[f.key] = raw == null ? null : (f.scale ? Math.round(raw / f.scale) : raw);
    } else if (f.type === 'bool') {
      values[f.key] = !!raw;
    } else {
      values[f.key] = raw ?? null;
    }
  }

  return {
    fields: fields.map(f => ({
      key: f.key, label: f.label, type: f.type,
      choices: f.choices || null, min: f.min ?? null, max: f.max ?? null,
      scale: f.scale ?? null,
    })),
    values,
    resolved,
    // Only text channels are ever a valid destination, so the picker never
    // offers a voice or category channel it would then reject.
    channels: guild.channels.cache
      .filter(c => c.isTextBased?.() && !c.isVoiceBased?.())
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    roles: guild.roles.cache
      .filter(r => !r.managed && r.id !== guild.id)
      .map(r => ({ id: r.id, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/* ─── writing ────────────────────────────────────────────────────────────── */

function save(guildId, body, { guild, session }) {
  const conf = readJson('config.json', {});
  const ownerConf = readJson('owner.json', {});
  if (!conf[guildId]) conf[guildId] = {};
  const notes = [];

  for (const f of FIELDS) {
    if (!(f.key in body)) continue;
    const incoming = body[f.key];
    const current = dig(conf[guildId], f.path);

    let value;
    switch (f.type) {
      case 'channel': {
        if (incoming === null || incoming === '') { value = null; break; }
        if (typeof incoming !== 'string' || !guild.channels.cache.get(incoming)?.isTextBased?.()) {
          return { error: 'bad_channel', field: f.key };
        }
        value = incoming;
        break;
      }
      case 'role': {
        if (incoming === null || incoming === '') { value = null; break; }
        if (typeof incoming !== 'string' || !guild.roles.cache.has(incoming)) return { error: 'bad_role', field: f.key };
        value = incoming;
        break;
      }
      case 'roles': {
        if (!Array.isArray(incoming)) return { error: 'bad_roles', field: f.key };
        value = [...new Set(incoming.filter(id => typeof id === 'string' && guild.roles.cache.has(id)))].slice(0, 25);
        break;
      }
      case 'int': {
        // Empty / null means "leave this setting alone" so a channel-only
        // save is not blocked by blank warning/mute fields.
        if (incoming === null || incoming === '' || (typeof incoming === 'number' && Number.isNaN(incoming))) {
          continue;
        }
        const n = Number(incoming);
        if (!Number.isInteger(n) || n < (f.min ?? 0) || n > (f.max ?? 1e9)) return { error: 'bad_number', field: f.key };
        value = f.scale ? n * f.scale : n;
        break;
      }
      case 'choice': {
        if (!f.choices.includes(incoming)) return { error: 'bad_choice', field: f.key };
        value = incoming;
        break;
      }
      case 'bool':
        value = !!incoming;
        break;
      case 'string': {
        const str = String(incoming ?? '').trim().slice(0, f.max || 64);
        // Keep null vs "" consistent so brand name edits always save.
        value = str || null;
        break;
      }
      default:
        continue;
    }

    const norm = (v) => {
      if (Array.isArray(v)) return JSON.stringify(v);
      if (v == null || v === '') return null;
      return v;
    };
    const same = norm(value) === norm(current);
    if (same) continue;
    put(conf[guildId], f.path, value);
    notes.push(f.label);
  }

  if ('errorLogChannel' in body) {
    if (!auth.isOwner(session?.uid)) return { error: 'owner_only', field: 'errorLogChannel' };
    const incoming = body.errorLogChannel;
    if (incoming !== null && incoming !== '' &&
        (typeof incoming !== 'string' || !guild.channels.cache.get(incoming)?.isTextBased?.())) {
      return { error: 'bad_channel', field: 'errorLogChannel' };
    }
    const value = incoming === '' ? null : incoming;
    const current = ownerConf.errorLogChannel;
    if (current !== value) {
      ownerConf.errorLogChannel = value;
      writeJson('owner.json', ownerConf);
      notes.push('Owner-only bot error logs');
    }
  }

  if (notes.length === 0) return { unchanged: true };
  writeJson('config.json', conf);
  return { ok: true, changed: notes };
}

module.exports = { read, save, FIELDS };
