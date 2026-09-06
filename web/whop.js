'use strict';

/**
 * web/whop.js
 *
 * Feeds tab \u2014 Whop course tracker.
 * API key once, scan courses, pick which to track, channel + link button.
 */

const whop = require('../utils/whopFeed');

function channelIn(guild, id) {
  if (!id) return { ok: true, value: null };
  if (!/^\d{5,25}$/.test(String(id))) return { ok: false };
  const ch = guild?.channels?.cache?.get(String(id));
  if (!ch || !ch.isTextBased?.()) return { ok: false };
  return { ok: true, value: String(id) };
}

function roleIn(guild, id) {
  if (!id) return { ok: true, value: null };
  if (!/^\d{5,25}$/.test(String(id))) return { ok: false };
  if (!guild?.roles?.cache?.has(String(id))) return { ok: false };
  return { ok: true, value: String(id) };
}

function httpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function read(guildId, guild) {
  const s = whop.getSettings(guildId);
  const channelName = id => (id && guild?.channels?.cache?.get(id)?.name) || null;
  const roleName = id => (id && guild?.roles?.cache?.get(id)?.name) || null;

  return {
    enabled: !!s.enabled,
    hasKey: !!s.apiKey,
    keyMask: whop.maskKey(s.apiKey),
    channelId: s.channelId,
    channel: channelName(s.channelId),
    mentionRoleId: s.mentionRoleId,
    mentionRole: roleName(s.mentionRoleId),
    pollMinutes: s.pollMinutes,
    onlyVideos: !!s.onlyVideos,
    maxPerCheck: s.maxPerCheck,
    buttonLabel: s.buttonLabel,
    buttonUrl: s.buttonUrl,
    buttonEmoji: s.buttonEmoji,
    courses: s.courses.map(c => ({
      id: c.id,
      title: c.title,
      tagline: c.tagline,
      chaptersCount: c.chaptersCount,
      lessonsCount: c.lessonsCount,
      selected: !!c.selected,
      cover: c.cover,
    })),
    lastScanAt: s.lastScanAt || 0,
    lastError: s.lastError,
    selectedCount: s.courses.filter(c => c.selected).length,
  };
}

function saveSettings(guildId, body, { guild }) {
  const current = whop.getSettings(guildId);
  const patch = {};
  const changed = [];

  if ('enabled' in body) {
    const on = !!body.enabled;
    if (on !== current.enabled) {
      patch.enabled = on;
      changed.push(on ? 'switched on' : 'switched off');
    }
  }

  if ('apiKey' in body) {
    const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (key === '') {
      // empty = clear
      if (current.apiKey) {
        patch.apiKey = null;
        changed.push('api key cleared');
      }
    } else if (key.length >= 20) {
      patch.apiKey = key;
      changed.push('api key saved');
    } else {
      return { error: 'bad_api_key' };
    }
  }

  if ('channelId' in body) {
    const ch = channelIn(guild, body.channelId);
    if (!ch.ok) return { error: 'bad_channel' };
    if (ch.value !== current.channelId) {
      patch.channelId = ch.value;
      changed.push(ch.value ? `posts to <#${ch.value}>` : 'channel cleared');
    }
  }

  if ('mentionRoleId' in body) {
    const role = roleIn(guild, body.mentionRoleId);
    if (!role.ok) return { error: 'bad_role' };
    if (role.value !== current.mentionRoleId) {
      patch.mentionRoleId = role.value;
      changed.push(role.value ? `pings <@&${role.value}>` : 'ping cleared');
    }
  }

  if ('pollMinutes' in body) {
    const n = Number(body.pollMinutes);
    if (!Number.isFinite(n) || n < 2 || n > 120) return { error: 'bad_interval' };
    const v = Math.round(n);
    if (v !== current.pollMinutes) {
      patch.pollMinutes = v;
      changed.push(`checks every ${v} min`);
    }
  }

  if ('onlyVideos' in body) {
    const v = !!body.onlyVideos;
    if (v !== current.onlyVideos) {
      patch.onlyVideos = v;
      changed.push(v ? 'videos only' : 'all lesson types');
    }
  }

  if ('maxPerCheck' in body) {
    const n = Number(body.maxPerCheck);
    if (!Number.isFinite(n) || n < 1 || n > 15) return { error: 'bad_batch' };
    const v = Math.round(n);
    if (v !== current.maxPerCheck) {
      patch.maxPerCheck = v;
      changed.push(`at most ${v} per check`);
    }
  }

  if ('buttonLabel' in body) {
    const label = typeof body.buttonLabel === 'string' ? body.buttonLabel.trim().slice(0, 80) : '';
    if (label !== current.buttonLabel) {
      patch.buttonLabel = label || 'open lesson';
      changed.push('button label updated');
    }
  }

  if ('buttonUrl' in body) {
    const raw = typeof body.buttonUrl === 'string' ? body.buttonUrl.trim() : '';
    if (raw && !httpUrl(raw)) return { error: 'bad_button_url' };
    const v = raw || null;
    if (v !== current.buttonUrl) {
      patch.buttonUrl = v;
      changed.push(v ? 'button url set' : 'button url cleared');
    }
  }

  if ('buttonEmoji' in body) {
    const emoji = typeof body.buttonEmoji === 'string' ? body.buttonEmoji.trim().slice(0, 32) : '';
    const v = emoji || null;
    if (v !== current.buttonEmoji) {
      patch.buttonEmoji = v;
      changed.push('button emoji updated');
    }
  }

  // Course selection: array of course ids that should be selected
  if ('selectedCourseIds' in body && Array.isArray(body.selectedCourseIds)) {
    const want = new Set(body.selectedCourseIds.map(String));
    const next = current.courses.map(c => ({
      ...c,
      selected: want.has(c.id),
    }));
    patch.courses = next;
    changed.push(`${want.size} course(s) selected`);
  }

  if (!changed.length) return { ok: true, unchanged: true };
  whop.setSettings(guildId, patch);
  return { ok: true, changed };
}

async function scan(guildId) {
  try {
    const s = await whop.scanCourses(guildId);
    return {
      ok: true,
      courses: s.courses.length,
      selected: s.courses.filter(c => c.selected).length,
      lastScanAt: s.lastScanAt,
    };
  } catch (err) {
    if (err.message === 'no_api_key') return { error: 'no_api_key' };
    return { error: 'scan_failed', detail: (err.message || String(err)).slice(0, 200) };
  }
}

module.exports = { read, saveSettings, scan };
