'use strict';

const { AttachmentBuilder } = require('discord.js');
const { readJson, writeJson } = require('./jsonStorage');
const { createEmbed } = require('./embedBuilder');
const { getWeekEvents, filterEvents } = require('./economicCalendar');
const { generateEconEventCard } = require('./econEventVisual');

const TICK_INTERVAL_MS   = 5_000;   // tight enough to hit the release post within a few seconds of the exact minute
const REMINDER_OFFSETS   = [15, 10, 5]; // minutes before release
const STALE_MS           = 5 * 60 * 1000;      // reminders/releases more than this late are skipped, not fired stale
const WEEKLY_STALE_MS    = 6 * 60 * 60 * 1000; // weekly summary can catch up up to 6h late (a restart shouldn't eat it)
const FIRED_KEY_TTL_MS   = 9 * 24 * 60 * 60 * 1000; // prune fired-keys older than ~9 days (past any event they could reference)

const IMPACT_COLOR = { High: 0xEF4444, Medium: 0xF59E0B, Low: 0x95A5A6, Holiday: 0x8B5CF6 };

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtEventTime(e) {
  const day = WEEKDAY_NAMES[e.date.getUTCDay()].slice(0, 3).toUpperCase();
  const hh  = String(e.date.getUTCHours()).padStart(2, '0');
  const mm  = String(e.date.getUTCMinutes()).padStart(2, '0');
  return `${day} ${hh}:${mm} UTC`;
}

// One generated visual card per event — same house style as /risk — so a
// release reads at a glance without anyone having to open the image.
function buildEventCard(e, timeLabel) {
  const safeId    = (e.id || 'evt').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  const imageName = `econ_${safeId}_${Date.now()}_${Math.floor(Math.random() * 1e4)}.png`;
  const buf = generateEconEventCard({
    title: e.title, currency: e.currency, impact: e.impact,
    forecast: e.forecast, previous: e.previous, timeLabel,
  });
  return new AttachmentBuilder(buf, { name: imageName });
}

function buildReminderEmbed(e, offset, guild) {
  const attachment = buildEventCard(e, `IN ${offset} MIN`);
  const ts = Math.floor(e.timestamp / 1000);
  const embed = createEmbed('warning', {
    color: IMPACT_COLOR[e.impact] || 0x95A5A6,
    title: `⏰ Releasing in ${offset} Minutes`,
    description: `<t:${ts}:t> (<t:${ts}:R>)`,
    footer: `${guild.name} • Economic Calendar`,
    image: `attachment://${attachment.name}`,
  }).setTimestamp(null);
  return { embed, files: [attachment] };
}

function buildReleaseEmbed(e, guild) {
  const attachment = buildEventCard(e, 'RELEASING NOW');
  const ts = Math.floor(e.timestamp / 1000);
  const embed = createEmbed('info', {
    color: IMPACT_COLOR[e.impact] || 0x95A5A6,
    title: '📊 Releasing Now',
    description: `<t:${ts}:t>`,
    footer: `${guild.name} • Economic Calendar`,
    image: `attachment://${attachment.name}`,
  }).setTimestamp(null);
  return { embed, files: [attachment] };
}

const CARD_BATCH_SIZE     = 5;  // per-message event-card cap — comfortably under Discord's 10-embed/10-file limits
const MAX_EVENTS_RENDERED = 30; // hard safety cap so a huge, unfiltered week can't spam dozens of messages

// One visual card per event (no click-to-open needed), batched into
// Discord-message-sized groups — `title`/`emptyText` let callers reuse this
// for a single-day ("Today"/"Tomorrow") summary too. Returns an array of
// ready-to-send message payloads ({ embeds, files }); a full week's worth
// of events becomes a short run of messages instead of one dense wall of
// per-day text.
function buildWeeklySummaryEmbeds(events, guild, title = '📅 This Week\'s Economic Calendar', emptyText = 'No matching events this week.') {
  const headerEmbed = createEmbed('info', { title, footer: `${guild.name} • Economic Calendar` });

  if (events.length === 0) {
    headerEmbed.setDescription(emptyText);
    return [{ embeds: [headerEmbed], files: [] }];
  }

  const capped  = events.slice(0, MAX_EVENTS_RENDERED);
  const batches = [];
  for (let i = 0; i < capped.length; i += CARD_BATCH_SIZE) {
    const slice = capped.slice(i, i + CARD_BATCH_SIZE);
    const files = slice.map(e => buildEventCard(e, fmtEventTime(e)));
    const embeds = slice.map((e, idx) => {
      const embed = createEmbed('info', { image: `attachment://${files[idx].name}` });
      embed.setTimestamp(null);
      return embed;
    });
    if (i === 0) embeds.unshift(headerEmbed);
    batches.push({ embeds, files });
  }

  if (events.length > MAX_EVENTS_RENDERED) {
    const noteEmbed = createEmbed('info', {
      description: `➕ **${events.length - MAX_EVENTS_RENDERED}** more matching events not shown — narrow the impact/currency filters to see them all.`,
    });
    batches[batches.length - 1].embeds.push(noteEmbed);
  }

  return batches;
}

