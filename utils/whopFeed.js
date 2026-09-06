'use strict';

/**
 * whopFeed.js
 *
 * Global: apiKey + companyId (saved once).
 * Tracking log: each entry is a course with its own Discord channel.
 * Remove an entry to stop tracking it — no silent toggles.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'whop.json';
const API = 'https://api.whop.com/api/v1';
const UA = 'QuantLabBot/1.0 (+https://quantlab.bot)';

const DEFAULTS = {
  enabled: false,
  apiKey: null,
  companyId: null,
  companyRoute: null,
  pollMinutes: 10,
  onlyVideos: true,
  maxPerCheck: 5,
  buttonLabel: 'open course',
  /** Catalog from last scan (not tracked until added to log). */
  catalog: [],
  /**
   * Tracking log — each item posts to its own channel.
   * { id, title, cover, experienceId, channelId, mentionRoleId, known: { [lessonId]: true }, addedAt }
   */
  log: [],
  lastScanAt: 0,
  lastError: null,
};

function getSettings(guildId) {
  const stored = readJson(FILE, {})[guildId] || {};
  // Migrate old shape (courses[].selected + global channel) once
  let log = Array.isArray(stored.log) ? stored.log : null;
  if (!log && Array.isArray(stored.courses)) {
    log = stored.courses
      .filter(c => c.selected)
      .map(c => ({
        id: c.id,
        title: c.title,
        cover: c.cover || null,
        experienceId: c.experienceId || null,
        channelId: stored.channelId || null,
        mentionRoleId: stored.mentionRoleId || null,
        known: {},
        addedAt: Date.now(),
      }));
  }
  if (!log) log = [];

  return {
    ...DEFAULTS,
    ...stored,
    catalog: Array.isArray(stored.catalog)
      ? stored.catalog
      : (Array.isArray(stored.courses) ? stored.courses : []),
    log,
    pollMinutes: Math.min(120, Math.max(2, Number(stored.pollMinutes) || 10)),
    maxPerCheck: Math.min(15, Math.max(1, Number(stored.maxPerCheck) || 5)),
    buttonLabel: (stored.buttonLabel || DEFAULTS.buttonLabel).slice(0, 80),
  };
}

function setSettings(guildId, patch) {
  const all = readJson(FILE, {});
  all[guildId] = { ...(all[guildId] || {}), ...patch };
  writeJson(FILE, all);
  return getSettings(guildId);
}

function maskKey(key) {
  if (!key || key.length < 12) return null;
  return key.slice(0, 6) + '\u2026' + key.slice(-4);
}

async function whopFetch(apiKey, path, params = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Api-Version-Date': '2026-07-01',
      Accept: 'application/json',
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 160) || res.statusText;
    const err = new Error(`Whop HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function resolveCompany(apiKey) {
  try {
    const me = await whopFetch(apiKey, '/accounts/me');
    if (me?.id && String(me.id).startsWith('biz_')) {
      return { companyId: me.id, companyRoute: me.route || null, title: me.title || null };
    }
  } catch { /* */ }
  try {
    const list = await whopFetch(apiKey, '/accounts', { first: 10 });
    const first = (list?.data || []).find(a => a?.id && String(a.id).startsWith('biz_'));
    if (first) return { companyId: first.id, companyRoute: first.route || null, title: first.title || null };
  } catch { /* */ }
  return null;
}

async function listCourses(apiKey, settings) {
  if (!settings.companyId && !settings.experienceId) {
    throw Object.assign(new Error('missing_company'), {
      detail: 'Set Company ID (biz_…) and Save before scanning.',
    });
  }

  const scopes = [];
  if (settings.companyId) {
    scopes.push({ company_id: settings.companyId });
    scopes.push({ account_id: settings.companyId });
  }

  let lastErr = null;
  for (const scope of scopes) {
    try {
      const out = [];
      let cursor = null;
      for (let page = 0; page < 20; page++) {
        const params = { first: 50, ...scope };
        if (cursor) params.after = cursor;
        const data = await whopFetch(apiKey, '/courses', params);
        for (const c of (data?.data || [])) {
          out.push({
            id: c.id,
            title: c.title || c.id,
            tagline: c.tagline || null,
            chaptersCount: c.chapters_count ?? null,
            lessonsCount: c.total_lessons_count ?? null,
            cover: c.cover_image || c.thumbnail?.optimized_url || null,
            experienceId: c.experience?.id || c.experience_id || null,
          });
        }
        if (!data?.page_info?.has_next_page) break;
        cursor = data.page_info.end_cursor;
      }
      return out;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('list_courses_failed');
}

async function listLessons(apiKey, courseId) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 30; page++) {
    const params = { course_id: courseId, first: 50 };
    if (cursor) params.after = cursor;
    const data = await whopFetch(apiKey, '/course_lessons', params);
    for (const l of (data?.data || [])) {
      out.push({
        id: l.id,
        title: l.title || 'Untitled lesson',
        lessonType: l.lesson_type || 'text',
        createdAt: l.created_at || null,
        visibility: l.visibility || 'visible',
      });
    }
    if (!data?.page_info?.has_next_page) break;
    cursor = data.page_info.end_cursor;
  }
  return out;
}

function lessonLink(settings, entry) {
  if (settings.companyRoute) return `https://whop.com/${encodeURIComponent(settings.companyRoute)}`;
  if (entry?.experienceId) return `https://whop.com/experiences/${entry.experienceId}`;
  return null;
}

