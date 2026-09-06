'use strict';

/**
 * whopFeed.js — Whop course tracker storage + API.
 * List courses needs company_id OR experience_id.
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
  experienceId: null,
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
      'Api-Version-Date': '2026-07-01',
      Accept: 'application/json',
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 160) || res.statusText;
    const err = new Error(`Whop HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function resolveCompany(apiKey) {
  const attempts = [];

  // 1) Official: GET /accounts/me
  try {
    const me = await whopFetch(apiKey, '/accounts/me');
    if (me?.id && String(me.id).startsWith('biz_')) {
      return { companyId: me.id, companyRoute: me.route || null, title: me.title || null };
    }
    attempts.push('/accounts/me: no biz_ id in response');
  } catch (err) {
    attempts.push(`/accounts/me: ${err.message}`);
  }

  // 2) List accounts
  try {
    const list = await whopFetch(apiKey, '/accounts', { first: 10 });
    const first = (list?.data || []).find(a => a?.id && String(a.id).startsWith('biz_'));
    if (first) {
      return { companyId: first.id, companyRoute: first.route || null, title: first.title || null };
    }
    attempts.push('/accounts: no biz_ in list');
  } catch (err) {
    attempts.push(`/accounts: ${err.message}`);
  }

  const err = new Error('could_not_resolve_company');
  err.detail = attempts.join(' | ');
  throw err;
}

async function listCourses(apiKey, settings) {
  const companyId = settings.companyId;
  const experienceId = settings.experienceId;

  if (!companyId && !experienceId) {
    throw new Error('missing_company_or_experience');
  }

  // Whop has used both company_id and account_id in docs — try company first.
  const scopeAttempts = [];
  if (experienceId) scopeAttempts.push({ experience_id: experienceId });
  if (companyId) {
    scopeAttempts.push({ company_id: companyId });
    scopeAttempts.push({ account_id: companyId });
  }

  let lastErr = null;
  for (const scope of scopeAttempts) {
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
            latestLessonAt: c.latest_lesson_created_at || null,
            cover: c.cover_image || c.thumbnail?.optimized_url || c.thumbnail?.source_url || null,
            experienceId: c.experience?.id || c.experience_id || null,
          });
        }
        if (!data?.page_info?.has_next_page) break;
        cursor = data.page_info.end_cursor;
      }
      return out;
    } catch (err) {
      lastErr = err;
      // try next scope style
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

function lessonLink(settings, course) {
  if (settings.companyRoute) return `https://whop.com/${encodeURIComponent(settings.companyRoute)}`;
  if (course?.experienceId) return `https://whop.com/experiences/${course.experienceId}`;
  if (settings.experienceId) return `https://whop.com/experiences/${settings.experienceId}`;
  return null;
}

async function scanCourses(guildId) {
  let s = getSettings(guildId);
  if (!s.apiKey) throw Object.assign(new Error('no_api_key'), { detail: 'Save your API key first.' });

  // Resolve company if missing
  if (!s.companyId && !s.experienceId) {
    try {
      const resolved = await resolveCompany(s.apiKey);
      setSettings(guildId, {
        companyId: resolved.companyId,
        companyRoute: resolved.companyRoute || null,
      });
      s = getSettings(guildId);
    } catch (err) {
      const detail = err.detail || err.message || String(err);
      throw Object.assign(new Error('could_not_resolve_company'), {
        detail: `${detail}. Paste your Company ID (biz_…) in the panel and Save, then Scan again.`,
      });
    }
  }

  s = getSettings(guildId);
  const courses = await listCourses(s.apiKey, s);
  const existing = new Map(s.courses.map(c => [c.id, c]));

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

  const known = { ...s.known };
  for (const c of nextCourses.filter(x => x.selected)) {
    try {
      const lessons = await listLessons(s.apiKey, c.id);
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
