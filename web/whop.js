'use strict';

/**
 * web/whop.js — Feeds tab handlers for Whop course tracker.
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

function read(guildId, guild) {
  const s = whop.getSettings(guildId);
  const channelName = id => (id && guild?.channels?.cache?.get(id)?.name) || null;
  const roleName = id => (id && guild?.roles?.cache?.get(id)?.name) || null;

  return {
    enabled: !!s.enabled,
    hasKey: !!s.apiKey,
    keyMask: whop.maskKey(s.apiKey),
    companyId: s.companyId,
    companyRoute: s.companyRoute,
    experienceId: s.experienceId,
    channelId: s.channelId,
    channel: channelName(s.channelId),
    mentionRoleId: s.mentionRoleId,
    mentionRole: roleName(s.mentionRoleId),
    pollMinutes: s.pollMinutes,
    onlyVideos: !!s.onlyVideos,
    maxPerCheck: s.maxPerCheck,
    buttonLabel: s.buttonLabel,
    courses: s.courses.map(c => ({
      id: c.id,
      title: c.title,
      tagline: c.tagline,
      chaptersCount: c.chaptersCount,
      lessonsCount: c.lessonsCount,
      selected: !!c.selected,
      cover: c.cover,
      experienceId: c.experienceId || null,
    })),
    lastScanAt: s.lastScanAt || 0,
    lastError: s.lastError,
    selectedCount: s.courses.filter(c => c.selected).length,
  };
}

async function saveSettings(guildId, body, { guild }) {
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
      // ignore empty when a key is already locked — client should not clear by accident
    } else if (key.length >= 20) {
      patch.apiKey = key;
      changed.push('api key saved');
      try {
        const resolved = await whop.resolveCompany(key);
        if (resolved?.companyId) {
          patch.companyId = resolved.companyId;
          patch.companyRoute = resolved.companyRoute || null;
          changed.push(`company ${resolved.companyId}`);
        } else {
          return { error: 'company_resolve_failed', detail: 'Could not resolve company from this API key. Use a Company/Account API key from Whop Developer dashboard.' };
        }
      } catch (err) {
        return { error: 'company_resolve_failed', detail: err.message || String(err) };
      }
    } else {
      return { error: 'bad_api_key', detail: 'API key looks too short.' };
    }
  }

  if ('companyId' in body && typeof body.companyId === 'string' && body.companyId.startsWith('biz_')) {
    if (body.companyId !== current.companyId) {
      patch.companyId = body.companyId.trim();
      changed.push('company set');
    }
  }

  if ('experienceId' in body) {
    const exp = typeof body.experienceId === 'string' ? body.experienceId.trim() : '';
    const next = exp.startsWith('exp_') ? exp : (exp === '' ? null : null);
    if (next !== current.experienceId) {
      patch.experienceId = next;
      changed.push(next ? 'experience scoped' : 'experience cleared');
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
      changed.push(`every ${v}m`);
    }
  }

  if ('onlyVideos' in body) {
    const on = !!body.onlyVideos;
    if (on !== current.onlyVideos) {
      patch.onlyVideos = on;
      changed.push(on ? 'videos only' : 'all lesson types');
    }
  }

  if ('maxPerCheck' in body) {
    const n = Number(body.maxPerCheck);
    if (!Number.isFinite(n) || n < 1 || n > 15) return { error: 'bad_max' };
    const v = Math.round(n);
    if (v !== current.maxPerCheck) {
      patch.maxPerCheck = v;
      changed.push(`cap ${v}`);
    }
  }

  if ('buttonLabel' in body && typeof body.buttonLabel === 'string') {
    const label = body.buttonLabel.trim().slice(0, 80) || 'open course';
    if (label !== current.buttonLabel) {
      patch.buttonLabel = label;
      changed.push('button label');
    }
  }

  if ('selectedCourseIds' in body && Array.isArray(body.selectedCourseIds)) {
    const set = new Set(body.selectedCourseIds.map(String));
    const next = current.courses.map(c => ({ ...c, selected: set.has(c.id) }));
    const before = current.courses.filter(c => c.selected).map(c => c.id).sort().join(',');
    const after = next.filter(c => c.selected).map(c => c.id).sort().join(',');
    if (before !== after) {
      patch.courses = next;
      changed.push(`${next.filter(c => c.selected).length} course(s) selected`);
    }
  }

  if (!changed.length) return { ok: true, unchanged: true };

  whop.setSettings(guildId, patch);
  return { ok: true, changed, overview: null };
}

async function scan(guildId) {
  try {
    const s = await whop.scanCourses(guildId);
    return {
      ok: true,
      courses: s.courses.length,
      selected: s.courses.filter(c => c.selected).length,
      companyId: s.companyId,
    };
  } catch (err) {
    const msg = err.message || String(err);
    whop.setSettings(guildId, { lastError: msg });
    if (msg === 'no_api_key') return { error: 'no_api_key', detail: 'Save your Whop API key first.' };
    if (msg === 'could_not_resolve_company' || msg === 'missing_company_or_experience') {
      return {
        error: 'scan_failed',
        detail: 'Could not resolve company. Save a Company/Account API key again, or set company id (biz_…).',
      };
    }
    return { error: 'scan_failed', detail: msg };
  }
}

module.exports = { read, saveSettings, scan };
