'use strict';

/**
 * whopFeed.js — course tracking log + API.
 * Never posts the library dump: every entry is baselined before watching.
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
  maxPerCheck: 3,
  buttonLabel: 'open course',
  catalog: [],
  log: [],
  lastScanAt: 0,
  lastError: null,
};

function getSettings(guildId) {
  const stored = readJson(FILE, {})[guildId] || {};
  let log = Array.isArray(stored.log) ? stored.log : null;
  if (!log && Array.isArray(stored.courses)) {
    log = stored.courses.filter(c => c.selected).map(c => ({
      id: c.id,
      title: c.title,
      cover: c.cover || null,
      experienceId: c.experienceId || null,
      channelId: stored.channelId || null,
      mentionRoleId: stored.mentionRoleId || null,
      known: {},
      baselined: false,
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
    maxPerCheck: Math.min(10, Math.max(1, Number(stored.maxPerCheck) || 3)),
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

function pickCover(c) {
  // Prefer real course card art (thumbnail), then cover_image string.
  const urls = [
    c?.thumbnail?.optimized_url,
    c?.thumbnail?.source_url,
    typeof c?.cover_image === 'string' ? c.cover_image : null,
    c?.cover,
  ].filter(u => typeof u === 'string' && /^https?:\/\//i.test(u.trim()));
  return urls[0] || null;
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
  return null;
}

async function fetchCompanyRoute(apiKey, companyId) {
  if (!companyId) return null;
  for (const path of [`/accounts/${companyId}`, `/companies/${companyId}`]) {
    try {
      const data = await whopFetch(apiKey, path);
      if (data?.route) return data.route;
    } catch { /* */ }
  }
  return null;
}

async function retrieveCourse(apiKey, courseId) {
  try {
    return await whopFetch(apiKey, `/courses/${courseId}`);
  } catch {
    return null;
  }
}

async function listCourses(apiKey, settings) {
  if (!settings.companyId) {
    throw Object.assign(new Error('missing_company'), {
      detail: 'Set Company ID (biz_…) and Save before scanning.',
    });
  }

  const scopes = [
    { company_id: settings.companyId },
    { account_id: settings.companyId },
  ];

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
            cover: pickCover(c),
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
  if (settings.companyRoute) {
    return `https://whop.com/${encodeURIComponent(settings.companyRoute)}`;
  }
  if (entry?.experienceId) {
    return `https://whop.com/experiences/${entry.experienceId}`;
  }
  if (settings.companyId) {
    // Fallback deep link by company id (Whop accepts biz routes in some clients)
    return `https://whop.com/${encodeURIComponent(settings.companyId)}`;
  }
  return null;
}

/** Mark every current lesson as known — never posts. */
async function baselineEntry(apiKey, entry) {
  const known = { ...(entry.known || {}) };
  try {
    const lessons = await listLessons(apiKey, entry.id);
    for (const l of lessons) known[l.id] = true;
  } catch (err) {
    console.warn(`[WHOP] baseline ${entry.id}:`, err.message);
  }
  return { ...entry, known, baselined: true };
}

async function baselineAll(guildId) {
  const s = getSettings(guildId);
  if (!s.apiKey || !s.log.length) return s;
  const log = [];
  for (const entry of s.log) {
    if (entry.baselined && entry.known && Object.keys(entry.known).length) {
      log.push(entry);
      continue;
    }
    log.push(await baselineEntry(s.apiKey, entry));
  }
  return setSettings(guildId, { log });
}

async function scanCourses(guildId) {
  const s = getSettings(guildId);
  if (!s.apiKey) throw Object.assign(new Error('no_api_key'), { detail: 'API key missing.' });
  if (!s.companyId) throw Object.assign(new Error('missing_company'), { detail: 'Company ID (biz_…) required.' });

  // Resolve public route for buttons if missing
  let companyRoute = s.companyRoute;
  if (!companyRoute) {
    companyRoute = await fetchCompanyRoute(s.apiKey, s.companyId);
  }

  const catalog = await listCourses(s.apiKey, s);
  setSettings(guildId, {
    catalog,
    companyRoute: companyRoute || s.companyRoute,
    lastScanAt: Date.now(),
    lastError: null,
  });
  return getSettings(guildId);
}

async function addToLog(guildId, courseId, { channelId = null, mentionRoleId = null } = {}) {
  const s = getSettings(guildId);
  if (s.log.some(e => e.id === courseId)) return { ok: true, already: true, settings: s };

  const fromCatalog = s.catalog.find(c => c.id === courseId);
  if (!fromCatalog) return { error: 'unknown_course' };

  let cover = fromCatalog.cover || null;
  if (!cover && s.apiKey) {
    const full = await retrieveCourse(s.apiKey, courseId);
    if (full) cover = pickCover(full);
  }

  let entry = {
    id: fromCatalog.id,
    title: fromCatalog.title,
    cover,
    experienceId: fromCatalog.experienceId || null,
    channelId: channelId || null,
    mentionRoleId: mentionRoleId || null,
    known: {},
    baselined: false,
    addedAt: Date.now(),
  };

  // ALWAYS baseline before this entry can post anything
  if (s.apiKey) entry = await baselineEntry(s.apiKey, entry);

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

/**
 * Only returns lessons that appeared AFTER baseline.
 * Unbaselined entries are baselined here and produce zero posts.
 */
async function newLessons(guildId) {
  let s = getSettings(guildId);
  if (!s.apiKey || !s.enabled || !s.log.length) return { posts: [] };

  // Ensure route for buttons
  if (!s.companyRoute && s.companyId) {
    const route = await fetchCompanyRoute(s.apiKey, s.companyId);
    if (route) s = setSettings(guildId, { companyRoute: route });
  }

  const posts = [];
  const nextLog = [];

  for (const entry of s.log) {
    let e = entry;

    // Never post until baselined
    if (!e.baselined) {
      e = await baselineEntry(s.apiKey, e);
      nextLog.push(e);
      continue;
    }

    if (!e.channelId) {
      nextLog.push(e);
      continue;
    }

    // Refresh cover if missing
    if (!e.cover) {
      const full = await retrieveCourse(s.apiKey, e.id);
      if (full) e = { ...e, cover: pickCover(full) };
    }

    let lessons;
    try {
      lessons = await listLessons(s.apiKey, e.id);
    } catch (err) {
      console.warn(`[WHOP] listLessons ${e.id}:`, err.message);
      nextLog.push(e);
      continue;
    }

    const known = { ...(e.known || {}) };
    const fresh = [];

    for (const lesson of lessons) {
      if (known[lesson.id]) continue;
      if (s.onlyVideos && lesson.lessonType !== 'video') {
        known[lesson.id] = true; // remember non-videos so they never flood later
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
        courseId: e.id,
        courseTitle: e.title,
        courseCover: e.cover || null,
        lessonUrl: lessonLink(s, e),
        channelId: e.channelId,
        mentionRoleId: e.mentionRoleId || null,
      });
      known[lesson.id] = true;
    }

    nextLog.push({ ...e, known, baselined: true });
  }

  setSettings(guildId, { log: nextLog });
  return { posts };
}

module.exports = {
  FILE,
  DEFAULTS,
  getSettings,
  setSettings,
  maskKey,
  resolveCompany,
  fetchCompanyRoute,
  listCourses,
  listLessons,
  scanCourses,
  addToLog,
  removeFromLog,
  updateLogEntry,
  baselineAll,
  newLessons,
  lessonLink,
  pickCover,
};
