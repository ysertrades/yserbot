'use strict';

/**
 * whopFeed.js
 *
 * Watches selected Whop courses for new video lessons and posts them to Discord.
 * QuantLab brand book: calm voice, Phantom palette, API key stored once.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'whop.json';
const API = 'https://api.whop.com/api/v1';
const UA = 'QuantLabBot/1.0 (+https://quantlab.bot)';

const DEFAULTS = {
  enabled: false,
  apiKey: null,
  channelId: null,
  mentionRoleId: null,
  pollMinutes: 10,
  onlyVideos: true,
  maxPerCheck: 5,
  buttonLabel: 'open lesson',
  buttonUrl: null,
  buttonEmoji: null,
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
    buttonUrl: stored.buttonUrl ? String(stored.buttonUrl).slice(0, 400) : null,
    buttonEmoji: stored.buttonEmoji ? String(stored.buttonEmoji).slice(0, 32) : null,
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
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Whop HTTP ${res.status}${body ? ': ' + body.slice(0, 120) : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function listCourses(apiKey) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const params = { first: 50 };
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
        cover: c.thumbnail?.optimized_url || c.cover_image || null,
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

async function scanCourses(guildId) {
  const s = getSettings(guildId);
  if (!s.apiKey) throw new Error('no_api_key');

  const courses = await listCourses(s.apiKey);
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
  listCourses,
  listLessons,
  scanCourses,
  newLessons,
};
