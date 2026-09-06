'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const whop = require('./whopFeed');
const messageStyle = require('./messageStyle');

const TICK_MS = 60_000;
const GAP_MS = 2_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildLessonEmbed(guildId, lesson) {
  const style = messageStyle.styleFor(guildId, 'whop.lesson');
  const embed = messageStyle.build(guildId, 'whop.lesson', {
    at: lesson.createdAt ? new Date(lesson.createdAt) : null,
    tokens: {
      title: lesson.title || 'new lesson',
      course: lesson.courseTitle || '',
      type: lesson.lessonType || 'video',
      url: '',
      server: '',
      user: '',
    },
  });
  if (!embed) return null;

  if (lesson.courseCover) {
    try {
      if (style && !style.thumbnail) embed.setImage(lesson.courseCover);
      else embed.setThumbnail(lesson.courseCover);
    } catch { /* */ }
  }
  return embed;
}

function buildButtonRow(settings, lesson) {
  const url = lesson.lessonUrl
    || (settings.companyRoute ? `https://whop.com/${encodeURIComponent(settings.companyRoute)}` : null);
  if (!url || !/^https?:\/\//i.test(url)) return null;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setLabel((settings.buttonLabel || 'open course').slice(0, 80)),
  );
}

async function postLesson(guild, settings, lesson) {
  const channel = guild.channels.cache.get(lesson.channelId);
  if (!channel || !channel.isTextBased?.()) return false;

  const embed = buildLessonEmbed(guild.id, lesson);
  if (!embed) return false;

  const roleId = lesson.mentionRoleId || null;
  await channel.send({
    content: roleId ? `<@&${roleId}>` : undefined,
    embeds: [embed],
    components: (() => {
      const row = buildButtonRow(settings, lesson);
      return row ? [row] : [];
    })(),
    allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
  });
  return true;
}

async function checkGuild(client, guildId) {
  const settings = whop.getSettings(guildId);
  if (!settings.enabled || !settings.apiKey || !settings.log.length) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

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

  whop.setSettings(guildId, { lastError: null });
}

async function runTick(client) {
  const stored = require('./jsonStorage').readJson(whop.FILE, {});
  for (const guildId of Object.keys(stored)) {
    if (!whop.getSettings(guildId).enabled) continue;
    if (!client.guilds.cache.has(guildId)) continue;
    await checkGuild(client, guildId);
    await sleep(GAP_MS);
  }
}

let timer = null;

function startWhopRunner(client) {
  const tick = () => runTick(client).catch(err => console.error('[WHOP RUNNER]', err));
  setTimeout(tick, 8_000);
  timer = setInterval(tick, TICK_MS);
  return timer;
}

function stopWhopRunner() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startWhopRunner, stopWhopRunner, runTick, checkGuild, postLesson };
