'use strict';

/**
 * whopFeed.js
 *
 * Tracks selected Whop courses for new video lessons.
 * Requires company_id or experience_id for /courses (Whop API).
 * Company is resolved from GET /accounts/me when the API key is saved.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'whop.json';
const API = 'https://api.whop.com/api/v1';
const UA = 'QuantLabBot/1.0 (+https://quantlab.bot)';

const DEFAULTS = {
  enabled: false,
  apiKey: null,
  companyId: null,       // biz_… required by list courses
  companyRoute: null,    // public route for auto links
  experienceId: null,    // optional exp_… if user scopes to one experience
  channelId: null,
  mentionRoleId: null,
  pollMinutes: 10,
  onlyVideos: true,
  maxPerCheck: 5,
  buttonLabel: 'open course',
  courses: [],
  known: {},
  lastScanAt: 0,
  lastError: null,
};

function getSettings(guildId) {
  const stored = readJson(FILE, {})[guildId] || {};
  return {
    ...DEFAULTS,
    ...stored,
    courses: Array.isArray(stored.courses) ? stored.courses : [],
    known: typeof stored.known === 'object' && stored.known ? stored.known : {},
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
      'Api-Version-Date': '2026-09-04',
      Accept: 'application/json',
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Whop HTTP ${res.status}${body ? ': ' + body.slice(0, 160) : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Resolve company id + public route from the API key. */
async function resolveCompany(apiKey) {
  // Account API keys: /accounts/me returns the company.
  try {
    const me = await whopFetch(apiKey, '/accounts/me');
    if (me?.id) {
      return {
        companyId: me.id,
        companyRoute: me.route || null,
        title: me.title || null,
      };
    }
  } catch (err) {
    console.warn('[WHOP] /accounts/me failed:', err.message);
  }
  // Fallback: list accounts
  try {
    const list = await whopFetch(apiKey, '/accounts', { first: 5 });
    const first = list?.data?.[0];
    if (first?.id) {
      return {
        companyId: first.id,
        companyRoute: first.route || null,
        title: first.title || null,
      };
    }
  } catch (err) {
    console.warn('[WHOP] /accounts failed:', err.message);
  }
  return null;
}

function courseScopeParams(settings) {
  if (settings.experienceId) return { experience_id: settings.experienceId };
  if (settings.companyId) return { company_id: settings.companyId };
  return null;
}

async function listCourses(apiKey, settings) {
  const scope = courseScopeParams(settings);
  if (!scope) throw new Error('missing_company_or_experience');

  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const params = { first: 50, ...scope };
    if (cursor) params.after = cursor;
    const data = await whopFetch(apiKey, '/courses', params);
    const nodes = data?.data || [];
    for (const c of nodes) {
      out.push({
        id: c.id,
        title: c.title || c.id,
        tagline: c.tagline || null,
        chaptersCount: c.chapters_count ?? null,
        lessonsCount: c.total_lessons_count ?? null,
        latestLessonAt: c.latest_lesson_created_at || null,
        cover: c.cover_image || c.thumbnail?.optimized_url || c.thumbnail?.source_url || null,
        experienceId: c.experience?.id || c.experience_id || null,
      });
    }
    if (!data?.page_info?.has_next_page) break;
    cursor = data.page_info.end_cursor;
  }
  return out;
}

async function listLessons(apiKey, courseId) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 30; page++) {
    const params = { course_id: courseId, first: 50 };
    if (cursor) params.after = cursor;
    const data = await whopFetch(apiKey, '/course_lessons', params);
    const nodes = data?.data || [];
    for (const l of nodes) {
      out.push({
        id: l.id,
        title: l.title || 'Untitled lesson',
        lessonType: l.lesson_type || 'text',
        createdAt: l.created_at || null,
        thumbnail: l.thumbnail?.url || null,
        order: l.order ?? 0,
        visibility: l.visibility || 'visible',
      });
    }
    if (!data?.page_info?.has_next_page) break;
    cursor = data.page_info.end_cursor;
  }
  return out;
}

/** Public link for the course / company (used on the Discord button). */
function lessonLink(settings, course) {
  const route = settings.companyRoute;
  if (route) return `https://whop.com/${encodeURIComponent(route)}`;
  if (course?.experienceId) return `https://whop.com/experiences/${course.experienceId}`;
  if (settings.experienceId) return `https://whop.com/experiences/${settings.experienceId}`;
  return null;
}

async function scanCourses(guildId) {
  const s = getSettings(guildId);
  if (!s.apiKey) throw new Error('no_api_key');

  // Ensure company is known
  let companyId = s.companyId;
  let companyRoute = s.companyRoute;
  if (!companyId && !s.experienceId) {
    const resolved = await resolveCompany(s.apiKey);
    if (!resolved?.companyId) throw new Error('could_not_resolve_company');
    companyId = resolved.companyId;
    companyRoute = resolved.companyRoute;
    setSettings(guildId, { companyId, companyRoute });
  }

  const settings = getSettings(guildId);
  const courses = await listCourses(settings.apiKey, settings);
  const existing = new Map(settings.courses.map(c => [c.id, c]));

  const nextCourses = courses.map(c => {
    const prev = existing.get(c.id);
    return {
      id: c.id,
      title: c.title,
      tagline: c.tagline,
      chaptersCount: c.chaptersCount,
      lessonsCount: c.lessonsCount,
      latestLessonAt: c.latestLessonAt,
      cover: c.cover,
      experienceId: c.experienceId,
      selected: prev ? !!prev.selected : false,
    };
  });

  const known = { ...settings.known };
  for (const c of nextCourses.filter(x => x.selected)) {
    try {
      const lessons = await listLessons(settings.apiKey, c.id);
      for (const l of lessons) known[l.id] = true;
    } catch (err) {
      console.warn(`[WHOP] baseline ${c.id}:`, err.message);
    }
  }

  setSettings(guildId, {
    courses: nextCourses,
    known,
    lastScanAt: Date.now(),
    lastError: null,
  });
  return getSettings(guildId);
}

async function newLessons(guildId) {
  const s = getSettings(guildId);
  if (!s.apiKey || !s.enabled) return { fresh: [], known: s.known };

  const selected = s.courses.filter(c => c.selected);
  if (!selected.length) return { fresh: [], known: s.known };

  const fresh = [];
  const known = { ...s.known };

  for (const course of selected) {
    let lessons;
    try {
      lessons = await listLessons(s.apiKey, course.id);
    } catch (err) {
      console.warn(`[WHOP] listLessons ${course.id}:`, err.message);
      continue;
    }

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
      fresh.push({
        ...lesson,
        courseId: course.id,
        courseTitle: course.title,
        courseCover: course.cover || null,
        lessonUrl: lessonLink(s, course),
      });
    }
  }

  fresh.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  return { fresh: fresh.slice(0, s.maxPerCheck), known };
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
  newLessons,
  lessonLink,
};