async function scanCourses(guildId) {
  const s = getSettings(guildId);
  if (!s.apiKey) throw Object.assign(new Error('no_api_key'), { detail: 'API key missing.' });
  if (!s.companyId) throw Object.assign(new Error('missing_company'), { detail: 'Company ID (biz_…) required.' });

  const catalog = await listCourses(s.apiKey, s);
  setSettings(guildId, {
    catalog,
    lastScanAt: Date.now(),
    lastError: null,
  });
  return getSettings(guildId);
}

/** Add a course from the catalog into the tracking log. */
async function addToLog(guildId, courseId, { channelId = null, mentionRoleId = null } = {}) {
  const s = getSettings(guildId);
  if (s.log.some(e => e.id === courseId)) return { ok: true, already: true, settings: s };

  const fromCatalog = s.catalog.find(c => c.id === courseId);
  if (!fromCatalog) return { error: 'unknown_course' };

  // Baseline known lessons so we don't dump the whole library
  const known = {};
  if (s.apiKey) {
    try {
      const lessons = await listLessons(s.apiKey, courseId);
      for (const l of lessons) known[l.id] = true;
    } catch (err) {
      console.warn('[WHOP] baseline on add:', err.message);
    }
  }

  const entry = {
    id: fromCatalog.id,
    title: fromCatalog.title,
    cover: fromCatalog.cover || null,
    experienceId: fromCatalog.experienceId || null,
    channelId: channelId || null,
    mentionRoleId: mentionRoleId || null,
    known,
    addedAt: Date.now(),
  };

  const log = [...s.log, entry];
  setSettings(guildId, { log, lastError: null });
  return { ok: true, settings: getSettings(guildId) };
}

function removeFromLog(guildId, courseId) {
  const s = getSettings(guildId);
  const log = s.log.filter(e => e.id !== courseId);
  if (log.length === s.log.length) return { ok: true, unchanged: true };
  setSettings(guildId, { log });
  return { ok: true, settings: getSettings(guildId) };
}

function updateLogEntry(guildId, courseId, patch) {
  const s = getSettings(guildId);
  let found = false;
  const log = s.log.map(e => {
    if (e.id !== courseId) return e;
    found = true;
    return {
      ...e,
      channelId: 'channelId' in patch ? patch.channelId : e.channelId,
      mentionRoleId: 'mentionRoleId' in patch ? patch.mentionRoleId : e.mentionRoleId,
    };
  });
  if (!found) return { error: 'not_in_log' };
  setSettings(guildId, { log });
  return { ok: true, settings: getSettings(guildId) };
}

async function newLessons(guildId) {
  const s = getSettings(guildId);
  if (!s.apiKey || !s.enabled || !s.log.length) return { posts: [] };

  const posts = [];

  for (const entry of s.log) {
    if (!entry.channelId) continue;

    let lessons;
    try {
      lessons = await listLessons(s.apiKey, entry.id);
    } catch (err) {
      console.warn(`[WHOP] listLessons ${entry.id}:`, err.message);
      continue;
    }

    const known = { ...(entry.known || {}) };
    const fresh = [];

    for (const lesson of lessons) {
      if (known[lesson.id]) continue;
      if (s.onlyVideos && lesson.lessonType !== 'video') {
        known[lesson.id] = true;
        continue;
      }
      if (lesson.visibility === 'hidden') {
        known[lesson.id] = true;
        continue;
      }
      fresh.push(lesson);
    }

    fresh.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const batch = fresh.slice(0, s.maxPerCheck);

    for (const lesson of batch) {
      posts.push({
        ...lesson,
        courseId: entry.id,
        courseTitle: entry.title,
        courseCover: entry.cover || null,
        lessonUrl: lessonLink(s, entry),
        channelId: entry.channelId,
        mentionRoleId: entry.mentionRoleId || null,
      });
      known[lesson.id] = true;
    }

    // Persist known for this entry
    entry.known = known;
  }

  // Write back updated known maps
  setSettings(guildId, { log: s.log });
  return { posts };
}

module.exports = {
  FILE,
  DEFAULTS,
  getSettings,
  setSettings,
  maskKey,
  resolveCompany,
  listCourses,
  listLessons,
  scanCourses,
  addToLog,
  removeFromLog,
  updateLogEntry,
  newLessons,
  lessonLink,
};