function currentWeekSlot(weekday, hour, minute, offsetMinutes, now) {
  const shifted = now + offsetMinutes * 60000;
  const d = new Date(shifted);
  const diff = weekday - d.getUTCDay();
  const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff, hour, minute, 0, 0);
  return base - offsetMinutes * 60000;
}

async function runTick(client) {
  const config = readJson('config.json', {});
  const now = Date.now();
  let events = null; // lazy-loaded, shared across guilds this tick
  let changed = false;

  for (const guildId of Object.keys(config)) {
    const settings = config[guildId]?.econCalSettings;
    if (!settings?.enabled || !settings.channelId) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(settings.channelId);
    if (!channel || !channel.isTextBased()) continue;

    if (events === null) {
      try {
        events = await getWeekEvents();
      } catch (err) {
        console.error('[ECONCAL RUNNER] Failed to load calendar:', err.message);
        events = [];
      }
    }

    const filtered = filterEvents(events, { impactFilter: settings.impactFilter, currencyFilter: settings.currencyFilter });
    const firedSet = new Set(settings.firedKeys);
    let guildChanged = false;

    for (const e of filtered) {
      for (const offset of REMINDER_OFFSETS) {
        const target = e.timestamp - offset * 60000;
        const key = `${e.id}#r${offset}`;
        if (now < target || firedSet.has(key)) continue;
        firedSet.add(key);
        guildChanged = true;
        if (now - target > STALE_MS) continue; // too late to be useful — mark fired, don't send

        const { embed, files } = buildReminderEmbed(e, offset, guild);
        const content = settings.roleId ? `<@&${settings.roleId}>` : undefined;
        await channel.send({ content, embeds: [embed], files, allowedMentions: settings.roleId ? { roles: [settings.roleId] } : { parse: [] } }).catch(() => {});
      }

      const releaseKey = `${e.id}#release`;
      if (now >= e.timestamp && !firedSet.has(releaseKey)) {
        firedSet.add(releaseKey);
        guildChanged = true;
        if (now - e.timestamp <= STALE_MS) {
          const { embed, files } = buildReleaseEmbed(e, guild);
          await channel.send({ embeds: [embed], files, allowedMentions: { parse: [] } }).catch(() => {});
        }
      }
    }

    // Weekly summary auto-post
    const wp = settings.weeklyPost;
    if (wp?.enabled) {
      const slot = currentWeekSlot(wp.weekday, wp.hour, wp.minute, wp.offsetMinutes || 0, now);
      if (now >= slot && (!settings.lastWeeklyPostAt || settings.lastWeeklyPostAt < slot) && (now - slot) <= WEEKLY_STALE_MS) {
        const batches = buildWeeklySummaryEmbeds(filtered, guild);
        for (const batch of batches) {
          await channel.send(batch).catch(() => {});
        }
        settings.lastWeeklyPostAt = slot;
        guildChanged = true;
      }
    }

    if (guildChanged) {
      // Prune fired-keys tied to events well outside this week's window —
      // keeps the array from growing forever across weekly cache rotations.
      const prunedKeys = [...firedSet].filter(k => {
        const [id] = k.split('#');
        const ev = events.find(e2 => e2.id === id);
        return !ev || (now - ev.timestamp) < FIRED_KEY_TTL_MS;
      });
      settings.firedKeys = prunedKeys;
      changed = true;
    }
  }

  if (changed) writeJson('config.json', config);
}

function startEconCalRunner(client) {
  const tick = () => runTick(client).catch(err => console.error('[ECONCAL RUNNER ERROR]', err));
  tick();
  setInterval(tick, TICK_INTERVAL_MS);
}

module.exports = { startEconCalRunner, buildWeeklySummaryEmbeds, currentWeekSlot };
