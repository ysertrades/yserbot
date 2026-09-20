'use strict';

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const whop = require('./whopFeed');
const messageStyle = require('./messageStyle');
const { generateWhopBannerImage } = require('./whopVisual');

const TICK_MS = 10_000;
const GAP_MS = 400;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Same flag giveaways use — Components V2 */
const IS_COMPONENTS_V2 = 1 << 15;
const ACCENT = 0x9397EE;

/** Re-scan course library this often so the panel stays current without a manual Scan. */
const CATALOG_REFRESH_MS = 5 * 60_000;

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
    || (lesson.experienceId ? `https://whop.com/experiences/${encodeURIComponent(lesson.experienceId)}` : null)
    || (settings.companyRoute ? `https://whop.com/joined/${encodeURIComponent(settings.companyRoute)}` : null)
    || (settings.companyRoute ? `https://whop.com/${encodeURIComponent(settings.companyRoute)}` : null)
    || (settings.companyId ? `https://whop.com/${encodeURIComponent(settings.companyId)}` : null);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try { new URL(url); } catch { return null; }
  return url;
}

/**
 * Components V2 lesson card:
 * NEW LESSON ✦ QUANTLAB
 * ## lesson title   (## keeps gap under eyebrow tight vs #)
 * [banner]
 * ────
 * [View lesson]
 * ────
 * go to **App** → **Course** → **Lesson**
 */
