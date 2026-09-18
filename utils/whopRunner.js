'use strict';

const { AttachmentBuilder } = require('discord.js');
const whop = require('./whopFeed');
const messageStyle = require('./messageStyle');
const { generateWhopBannerImage } = require('./whopVisual');

const TICK_MS = 60_000;
const GAP_MS = 2_500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Lesson alerts use the same Components V2 card language as giveaways:
 * accent container, compact lines, full-width banner, divider, action button,
 * divider, quiet footer. Less copy, more structure.
 */

const IS_COMPONENTS_V2 = 1 << 15;
const ACCENT = 0x9397EE; // QuantLab periwinkle — same family as giveaway cards

function typeLabel(t) {
  const x = String(t || '').toLowerCase();
  if (x === 'video') return 'Video';
  if (x === 'pdf') return 'PDF';
  if (x === 'multi') return 'Lesson';
  if (x === 'quiz') return 'Quiz';
  if (x === 'knowledge_check') return 'Check';
  if (x === 'text') return 'Reading';
  return 'Lesson';
}

function resolveLessonUrl(settings, lesson) {
  let url = lesson.lessonUrl
    || (settings.companyRoute ? `https://whop.com/${encodeURIComponent(settings.companyRoute)}` : null)
    || (settings.companyId ? `https://whop.com/${encodeURIComponent(settings.companyId)}` : null);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try { new URL(url); } catch { return null; }
  return url;
}

/**
 * Giveaway-style V2 card for a new lesson.
 *
 *   # New lesson
 *   Lesson / Course / App
 *   [banner]
 *   ───
 *   [ View lesson ]
 *   ───
 *   -# QuantLab · Video
 */
function buildLessonV2(guild, settings, lesson, imageUrl) {
  const title = String(lesson.title || 'New lesson').slice(0, 120);
  const course = String(lesson.courseTitle || '').slice(0, 80);
  const app = String(lesson.appName || lesson.companyTitle || '').slice(0, 80);
  const kind = typeLabel(lesson.lessonType);

  const lines = [
    'Lesson: **' + title + '**',
    course ? ('Course: **' + course + '**') : null,
    app ? ('App: **' + app + '**') : null,
  ].filter(Boolean).join('\n');

  const kids = [];
  kids.push({ type: 10, content: ('# New lesson\n\n' + lines).slice(0, 4000) });

  if (imageUrl && (/^https:\/\//i.test(imageUrl) || /^attachment:\/\//i.test(imageUrl))) {
    kids.push({ type: 12, items: [{ media: { url: imageUrl } }] });
  }

  kids.push({ type: 14, divider: true, spacing: 1 });

  const url = resolveLessonUrl(settings, lesson);
  const label = (settings.buttonLabel && settings.buttonLabel !== 'Open course')
    ? String(settings.buttonLabel).slice(0, 80)
    : 'View lesson';
  if (url) {
    kids.push({
      type: 1,
      components: [{ type: 2, style: 5, label, url }],
    });
    kids.push({ type: 14, divider: true, spacing: 1 });
  }

  kids.push({
    type: 10,
    content: ('-# QuantLab · ' + kind).slice(0, 4000),
  });

  return {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: kids.filter(Boolean),
    }],
  };
}

async function resolveBanner(lesson) {
  const files = [];
  let imageUrl = null;
  const banner = typeof lesson.courseCover === 'string' ? lesson.courseCover.trim() : '';
  if (banner && /^https:\/\//i.test(banner)) {
    imageUrl = banner;
  } else {
    try {
      const courseName = (lesson.courseTitle || 'COURSE').toUpperCase().slice(0, 28);
      const appLine = (lesson.appName || lesson.companyTitle || 'APP').toUpperCase().slice(0, 32);
      const png = generateWhopBannerImage({
        pill: 'NEW LESSON',
        heading: courseName,
        subtitle: (lesson.title || 'NEW LESSON').toUpperCase().slice(0, 40),
        tagline: appLine + ' · JUST DROPPED.',
      });
      const name = 'whop-lesson.png';
      files.push(new AttachmentBuilder(png, { name }));
      imageUrl = `attachment://${name}`;
    } catch (err) {
      console.warn('[WHOP] generated banner failed:', err.message);
    }
  }
  return { imageUrl, files };
}

async function postLesson(guild, settings, lesson) {
  const channel = guild.channels.cache.get(lesson.channelId);
  if (!channel || !channel.isTextBased?.()) return false;

  // Appearance can still disable the feed entirely
  const style = messageStyle.styleFor(guild.id, 'whop.lesson');
  if (style && style.enabled === false) return false;

  const { imageUrl, files } = await resolveBanner(lesson);
  const v2 = buildLessonV2(guild, settings, lesson, imageUrl);
  const roleId = lesson.mentionRoleId || null;

  await channel.send({
    content: roleId ? `<@&${roleId}>` : undefined,
    flags: v2.flags,
    components: v2.components,
    files: files.length ? files : undefined,
    allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
  });
  return true;
}

async function checkGuild(client, guildId) {
  let settings = whop.getSettings(guildId);
  if (!settings.enabled || !settings.apiKey || !settings.log.length) return;

  // Near-immediate: poll interval is minutes, but the runner ticks every 60s.
  // Skip if last successful check was within the configured window (min 1m).
  const intervalMs = Math.max(60_000, (Number(settings.pollMinutes) || 2) * 60_000);
  const last = Number(settings.lastCheckAt) || 0;
  if (last && Date.now() - last < intervalMs - 5_000) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  // Safety: baseline anything not ready before considering posts
  const needsBaseline = settings.log.some(e => !e.baselined);
  if (needsBaseline) {
    await whop.baselineAll(guildId);
    settings = whop.getSettings(guildId);
  }

  let result;
  try {
    result = await whop.newLessons(guildId);
  } catch (err) {
    whop.setSettings(guildId, { lastError: err.message || String(err) });
    console.error(`[WHOP] ${guildId}:`, err.message);
    return;
  }

  for (const lesson of result.posts || []) {
    try {
      await postLesson(guild, settings, lesson);
    } catch (err) {
      console.error(`[WHOP] post ${lesson.id}:`, err.message);
    }
    await sleep(GAP_MS);
  }

  whop.setSettings(guildId, { lastError: null, lastCheckAt: Date.now() });
}

async function runTick(client) {
  const { isFeatureEnabled } = require('./featureToggles');
  const stored = require('./jsonStorage').readJson(whop.FILE, {});
  for (const guildId of Object.keys(stored)) {
    if (!isFeatureEnabled(guildId, 'whop')) continue;
    if (!whop.getSettings(guildId).enabled) continue;
    if (!client.guilds.cache.has(guildId)) continue;
    await checkGuild(client, guildId);
    await sleep(GAP_MS);
  }
}

let timer = null;

function startWhopRunner(client) {
  const tick = () => runTick(client).catch(err => console.error('[WHOP RUNNER]', err));
  setTimeout(tick, 12_000);
  timer = setInterval(tick, TICK_MS);
  return timer;
}

function stopWhopRunner() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startWhopRunner, stopWhopRunner, runTick, checkGuild, postLesson };
