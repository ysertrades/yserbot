'use strict';

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'whop.json';
const API = 'https://api.whop.com/api/v1';
const UA = 'QuantLabBot/1.0 (+https://quantlab.bot)';

const DEFAULTS = {
  enabled: false,
  apiKey: null,
  companyId: null,
  companyRoute: null,
  companyTitle: null,
  pollMinutes: 0.5,
  onlyVideos: true,
  maxPerCheck: 3,
  buttonLabel: 'Open course',
  catalog: [],
  apps: [],
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
    catalog: Array.isArray(stored.catalog) ? stored.catalog : (Array.isArray(stored.courses) ? stored.courses : []),
    apps: Array.isArray(stored.apps) ? stored.apps : [],
    log,
    pollMinutes: Math.min(120, Math.max(0.25, Number(stored.pollMinutes) || 0.5)),
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
  const candidates = [
    c?.thumbnail?.source_url, c?.thumbnail?.url, c?.thumbnail?.optimized_url,
    typeof c?.cover_image === 'string' ? c.cover_image : null,
    c?.cover_image?.source_url, c?.cover_image?.url, c?.cover_image?.optimized_url,
    typeof c?.cover === 'string' ? c.cover : null, c?.cover?.source_url, c?.cover?.url,
    c?.image?.source_url, c?.image?.url, c?.image?.optimized_url,
    typeof c?.image === 'string' ? c.image : null,
    ...(Array.isArray(c?.images) ? c.images.flatMap(img => [
      typeof img === 'string' ? img : null, img?.source_url, img?.url, img?.optimized_url,
    ]) : []),
  ];
  const urls = candidates.filter(u => typeof u === 'string' && /^https:\/\//i.test(u.trim())).map(u => u.trim());
  const ranked = urls.sort((a, b) => {
    const score = u => (/w=\d{3,}|width=\d{3,}|original|source|large|full/i.test(u) ? 2 : 0)
      + (/optimized|thumb|small|64|128|256/i.test(u) ? -1 : 0) + Math.min(u.length, 200) / 200;
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
  try { return await whopFetch(apiKey, `/courses/${courseId}`); } catch { return null; }
}

function pickExperience(c) {
  if (!c || typeof c !== 'object') return { id: null, name: null };
  const exp = c.experience || c.experience_obj || null;
  if (typeof exp === 'string' && exp) return { id: exp, name: null };
  if (exp && typeof exp === 'object') {
    return {
      id: exp.id || exp.experience_id || null,
      name: exp.name || exp.title || exp.app?.name || exp.app_name || null,
    };
  }
  return {
    id: c.experience_id || c.experienceId || c.app_id || c.appId || null,
    name: c.experience_name || c.app_name || c.app?.name || null,
  };
}

function mapCourse(c) {
  if (!c?.id) return null;
  const vis = String(c.visibility || c.status || '').toLowerCase();
  if (['deleted', 'archived', 'removed'].includes(vis)) return null;
  if (c.deleted_at || c.archived_at) return null;
  const exp = pickExperience(c);
  return {
    id: c.id,
    title: c.title || c.name || c.id,
    tagline: c.tagline || null,
    chaptersCount: c.chapters_count ?? null,
    lessonsCount: c.total_lessons_count ?? c.lessons_count ?? null,
    cover: pickCover(c),
    experienceId: exp.id || null,
    experienceName: exp.name || null,
    visibility: vis || 'visible',
  };
}

async function listCourses(apiKey, settings, extra = {}) {
  if (!settings.companyId) {
    throw Object.assign(new Error('missing_company'), { detail: 'Set Company ID (biz_…) and Save before scanning.' });
  }
  const scopes = [];
  const expId = extra.experience_id || extra.experienceId || null;
  const rest = { ...extra };
  delete rest.experienceId;
  if (expId) {
    scopes.push({ experience_id: expId });
    scopes.push({ account_id: settings.companyId, experience_id: expId });
    scopes.push({ company_id: settings.companyId, experience_id: expId });
  } else {
    scopes.push({ account_id: settings.companyId, ...rest });
    scopes.push({ company_id: settings.companyId, ...rest });
  }
  let lastErr = null, best = [], gotOk = false;
  for (const scope of scopes) {
    try {
      const out = [];
      let cursor = null;
      for (let page = 0; page < 20; page++) {
        const params = { first: 50, ...scope };
        if (cursor) params.after = cursor;
        const data = await whopFetch(apiKey, '/courses', params);
        const rows = data?.data || data?.courses || (Array.isArray(data) ? data : []);
        for (const c of rows) {
          const mapped = mapCourse(c);
          if (mapped) out.push(mapped);
        }
        if (!data?.page_info?.has_next_page) break;
        cursor = data.page_info.end_cursor;
      }
      gotOk = true;
      if (out.length > best.length) best = out;
      if (out.length) return out;
    } catch (err) { lastErr = err; }
  }
  if (best.length) return best;
  if (!gotOk && lastErr) throw lastErr;
  return best;
}

async function listExperiences(apiKey, settings) {
  if (!settings.companyId) return [];
  const scopes = [{ account_id: settings.companyId }, { company_id: settings.companyId }];
  let lastErr = null, best = [];
  for (const scope of scopes) {
    try {
      const out = [];
      let cursor = null;
      for (let page = 0; page < 15; page++) {
        const params = { first: 50, ...scope };
        if (cursor) params.after = cursor;
        const data = await whopFetch(apiKey, '/experiences', params);
        const rows = data?.data || data?.experiences || (Array.isArray(data) ? data : []);
        for (const x of rows) {
          if (!x.id) continue;
          out.push({
            id: x.id,
            name: x.name || x.title || x.app?.name || x.id,
            description: x.description || null,
            appName: x.app?.name || x.app_name || null,
            image: pickCover(x) || (typeof x.image_url === 'string' ? x.image_url : null)
              || (typeof x.image?.url === 'string' ? x.image.url : null),
          });
        }
        if (!data?.page_info?.has_next_page) break;
        cursor = data.page_info.end_cursor;
      }
      if (out.length > best.length) best = out;
      if (out.length) break;
    } catch (err) { lastErr = err; }
  }
  if (lastErr && !best.length) console.warn('[WHOP] listExperiences:', lastErr.message);
  const courseApps = best.filter(a =>
    /course/i.test(String(a.appName || '')) || /course/i.test(String(a.name || '')));
  return courseApps.length ? courseApps : best;
}

/** Auto video-frame / mux thumb — not a hand-uploaded banner. */
function isAutoVideoFrameUrl(u) {
  const s = String(u || '').toLowerCase();
  if (!s) return false;
  return /mux\.com|image\.mux|stream\.mux|videodelivery\.net|cloudflarestream|\/thumbnails?\/|storyboard|animated\.gif|[?&]time=\d|frame\.jpe?g|thumbnail\.jpe?g/.test(s)
    || /\/video[^/]*\/(thumb|poster|frame)/.test(s);
}

function pickLessonBanner(l) {
  const candidates = [
    l?.thumbnail?.source_url, l?.thumbnail?.url, l?.thumbnail?.optimized_url,
    typeof l?.thumbnail === 'string' ? l.thumbnail : null,
    typeof l?.cover_image === 'string' ? l.cover_image : null,
    l?.cover_image?.source_url, l?.cover_image?.url, l?.cover_image?.optimized_url,
    typeof l?.cover === 'string' ? l.cover : null, l?.cover?.source_url, l?.cover?.url,
    typeof l?.banner === 'string' ? l.banner : null, l?.banner?.source_url, l?.banner?.url,
    typeof l?.image === 'string' ? l.image : null, l?.image?.source_url, l?.image?.url,
    l?.video_asset?.thumbnail_url, l?.video_asset?.poster_url, l?.mux_asset?.thumbnail_url,
    l?.video?.thumbnail_url, l?.video?.poster_url,
  ].filter(u => typeof u === 'string' && /^https:\/\//i.test(u.trim())).map(u => u.trim());

  if (!candidates.length) return { url: null, kind: null };

  const uploads = candidates.filter(u => !isAutoVideoFrameUrl(u));
  const frames = candidates.filter(u => isAutoVideoFrameUrl(u));
  const rank = (u) => (/w=\d{3,}|width=\d{3,}|original|source|large|full/i.test(u) ? 2 : 0)
    + (/optimized|thumb|small|64|128|256/i.test(u) ? -1 : 0) + Math.min(u.length, 200) / 200;
  uploads.sort((a, b) => rank(b) - rank(a));
  frames.sort((a, b) => rank(b) - rank(a));

  if (uploads.length) return { url: uploads[0], kind: 'upload' };
  if (frames.length) return { url: frames[0], kind: 'frame' };
  return { url: candidates[0], kind: 'frame' };
}

function mapLesson(l) {
  if (!l?.id) return null;
  const video = l.video_asset || l.mux_asset || l.muxAsset || l.video || null;
  const pdf = l.main_pdf || l.pdf || null;
  const videoReady = !!(
    (video && (
      video.signed_playback_id || video.playback_id || video.signedPlaybackId
      || video.status === 'ready' || video.finished_uploading_at
      || (Number(video.duration_seconds) || 0) > 0
      || video.id || video.asset_id
    ))
    || l.embed_id || l.embed_type
  );
  const pdfReady = !!(pdf && (pdf.source_url || pdf.url || pdf.id || pdf.filename));
  const contentLen = String(l.content || '').trim().length;
  const banner = pickLessonBanner(l);
  return {
    id: l.id,
    title: (l.title || '').trim() || 'Untitled lesson',
    lessonType: l.lesson_type || l.lessonType || null,
    createdAt: l.created_at || null,
    visibility: l.visibility || 'visible',
    videoReady,
    pdfReady,
    hasContent: contentLen >= 40,
    embedId: l.embed_id || null,
    chapterId: l.chapter?.id || l.chapter_id || null,
    lessonBanner: banner.url,
    lessonBannerKind: banner.kind,
  };
}

async function listLessons(apiKey, courseId) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 30; page++) {
    const params = { course_id: courseId, first: 50 };
    if (cursor) params.after = cursor;
    const data = await whopFetch(apiKey, '/course_lessons', params);
    for (const l of (data?.data || data?.course_lessons || [])) {
      const mapped = mapLesson(l);
      if (mapped) out.push(mapped);
    }
    if (!data?.page_info?.has_next_page) break;
    cursor = data.page_info.end_cursor;
  }
  return out;
}

async function retrieveLesson(apiKey, lessonId) {
  if (!lessonId) return null;
  try { return await whopFetch(apiKey, `/course_lessons/${lessonId}`); } catch { return null; }
}

async function enrichLesson(apiKey, lesson, { force = false } = {}) {
  if (!lesson?.id) return lesson;
  const needsFull = force
    || !(lesson.videoReady || lesson.pdfReady || lesson.hasContent)
    || !lesson.lessonBannerKind;
  if (!needsFull) return lesson;
  const type = String(lesson.lessonType || '').toLowerCase();
  if (!force && type && !['video', 'pdf', 'multi', '', 'text'].includes(type)) return lesson;
  const full = await retrieveLesson(apiKey, lesson.id);
  if (!full) return lesson;
  const mapped = mapLesson(full);
  if (!mapped) return lesson;
  return {
    ...lesson,
    ...mapped,
    title: mapped.title || lesson.title,
    lessonType: mapped.lessonType || lesson.lessonType,
    lessonBanner: mapped.lessonBanner || lesson.lessonBanner || null,
    lessonBannerKind: mapped.lessonBannerKind || lesson.lessonBannerKind || null,
  };
}

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
  if (lesson.videoReady || lesson.pdfReady) return true;
  const type = String(lesson.lessonType || '').toLowerCase();
  if (type === 'video' || type === 'pdf') return false;
  if (type === 'multi') return !!lesson.hasContent;
  if (type === 'quiz' || type === 'knowledge_check') return true;
  if (type === 'text') return !!lesson.hasContent;
  return true;
}

function considerLesson(lesson, onlyVideos) {
  if (!lesson || lesson.visibility === 'hidden') return 'skip_hide';
  if (isPlaceholderTitle(lesson.title)) return 'draft';
  if (!isLessonReady(lesson)) return 'draft';
  const type = String(lesson.lessonType || '').toLowerCase();
  if (onlyVideos) {
    if (type === 'video' || type === 'pdf' || type === 'multi') {
      if (!lesson.videoReady && !lesson.pdfReady) return 'draft';
      return 'post';
    }
    if (lesson.videoReady || lesson.pdfReady) return 'post';
    return 'skip_text';
  }
  return 'post';
}

function lessonLink(settings, entry, lesson) {
  // Prefer experience / joined — legacy /{route}/courses/{id} 404s on new Whop.
  const route = settings.companyRoute ? encodeURIComponent(settings.companyRoute) : null;
  const courseId = entry?.courseId || entry?.id || null;
  const lessonId = lesson?.id || null;
  const expId = entry?.experienceId || lesson?.experienceId || null;
  if (expId) return `https://whop.com/experiences/${encodeURIComponent(expId)}`;
  if (route) return `https://whop.com/joined/${route}`;
  if (settings.companyId) return `https://whop.com/${encodeURIComponent(settings.companyId)}`;
  if (route && courseId) return `https://whop.com/${route}/courses/${encodeURIComponent(courseId)}`;
  return null;
}

async function baselineEntry(apiKey, entry) {
  const known = { ...(entry.known || {}) };
  try {
    const lessons = await listLessons(apiKey, entry.id);
    for (let l of lessons) {
      l = await enrichLesson(apiKey, l);
      if (considerLesson(l, true) === 'draft') continue;
      known[l.id] = true;
    }
  } catch (err) {
    console.warn(`[WHOP] baseline ${entry.id}:`, err.message);
  }
  return { ...entry, known, baselined: true };
}

async function resolveAppCourseIds(settings, entry) {
  const fromCatalog = (settings.catalog || []).filter(c => c.experienceId === entry.id).map(c => c.id);
  if (fromCatalog.length) return fromCatalog;
  if (!settings.apiKey || !settings.companyId) return [];
  try {
    const rows = await listCourses(settings.apiKey, settings, { experience_id: entry.id });
    return rows.map(c => c.id).filter(Boolean);
  } catch (err) {
    console.warn(`[WHOP] resolveAppCourseIds ${entry.id}:`, err.message);
    return [];
  }
}

async function baselineAppEntry(apiKey, entry, courseIds) {
  const known = { ...(entry.known || {}) };
  const targets = Array.isArray(courseIds) ? courseIds.filter(Boolean) : [];
  for (const cid of targets) {
    try {
      const lessons = await listLessons(apiKey, cid);
      for (let l of lessons) {
        l = await enrichLesson(apiKey, l);
        if (considerLesson(l, true) === 'draft') continue;
        known[l.id] = true;
      }
    } catch (err) {
      console.warn(`[WHOP] baseline app course ${cid}:`, err.message);
    }
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
    if (entry.type === 'app') {
      const courseIds = await resolveAppCourseIds(s, entry);
      log.push(await baselineAppEntry(s.apiKey, entry, courseIds));
    } else {
      log.push(await baselineEntry(s.apiKey, entry));
    }
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

  let appsRaw = [];
  try { appsRaw = await listExperiences(s.apiKey, s); }
  catch (err) { console.warn('[WHOP] listExperiences:', err.message); appsRaw = []; }

  let catalog = [];
  try { catalog = await listCourses(s.apiKey, s); }
  catch (err) { console.warn('[WHOP] listCourses:', err.message); catalog = []; }

  const byId = new Map(catalog.map(c => [c.id, c]));
  for (const app of (appsRaw || []).slice(0, 30)) {
    let rows = [];
    try { rows = await listCourses(s.apiKey, s, { experience_id: app.id }); } catch { rows = []; }
    for (const c of rows) {
      const prev = byId.get(c.id) || c;
      byId.set(c.id, {
        ...prev, ...c,
        experienceId: c.experienceId || app.id,
        experienceName: c.experienceName || app.name || prev.experienceName,
        cover: c.cover || prev.cover,
      });
    }
  }
  catalog = [...byId.values()];

  const appById = Object.fromEntries((appsRaw || []).map(a => [a.id, a]));
  for (const c of catalog) {
    if (c.experienceId && appById[c.experienceId] && !c.experienceName) {
      c.experienceName = appById[c.experienceId].name;
    }
  }
  if (appsRaw.length === 1) {
    const only = appsRaw[0];
    for (const c of catalog) {
      if (!c.experienceId) {
        c.experienceId = only.id;
        c.experienceName = c.experienceName || only.name;
      }
    }
  }

  const appsMap = new Map();
  for (const a of appsRaw || []) {
    appsMap.set(a.id, {
      id: a.id, name: a.name || a.appName || a.id, description: a.description || null,
      appName: a.appName || null, image: a.image || null,
      courseCount: catalog.filter(c => c.experienceId === a.id).length,
    });
  }
  for (const c of catalog) {
    if (!c.experienceId || appsMap.has(c.experienceId)) continue;
    appsMap.set(c.experienceId, {
      id: c.experienceId, name: c.experienceName || c.experienceId, description: null,
      appName: null, image: c.cover || null,
      courseCount: catalog.filter(x => x.experienceId === c.experienceId).length,
    });
  }
  const allApps = [...appsMap.values()];
  const withCourses = allApps.filter(a => (a.courseCount || 0) > 0);
  const courseNamed = allApps.filter(a =>
    /course/i.test(String(a.appName || '')) || /course/i.test(String(a.name || '')));
  const apps = (withCourses.length ? withCourses : (courseNamed.length ? courseNamed : allApps))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  setSettings(guildId, {
    catalog, apps,
    companyRoute: companyRoute || s.companyRoute,
    companyTitle: companyTitle || s.companyTitle,
    lastScanAt: Date.now(), lastError: null,
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
    type: 'course', id: fromCatalog.id, title: fromCatalog.title, cover,
    experienceId: fromCatalog.experienceId || null,
    experienceName: fromCatalog.experienceName || null,
    channelId, mentionRoleId, known: {}, baselined: false, addedAt: Date.now(),
  };
  if (s.apiKey) entry = await baselineEntry(s.apiKey, entry);
  const log = [...s.log, entry];
  return { ok: true, settings: setSettings(guildId, { log }) };
}

async function addAppToLog(guildId, experienceId, { channelId = null, mentionRoleId = null } = {}) {
  const s = getSettings(guildId);
  if (s.log.some(e => e.id === experienceId && e.type === 'app')) {
    return { ok: true, already: true, settings: s };
  }
  const app = (s.apps || []).find(a => a.id === experienceId);
  const courseIds = (s.catalog || []).filter(c => c.experienceId === experienceId).map(c => c.id);
  let entry = {
    type: 'app', id: experienceId,
    title: app?.name || experienceId,
    cover: app?.image || null,
    experienceId, experienceName: app?.name || null,
    channelId, mentionRoleId, known: {}, baselined: false, addedAt: Date.now(),
  };
  if (s.apiKey) entry = await baselineAppEntry(s.apiKey, entry, courseIds);
  const log = [...s.log, entry];
  return { ok: true, settings: setSettings(guildId, { log }) };
}

function removeFromLog(guildId, id) {
  const s = getSettings(guildId);
  const log = s.log.filter(e => e.id !== id);
  return setSettings(guildId, { log });
}

function updateLogEntry(guildId, id, patch) {
  const s = getSettings(guildId);
  const log = s.log.map(e => e.id === id ? { ...e, ...patch } : e);
  return setSettings(guildId, { log });
}

async function newLessons(guildId) {
  const s = getSettings(guildId);
  if (!s.apiKey || !s.log.length) return { posts: [] };
  const posts = [];
  const nextLog = [];

  for (const entry of s.log) {
    let e = entry;

    if (e.type === 'app') {
      const courseIds = await resolveAppCourseIds(s, e);
      if (!e.baselined) {
        e = await baselineAppEntry(s.apiKey, e, courseIds);
        nextLog.push(e);
        continue;
      }
      const known = { ...(e.known || {}) };
      const fresh = [];
      for (const cid of courseIds) {
        let lessons;
        try { lessons = await listLessons(s.apiKey, cid); }
        catch (err) {
          console.warn(`[WHOP] listLessons app ${cid}:`, err.message);
          continue;
        }
        const courseMeta = (s.catalog || []).find(c => c.id === cid) || {};
        for (let lesson of lessons) {
          if (known[lesson.id]) {
            lesson = await enrichLesson(s.apiKey, lesson);
            const d = considerLesson(lesson, s.onlyVideos);
            if (d === 'draft') delete known[lesson.id];
            else continue;
          }
          if (known[lesson.id]) continue;
          lesson = await enrichLesson(s.apiKey, lesson, { force: true });
          const decision = considerLesson(lesson, s.onlyVideos);
          if (decision === 'skip_hide' || decision === 'skip_text') {
            known[lesson.id] = true;
            continue;
          }
          if (decision === 'draft') continue;
          fresh.push({
            ...lesson,
            courseId: cid,
            courseTitle: courseMeta.title || e.title,
            courseCover: courseMeta.cover || e.cover || null,
            appName: e.experienceName || e.title || s.companyTitle || 'Course app',
            companyTitle: s.companyTitle || null,
            experienceId: e.experienceId || e.id,
            lessonUrl: lessonLink(s, { ...e, id: cid, courseId: cid }, lesson),
            channelId: e.channelId,
            mentionRoleId: e.mentionRoleId || null,
          });
        }
      }
      fresh.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      for (const lesson of fresh.slice(0, s.maxPerCheck)) {
        posts.push(lesson);
        known[lesson.id] = true;
      }
      nextLog.push({ ...e, known, baselined: true });
      continue;
    }

    // course entry
    if (!e.baselined) {
      e = await baselineEntry(s.apiKey, e);
      nextLog.push(e);
      continue;
    }

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
    try { lessons = await listLessons(s.apiKey, e.id); }
    catch (err) {
      console.warn(`[WHOP] listLessons ${e.id}:`, err.message);
      nextLog.push(e);
      continue;
    }

    const known = { ...(e.known || {}) };
    const fresh = [];
    for (let lesson of lessons) {
      if (known[lesson.id]) {
        lesson = await enrichLesson(s.apiKey, lesson);
        const d = considerLesson(lesson, s.onlyVideos);
        if (d === 'draft') delete known[lesson.id];
        else continue;
      }
      if (known[lesson.id]) continue;
      lesson = await enrichLesson(s.apiKey, lesson, { force: true });
      const decision = considerLesson(lesson, s.onlyVideos);
      if (decision === 'skip_hide' || decision === 'skip_text') {
        known[lesson.id] = true;
        continue;
      }
      if (decision === 'draft') continue;
      fresh.push(lesson);
    }
    fresh.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    for (const lesson of fresh.slice(0, s.maxPerCheck)) {
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
  if (posts.length) console.log(`[WHOP] ${guildId}: ${posts.length} new lesson(s) to post`);
  return { posts };
}

module.exports = {
  FILE, DEFAULTS, getSettings, setSettings, maskKey,
  resolveCompany, fetchCompanyRoute, listCourses, listExperiences, listLessons,
  scanCourses, addToLog, addAppToLog, removeFromLog, updateLogEntry,
  baselineAll, newLessons, lessonLink, isLessonReady, isPlaceholderTitle, pickCover, pickLessonBanner, isAutoVideoFrameUrl,
};