function buildLessonV2(settings, lesson, imageUrl, mention) {
  const title = String(lesson.title || 'Untitled lesson').slice(0, 120);
  const course = String(lesson.courseTitle || '').slice(0, 100);
  const app = String(lesson.appName || lesson.companyTitle || '').slice(0, 100);

  // ## instead of # — same hierarchy, much less vertical space under the eyebrow
  const header = [
    '-# NEW LESSON  ✦  QUANTLAB',
    '## ' + title,
  ].join('\n');

  const kids = [];
  if (mention) {
    kids.push({ type: 10, content: String(mention).slice(0, 4000) });
  }
  kids.push({ type: 10, content: header.slice(0, 4000) });

  if (imageUrl && (/^https:\/\//i.test(imageUrl) || /^attachment:\/\//i.test(imageUrl))) {
    kids.push({ type: 12, items: [{ media: { url: imageUrl } }] });
  }

  // Separator above the button
  kids.push({ type: 14, divider: true, spacing: 1 });

  const url = resolveLessonUrl(settings, lesson);
  const label = (settings.buttonLabel && String(settings.buttonLabel).trim()
    && settings.buttonLabel !== 'Open course'
    && settings.buttonLabel !== 'open course')
    ? String(settings.buttonLabel).slice(0, 80)
    : 'View lesson';

  if (url) {
    kids.push({
      type: 1,
      components: [{ type: 2, style: 5, label, url }],
    });

    // Separator between button and directing footer
    kids.push({ type: 14, divider: true, spacing: 1 });

    // Directing path: "go to" plain, names bold, joined with →
    const boldBits = [app, course, title].filter(Boolean).map(s => '**' + s + '**');
    if (boldBits.length) {
      kids.push({
        type: 10,
        content: ('-# go to  ' + boldBits.join('  →  ')).slice(0, 4000),
      });
    }
  }

  return {
    flags: IS_COMPONENTS_V2,
    components: [{
      type: 17,
      accent_color: ACCENT,
      components: kids.filter(Boolean),
    }],
  };
}

function buildLessonEmbed(settings, lesson, imageUrl) {
  const title = String(lesson.title || 'Untitled lesson').slice(0, 256);
  const course = String(lesson.courseTitle || '').slice(0, 100);
  const app = String(lesson.appName || lesson.companyTitle || '').slice(0, 100);
  const url = resolveLessonUrl(settings, lesson);
  const boldBits = [app, course, title].filter(Boolean).map(s => '**' + s + '**');
  const path = boldBits.length ? ('go to  ' + boldBits.join('  →  ')) : null;
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(title)
    .setDescription(
      [
        '-# NEW LESSON  ✦  QUANTLAB',
        path ? ('\n' + path) : null,
        url ? ('\n[Open on Whop](' + url + ')') : null,
      ].filter(Boolean).join('\n')
    );
  if (imageUrl && /^https:\/\//i.test(imageUrl)) embed.setImage(imageUrl);
  return embed;
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
  if (!channel || !channel.isTextBased?.()) {
    console.warn(`[WHOP] post: channel missing ${lesson.channelId}`);
    return false;
  }

  const style = messageStyle.styleFor(guild.id, 'whop.lesson');
  if (style && style.enabled === false) {
    console.warn(`[WHOP] post: whop.lesson style disabled for ${guild.id}`);
    return false;
  }

  const { imageUrl, files } = await resolveBanner(lesson);
  const roleId = lesson.mentionRoleId || null;
  const mention = roleId ? `<@&${roleId}>` : null;
  const allowedMentions = roleId ? { roles: [roleId] } : { parse: [] };

  try {
    const v2 = buildLessonV2(settings, lesson, imageUrl, mention);
    await channel.send({
      flags: v2.flags,
      components: v2.components,
      files: files.length ? files : undefined,
      allowedMentions,
    });
    return true;
  } catch (err) {
    console.warn(`[WHOP] V2 post failed (${err.message}) — trying V2 without media`);
  }

  try {
    const v2 = buildLessonV2(settings, lesson, null, mention);
    await channel.send({
      flags: v2.flags,
      components: v2.components,
      files: files.length ? files : undefined,
      allowedMentions,
    });
    return true;
  } catch (err) {
    console.warn(`[WHOP] V2 no-media failed (${err.message}) — falling back to embed`);
  }

  try {
    const embed = buildLessonEmbed(
      settings,
      lesson,
      imageUrl && /^https:\/\//i.test(imageUrl) ? imageUrl : null,
    );
    await channel.send({
      content: mention || undefined,
      embeds: [embed],
      files: files.length ? files : undefined,
      allowedMentions,
    });
    return true;
  } catch (err2) {
    console.error(`[WHOP] embed fallback failed:`, err2.message);
    throw err2;
  }
}

async function maybeRefreshCatalog(guildId, settings) {
  const last = Number(settings.lastScanAt) || 0;
  if (last && Date.now() - last < CATALOG_REFRESH_MS) return;
  try {
    console.log(`[WHOP] auto-scan library ${guildId}`);
    await whop.scanCourses(guildId);
  } catch (err) {
    console.warn(`[WHOP] auto-scan failed:`, err.message || err);
  }
}

async function checkGuild(client, guildId) {
  let settings = whop.getSettings(guildId);
  if (!settings.enabled || !settings.apiKey || !settings.log.length) return;

  const intervalMs = Math.max(15_000, (Number(settings.pollMinutes) || 0.5) * 60_000);
  const last = Number(settings.lastCheckAt) || 0;
  if (last && Date.now() - last < intervalMs - 5_000) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const mins = Number(settings.pollMinutes) || 0.5;
  const every = mins < 1 ? `${Math.round(mins * 60)}s` : `${mins}m`;
  console.log(`[WHOP] check ${guildId} · ${settings.log.length} tracked · every ${every}`);

  await maybeRefreshCatalog(guildId, settings);
  settings = whop.getSettings(guildId);

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

  const posts = result.posts || [];
  if (!posts.length) {
    console.log(`[WHOP] ${guildId}: no new lessons`);
  }

  for (const lesson of posts) {
    try {
      const ok = await postLesson(guild, settings, lesson);
      console.log(`[WHOP] post ${lesson.id} (${lesson.title}): ${ok ? 'ok' : 'skipped'}`);
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
  setTimeout(tick, 1_000);
  timer = setInterval(tick, TICK_MS);
  console.log('[WHOP] runner started (tick every 10s)');
  return timer;
}

function stopWhopRunner() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startWhopRunner, stopWhopRunner, runTick, checkGuild, postLesson };
