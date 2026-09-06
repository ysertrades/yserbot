'use strict';

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
    pollMinutes: s.pollMinutes,
    onlyVideos: !!s.onlyVideos,
    maxPerCheck: s.maxPerCheck,
    buttonLabel: s.buttonLabel,
    catalog: (s.catalog || []).map(c => ({
      id: c.id,
      title: c.title,
      tagline: c.tagline,
      lessonsCount: c.lessonsCount,
      cover: c.cover,
      inLog: s.log.some(e => e.id === c.id),
    })),
    log: s.log.map(e => ({
      id: e.id,
      title: e.title,
      cover: e.cover,
      channelId: e.channelId,
      channel: channelName(e.channelId),
      mentionRoleId: e.mentionRoleId,
      mentionRole: roleName(e.mentionRoleId),
      addedAt: e.addedAt,
      knownCount: Object.keys(e.known || {}).length,
      baselined: !!e.baselined,
    })),
    lastScanAt: s.lastScanAt || 0,
    lastError: s.lastError,
  };
}

async function saveSettings(guildId, body, { guild }) {
  const current = whop.getSettings(guildId);
  const patch = {};
  const changed = [];
  let turningOn = false;

  if ('enabled' in body) {
    const on = !!body.enabled;
    if (on !== current.enabled) {
      patch.enabled = on;
      turningOn = on;
      changed.push(on ? 'tracking on' : 'tracking off');
    }
  }

  if ('apiKey' in body) {
    const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (key.length >= 20) {
      patch.apiKey = key;
      changed.push('api key saved');
      try {
        const resolved = await whop.resolveCompany(key);
        if (resolved?.companyId && !body.companyId) {
          patch.companyId = resolved.companyId;
          patch.companyRoute = resolved.companyRoute || current.companyRoute;
          changed.push(`company ${resolved.companyId}`);
        }
      } catch { /* manual company ok */ }
    } else if (key !== '') {
      return { error: 'bad_api_key', detail: 'API key too short.' };
    }
  }

  if ('companyId' in body) {
    const raw = typeof body.companyId === 'string' ? body.companyId.trim() : '';
    if (raw && !raw.startsWith('biz_')) {
      return { error: 'bad_company', detail: 'Company ID must start with biz_' };
    }
    const next = raw || null;
    if (next !== current.companyId) {
      patch.companyId = next;
      changed.push(next ? `company ${next}` : 'company cleared');
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
      changed.push(on ? 'videos only' : 'all types');
    }
  }

  if ('buttonLabel' in body && typeof body.buttonLabel === 'string') {
    const label = body.buttonLabel.trim().slice(0, 80) || 'open course';
    if (label !== current.buttonLabel) {
      patch.buttonLabel = label;
      changed.push('button label');
    }
  }

  if (body.op === 'add' && body.courseId) {
    const ch = channelIn(guild, body.channelId);
    if (!ch.ok || !ch.value) return { error: 'bad_channel', detail: 'Pick a channel before adding.' };
    const role = roleIn(guild, body.mentionRoleId);
    if (!role.ok) return { error: 'bad_role' };
    const r = await whop.addToLog(guildId, String(body.courseId), {
      channelId: ch.value,
      mentionRoleId: role.value,
    });
    if (r.error) return r;
    return { ok: true, changed: r.already ? ['already in log'] : ['added to log (baselined — no flood)'] };
  }

  if (body.op === 'remove' && body.courseId) {
    const r = whop.removeFromLog(guildId, String(body.courseId));
    if (r.unchanged) return { ok: true, unchanged: true };
    return { ok: true, changed: ['removed from log'] };
  }

  if (body.op === 'update' && body.courseId) {
    const patchEntry = {};
    if ('channelId' in body) {
      const ch = channelIn(guild, body.channelId);
      if (!ch.ok) return { error: 'bad_channel' };
      patchEntry.channelId = ch.value;
    }
    if ('mentionRoleId' in body) {
      const role = roleIn(guild, body.mentionRoleId);
      if (!role.ok) return { error: 'bad_role' };
      patchEntry.mentionRoleId = role.value;
    }
    const r = whop.updateLogEntry(guildId, String(body.courseId), patchEntry);
    if (r.error) return r;
    return { ok: true, changed: ['log entry updated'] };
  }

  if (!changed.length) return { ok: true, unchanged: true };
  whop.setSettings(guildId, patch);

  // Turning tracking ON → baseline everything so Save never dumps the library
  if (turningOn) {
    try {
      await whop.baselineAll(guildId);
      changed.push('baselined existing lessons');
    } catch (err) {
      console.warn('[WHOP] baseline on enable:', err.message);
    }
  }

  return { ok: true, changed };
}

async function scan(guildId) {
  try {
    const s = await whop.scanCourses(guildId);
    return { ok: true, courses: s.catalog.length, log: s.log.length, companyId: s.companyId };
  } catch (err) {
    const detail = err.detail || err.message || String(err);
    whop.setSettings(guildId, { lastError: detail });
    return { error: 'scan_failed', detail };
  }
}

module.exports = { read, saveSettings, scan };
