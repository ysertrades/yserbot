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
  companyTitle: null,   // public name of the Whop / course workspace
  pollMinutes: 10,
  onlyVideos: true,
  maxPerCheck: 3,
  buttonLabel: 'Open course',
  catalog: [],          // courses (each carries experienceId + experienceName)
  apps: [],             // course apps (experiences that host courses)
  log: [],              // tracked courses and/or whole apps
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
    apps: Array.isArray(stored.apps) ? stored.apps : [],
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
  // Prefer the largest / cleanest course art so Discord can show a real
  // full-width banner. Order: high-res source → optimized → explicit cover
  // fields → nested image objects the API sometimes nests under `images`.
  const candidates = [
    c?.thumbnail?.source_url,
    c?.thumbnail?.url,
    c?.thumbnail?.optimized_url,
    typeof c?.cover_image === 'string' ? c.cover_image : null,
    c?.cover_image?.source_url,
    c?.cover_image?.url,
    c?.cover_image?.optimized_url,
    typeof c?.cover === 'string' ? c.cover : null,
    c?.cover?.source_url,
    c?.cover?.url,
    c?.image?.source_url,
    c?.image?.url,
    c?.image?.optimized_url,
    typeof c?.image === 'string' ? c.image : null,
    ...(Array.isArray(c?.images) ? c.images.flatMap(img => [
      typeof img === 'string' ? img : null,
      img?.source_url,
      img?.url,
      img?.optimized_url,
    ]) : []),
  ];
  const urls = candidates
    .filter(u => typeof u === 'string' && /^https:\/\//i.test(u.trim()))
    .map(u => u.trim());
  // Prefer non-tiny CDN variants when the same asset is listed multiple ways.
  const ranked = urls.sort((a, b) => {
    const score = u => (/w=\d{3,}|width=\d{3,}|original|source|large|full/i.test(u) ? 2 : 0)
      + (/optimized|thumb|small|64|128|256/i.test(u) ? -1 : 0)
      + Math.min(u.length, 200) / 200;
    return score(b) - score(a);
  });
  return ranked[0] || null;
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
          const vis = String(c.visibility || c.status || 'visible').toLowerCase();
          // Drop archived / deleted / hidden courses so Scan matches the live library
          if (['hidden', 'deleted', 'archived', 'inactive', 'removed'].includes(vis)) continue;
          const exp = c.experience || {};
          out.push({
            id: c.id,
            title: c.title || c.id,
            tagline: c.tagline || null,
            chaptersCount: c.chapters_count ?? null,
            lessonsCount: c.total_lessons_count ?? null,
            cover: pickCover(c),
            experienceId: exp.id || c.experience_id || null,
            experienceName: exp.name || exp.title || exp.app_name || exp.app?.name || null,
            visibility: vis,
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


/** Course apps = experiences under the company that host courses. */
async function listExperiences(apiKey, settings) {
  if (!settings.companyId) return [];
  const scopes = [
    { company_id: settings.companyId },
    { account_id: settings.companyId },
  ];
  let lastErr = null;
  for (const scope of scopes) {
    try {
      const out = [];
      let cursor = null;
      for (let page = 0; page < 15; page++) {
        const params = { first: 50, ...scope };
        if (cursor) params.after = cursor;
        const data = await whopFetch(apiKey, '/experiences', params);
        for (const x of (data?.data || [])) {
          const id = x.id;
          if (!id) continue;
          out.push({
            id,
            name: x.name || x.title || x.app?.name || id,
            description: x.description || null,
            appName: x.app?.name || x.app_name || null,
            image: pickCover(x) || (typeof x.image_url === 'string' ? x.image_url : null),
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
  if (lastErr) console.warn('[WHOP] listExperiences:', lastErr.message);
  return [];
}

async function retrieveExperience(apiKey, experienceId) {
  if (!experienceId) return null;
  try {
    return await whopFetch(apiKey, `/experiences/${experienceId}`);
  } catch {
    return null;
  }
}

async function listLessons(apiKey, courseId) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 30; page++) {
    const params = { course_id: courseId, first: 50 };
    if (cursor) params.after = cursor;
    const data = await whopFetch(apiKey, '/course_lessons', params);
    for (const l of (data?.data || [])) {
      const video = l.video_asset || l.mux_asset || l.muxAsset || null;
      const pdf = l.main_pdf || l.pdf || null;
      const videoReady = !!(
        (video && (video.signed_playback_id || video.playback_id || video.signedPlaybackId
          || video.status === 'ready' || video.finished_uploading_at || video.duration_seconds > 0))
        || l.embed_id
      );
      const pdfReady = !!(pdf && (pdf.source_url || pdf.url || pdf.id || pdf.filename));
      const contentLen = String(l.content || '').trim().length;
      out.push({
        id: l.id,
        title: (l.title || '').trim() || 'Untitled lesson',
        lessonType: l.lesson_type || 'text',
        createdAt: l.created_at || null,
        visibility: l.visibility || 'visible',
        videoReady,
        pdfReady,
        hasContent: contentLen >= 40,
        embedId: l.embed_id || null,
        chapterId: l.chapter?.id || l.chapter_id || null,
      });
    }
    if (!data?.page_info?.has_next_page) break;
    cursor = data.page_info.end_cursor;
  }
  return out;
}

/**
 * Draft lessons appear in the API the moment "Add lesson" is clicked
 * (often titled "Lesson 2", type multi/text, no video/pdf yet).
 * Only announce when the creator finished naming + attached media.
 */
function isPlaceholderTitle(title) {
  const t = String(title || '').trim();
  if (!t) return true;
  if (/^untitled\b/i.test(t)) return true;
  if (/^lesson\s*\d+$/i.test(t)) return true;
  if (/^new\s+lesson$/i.test(t)) return true;
  return false;
}

function isLessonReady(lesson) {
  if (!lesson || lesson.visibility === 'hidden') return false;
  if (isPlaceholderTitle(lesson.title)) return false;
  const type = String(lesson.lessonType || 'text').toLowerCase();
  if (type === 'video') return !!lesson.videoReady;
  if (type === 'pdf') return !!lesson.pdfReady;
  if (type === 'multi') {
    // Multi is ready once it has a real name AND (video or pdf or real body)
    return !!(lesson.videoReady || lesson.pdfReady || lesson.hasContent);
  }
  // text / quiz / knowledge_check — require a real title + body (no empty shells)
  if (type === 'text') return !!lesson.hasContent;
  // quizzes etc: named is enough (they are intentional content units)
  if (type === 'quiz' || type === 'knowledge_check') return true;
  return !!(lesson.videoReady || lesson.pdfReady || lesson.hasContent);
}

/**
 * Prefer a lesson-deep link; fall back to course → experience → company.
 * Whop consumer URLs vary; these patterns are the ones that open in-app.
 */
function lessonLink(settings, entry, lesson) {
  const route = settings.companyRoute ? encodeURIComponent(settings.companyRoute) : null;
  const courseId = entry?.courseId || entry?.id || null;
  const lessonId = lesson?.id || null;
  const expId = entry?.experienceId || null;

  if (route && courseId && lessonId) {
    // Deep-link into the specific lesson when possible
    return `https://whop.com/${route}/courses/${encodeURIComponent(courseId)}?lesson=${encodeURIComponent(lessonId)}`;
  }
  if (route && courseId) {
    return `https://whop.com/${route}/courses/${encodeURIComponent(courseId)}`;
  }
  if (route) {
    return `https://whop.com/${route}`;
  }
  if (expId) {
    return `https://whop.com/experiences/${encodeURIComponent(expId)}`;
  }
  if (settings.companyId) {
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

  let companyRoute = s.companyRoute;
  let companyTitle = s.companyTitle;
  if (!companyRoute || !companyTitle) {
    try {
      const resolved = await resolveCompany(s.apiKey);
      if (resolved?.companyRoute) companyRoute = resolved.companyRoute;
      if (resolved?.title) companyTitle = resolved.title;
    } catch { /* */ }
    if (!companyRoute) companyRoute = await fetchCompanyRoute(s.apiKey, s.companyId);
  }

  const [catalog, appsRaw] = await Promise.all([
    listCourses(s.apiKey, s),
    listExperiences(s.apiKey, s),
  ]);

  // Fill missing experience names from the apps list
  const appById = Object.fromEntries(appsRaw.map(a => [a.id, a]));
  for (const c of catalog) {
    if (!c.experienceName && c.experienceId && appById[c.experienceId]) {
      c.experienceName = appById[c.experienceId].name;
    }
  }

  // Course apps = experiences that actually host at least one course
  const usedExp = new Set(catalog.map(c => c.experienceId).filter(Boolean));
  let apps = appsRaw.filter(a => usedExp.has(a.id));
  // If API hid experiences, still surface apps from course data
  if (!apps.length && usedExp.size) {
    apps = [...usedExp].map(id => {
      const sample = catalog.find(c => c.experienceId === id);
      return {
        id,
        name: sample?.experienceName || id,
        description: null,
        appName: 'Courses',
        image: sample?.cover || null,
        courseCount: catalog.filter(c => c.experienceId === id).length,
      };
    });
  } else {
    apps = apps.map(a => ({
      ...a,
      courseCount: catalog.filter(c => c.experienceId === a.id).length,
    }));
  }

  setSettings(guildId, {
    catalog,
    apps,
    companyRoute: companyRoute || s.companyRoute,
    companyTitle: companyTitle || s.companyTitle,
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
    type: 'course',
    id: fromCatalog.id,
    title: fromCatalog.title,
    cover,
    experienceId: fromCatalog.experienceId || null,
    experienceName: fromCatalog.experienceName || null,
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


/** Track an entire course app (experience) — every course under it. */
async function addAppToLog(guildId, experienceId, { channelId = null, mentionRoleId = null } = {}) {
  const s = getSettings(guildId);
  if (s.log.some(e => e.type === 'app' && e.id === experienceId)) {
    return { ok: true, already: true, settings: s };
  }

  const fromApps = (s.apps || []).find(a => a.id === experienceId);
  const courses = (s.catalog || []).filter(c => c.experienceId === experienceId);
  if (!fromApps && !courses.length) return { error: 'unknown_app' };

  let entry = {
    type: 'app',
    id: experienceId,
    title: fromApps?.name || courses[0]?.experienceName || experienceId,
    cover: fromApps?.image || courses[0]?.cover || null,
    experienceId,
    experienceName: fromApps?.name || courses[0]?.experienceName || null,
    channelId: channelId || null,
    mentionRoleId: mentionRoleId || null,
    known: {},
    baselined: false,
    addedAt: Date.now(),
  };

  if (s.apiKey) entry = await baselineAppEntry(s.apiKey, entry, courses.map(c => c.id));

  const log = [...s.log, entry];
  setSettings(guildId, { log, lastError: null });
  return { ok: true, settings: getSettings(guildId) };
}

async function baselineAppEntry(apiKey, entry, courseIds) {
  const known = { ...(entry.known || {}) };
  const ids = courseIds?.length
    ? courseIds
    : (await listCourses(apiKey, { companyId: null })).map(c => c.id); // fallback unused
  // Prefer explicit course ids from catalog
  let list = courseIds;
  if (!list || !list.length) {
    try {
      // Re-list all courses and filter by experience
      const all = [];
      // listCourses needs company — caller passes ids when possible
    } catch { /* */ }
  }
  const targets = Array.isArray(courseIds) ? courseIds : [];
  for (const cid of targets) {
    try {
      const lessons = await listLessons(apiKey, cid);
      for (const l of lessons) known[l.id] = true;
    } catch (err) {
      console.warn(`[WHOP] baseline app course ${cid}:`, err.message);
    }
  }
  return { ...entry, known, baselined: true };
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

    // Refresh cover if missing, or if it still looks like a tiny thumb CDN
    // path (common when an older pickCover preferred optimized_url).
    const coverLooksWeak = !e.cover
      || /\/(thumb|small|64|128|256)[/.]/i.test(e.cover)
      || /[?&](w|width)=(64|128|256)\b/i.test(e.cover);
    if (coverLooksWeak) {
      const full = await retrieveCourse(s.apiKey, e.id);
      if (full) {
        const next = pickCover(full);
        if (next) e = { ...e, cover: next };
      }
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
      if (lesson.visibility === 'hidden') {
        known[lesson.id] = true;
        continue;
      }
      // Draft shells stay unknown until ready (video/pdf + real name)
      if (!isLessonReady(lesson)) continue;
      // Optional: skip pure text if host only wants media drops
      if (s.onlyVideos && !['video', 'pdf', 'multi'].includes(String(lesson.lessonType || '').toLowerCase())) {
        known[lesson.id] = true;
        continue;
      }
      if (s.onlyVideos && lesson.lessonType === 'multi' && !lesson.videoReady && !lesson.pdfReady) {
        continue; // multi without media still draft
      }
      fresh.push(lesson);
    }

    fresh.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const batch = fresh.slice(0, s.maxPerCheck);

    // App-level: scan every course under this experience
    if (e.type === 'app') {
      const courseIds = (s.catalog || [])
        .filter(c => c.experienceId === e.id)
        .map(c => c.id);
      // Also pick up courses not yet in catalog by reusing catalog only
      for (const cid of courseIds) {
        let lessons;
        try { lessons = await listLessons(s.apiKey, cid); }
        catch (err) {
          console.warn(`[WHOP] listLessons ${cid}:`, err.message);
          continue;
        }
        const courseMeta = (s.catalog || []).find(c => c.id === cid) || {};
        const fresh = [];
        for (const lesson of lessons) {
          if (known[lesson.id]) continue;
          if (lesson.visibility === 'hidden') {
            known[lesson.id] = true;
            continue;
          }
          if (!isLessonReady(lesson)) continue;
          if (s.onlyVideos && !['video', 'pdf', 'multi'].includes(String(lesson.lessonType || '').toLowerCase())) {
            known[lesson.id] = true;
            continue;
          }
          if (s.onlyVideos && lesson.lessonType === 'multi' && !lesson.videoReady && !lesson.pdfReady) {
            continue;
          }
          fresh.push(lesson);
        }
        fresh.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        const batch = fresh.slice(0, s.maxPerCheck);
        for (const lesson of batch) {
          posts.push({
            ...lesson,
            courseId: cid,
            courseTitle: courseMeta.title || cid,
            courseCover: courseMeta.cover || e.cover || null,
            appName: e.experienceName || e.title || courseMeta.experienceName || s.companyTitle || 'Course app',
            companyTitle: s.companyTitle || null,
            experienceId: e.id,
            lessonUrl: lessonLink(s, { id: cid, courseId: cid, experienceId: e.id }, lesson),
            channelId: e.channelId,
            mentionRoleId: e.mentionRoleId || null,
          });
          known[lesson.id] = true;
        }
      }
      nextLog.push({ ...e, known, baselined: true });
      continue;
    }

    for (const lesson of batch) {
      posts.push({
        ...lesson,
        courseId: e.id,
        courseTitle: e.title,
        courseCover: e.cover || null,
        appName: e.experienceName || s.companyTitle || 'Course app',
        companyTitle: s.companyTitle || null,
        experienceId: e.experienceId || null,
        lessonUrl: lessonLink(s, e, lesson),
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
  listExperiences,
  listLessons,
  scanCourses,
  addToLog,
  addAppToLog,
  removeFromLog,
  updateLogEntry,
  baselineAll,
  newLessons,
  lessonLink,
  isLessonReady,
  isPlaceholderTitle,
  pickCover,
};
