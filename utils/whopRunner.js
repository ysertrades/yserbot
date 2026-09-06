'use strict';

/**
 * whopRunner.js — poll + post new Whop lessons.
 * Embed image = course banner. Link button URL is auto from company/course.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const whop = require('./whopFeed');
const messageStyle = require('./messageStyle');

const TICK_MS = 60_000;
const GAP_MS = 2_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function targetFor(guild, settings) {
  if (!settings.channelId) return null;
  const channel = guild.channels.cache.get(settings.channelId);
  if (!channel || !channel.isTextBased?.()) return null;
  return { channel, roleId: settings.mentionRoleId || null };
}

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

  const banner = lesson.courseCover || null;
  if (banner) {
    try {
      if (style && !style.thumbnail) embed.setImage(banner);
      else embed.setThumbnail(banner);
    } catch { /* ignore */ }
  }
  return embed;
}

function buildButtonRow(settings, lesson) {
  const url = lesson.lessonUrl
    || (settings.companyRoute ? `https://whop.com/${encodeURIComponent(settings.companyRoute)}` : null);
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const btn = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setURL(url)
    .setLabel((settings.buttonLabel || 'open course').slice(0, 80));

  return new ActionRowBuilder().addComponents(btn);
}

async function postLesson(guild, settings, lesson) {
  const target = targetFor(guild, settings);
  if (!target) return false;

  const embed = buildLessonEmbed(guild.id, lesson);
  if (!embed) return false;

  const content = target.roleId ? `<@&${target.roleId}>` : undefined;
  const row = buildButtonRow(settings, lesson);

  await target.channel.send({
    content,
    embeds: [embed],
    components: row ? [row] : [],
    allowedMentions: target.roleId ? { roles: [target.roleId] } : { parse: [] },
  });
  return true;
}

async function checkGuild(client, guildId) {
  const settings = whop.getSettings(guildId);
  if (!settings.enabled || !settings.apiKey) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  let result;
  try {
    result = await whop.newLessons(guildId);
  } catch (err) {
    whop.setSettings(guildId, { lastError: err.message || String(err) });
    console.error(`[WHOP] ${guildId} check failed:`, err.message);
    return;
  }

  const { fresh, known } = result;
  if (!fresh.length) {
    whop.setSettings(guildId, { known, lastError: null });
    return;
  }

  for (const lesson of fresh) {
    try {
      await postLesson(guild, settings, lesson);
    } catch (err) {
      console.error(`[WHOP] post failed ${lesson.id}:`, err.message);
    }
    await sleep(GAP_MS);
  }

  const nextKnown = { ...known };
  for (const l of fresh) nextKnown[l.id] = true;
  whop.setSettings(guildId, { known: nextKnown, lastError: null });
}

async function runTick(client) {
  const stored = require('./jsonStorage').readJson(whop.FILE, {});
  for (const guildId of Object.keys(stored)) {
    const s = whop.getSettings(guildId);
    if (!s.enabled) continue;
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

module.exports = {
  startWhopRunner,
  stopWhopRunner,
  runTick,
  checkGuild,
  postLesson,
  buildLessonEmbed,
  buildButtonRow,
  targetFor,
};
