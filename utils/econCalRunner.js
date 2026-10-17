'use strict';

const { AttachmentBuilder } = require('discord.js');
const { readJson, writeJson } = require('./jsonStorage');
const { createEmbed } = require('./embedBuilder');
const messageStyle = require('./messageStyle');
const { getWeekEvents, filterEvents } = require('./economicCalendar');
const { generateEconEventCard } = require('./econEventVisual');
const econEmbed = require('./econEmbed');
const { isFeatureEnabled } = require('./featureToggles');

const TICK_INTERVAL_MS   = 5_000;
const REMINDER_OFFSETS   = [15];
const STALE_MS           = 5 * 60 * 1000;
const WEEKLY_STALE_MS    = 6 * 60 * 60 * 1000;
const FIRED_KEY_TTL_MS   = 9 * 24 * 60 * 60 * 1000;

function impactColor(guildId, impact) {
  const palette = messageStyle.paletteFor(guildId, 'econ.impact');
  return palette[impact] || palette.Low || '#8A90A0';
}

const SCOPE_WORDS = {
  today:    { scope: "Today's",     when: 'today' },
  tomorrow: { scope: "Tomorrow's",  when: 'tomorrow' },
  week:     { scope: "This Week's", when: 'this week' },
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES   = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// New York time, daylight saving included. This was a fixed UTC-4, which is
// only New York in summer, so every time and day header was an hour out from
// November to March.
const DISPLAY_TZ = 'America/New_York';
const NY_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Minutes New York is ahead of UTC at this instant (-240 or -300). */
function displayOffsetMin(timestampMs) {
  const p = Object.fromEntries(NY_PARTS.formatToParts(new Date(timestampMs)).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(timestampMs / 1000) * 1000) / 60000);
}

// A Date whose UTC fields read as New York wall time — the callers use
// getUTC*() on it, as they did with the fixed offset.
function toDisplayDate(timestampMs) {
  return new Date(timestampMs + displayOffsetMin(timestampMs) * 60000);
}

function dayKeyOf(e) {
  return toDisplayDate(e.timestamp).toISOString().slice(0, 10);
}

function buildDayHeaderEmbed(e, guild) {
  const d = toDisplayDate(e.timestamp);
  const label = `${WEEKDAY_NAMES[d.getUTCDay()]}, ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return messageStyle.build(guild.id, 'econ.day', {
    tokens: { server: guild.name, day: label, date: String(d.getUTCDate()) },
  });
}

function fmtEventTime(e) {
  const d   = toDisplayDate(e.timestamp);
  const day = WEEKDAY_NAMES[d.getUTCDay()].slice(0, 3).toUpperCase();
  const hh  = String(d.getUTCHours()).padStart(2, '0');
  const mm  = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${hh}:${mm}`;
}

function buildEventCard(e, timeLabel) {
  const safeId    = (e.id || 'evt').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  const imageName = `econ_${safeId}_${Date.now()}_${Math.floor(Math.random() * 1e4)}.png`;
  const buf = generateEconEventCard({
    title: e.title, currency: e.currency, impact: e.impact,
    forecast: e.forecast, previous: e.previous, timeLabel,
  });
  return new AttachmentBuilder(buf, { name: imageName });
}

function eventTokens(e, guild) {
  const ts = Math.floor(e.timestamp / 1000);
  return {
    server: guild.name,
    event: e.title, currency: e.currency, impact: e.impact,
    time: `<t:${ts}:t>`, relative: `<t:${ts}:R>`,
    forecast: e.forecast || '', previous: e.previous || '',
  };
}

function buildEventEmbed(key, e, guild, tokens, timeLabel) {
  if (e.impact === 'High' || e.impact === 'Medium') {
    const mode = key === 'econ.reminder' ? 'reminder' : key === 'econ.release' ? 'release' : 'day';
    const embed = econEmbed.buildSingleEventEmbed(guild.id, e, {
      mode,
      minutes: tokens && tokens.minutes,
    });
    if (!embed) return null;
    return { embed, files: [] };
  }
  const embed = messageStyle.build(guild.id, key, {
    color: impactColor(guild.id, e.impact),
    tokens,
  });
  if (!embed) return null;
  const attachment = buildEventCard(e, timeLabel);
  try { embed.setImage(`attachment://${attachment.name}`); } catch { /* */ }
  return { embed, files: [attachment] };
}

function buildReminderEmbed(e, offset, guild) {
  return {
    v2: true,
    payload: econEmbed.buildAlertV2Payload(guild.id, e, 'reminder', { minutes: offset }),
  };
}

function buildReleaseEmbed(e, guild) {
  return {
    v2: true,
    payload: econEmbed.buildAlertV2Payload(guild.id, e, 'release'),
  };
}

const MAX_EMBEDS_PER_MSG  = 9;
const MAX_EVENTS_RENDERED = 30;

// Classic embed grid: 3 events per horizontal ROW (Discord inline fields),
// sorted earliest day first — matches the "This Week's Economic Calendar" layout.
function buildWeeklySummaryEmbeds(events, guild, scope = 'week') {
  const capped = (events || []).slice(0, MAX_EVENTS_RENDERED);
  const sorted = [...capped].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const mode = (scope === 'today' || scope === 'tomorrow') ? 'day' : 'week';
  const dayLabel =
    scope === 'today' ? 'Today' :
    scope === 'tomorrow' ? 'Tomorrow' :
    null;
  const embeds = econEmbed.buildGridEmbeds(guild.id, sorted, { mode, dayLabel });
  if (!embeds.length) {
    const { EmbedBuilder } = require('discord.js');
    const words = scope === 'today' ? 'today' : scope === 'tomorrow' ? 'tomorrow' : 'this week';
    return [{
      embeds: [new EmbedBuilder()
        .setColor(0x9397EE)
        .setTitle(scope === 'today' ? "Today's releases" : scope === 'tomorrow' ? "Tomorrow's releases" : 'High Impact news This week')
        .setDescription(`No matching releases for ${words}.`)
        .setFooter({ text: 'quantlab · economic calendar' })],
    }];
  }
  if ((events || []).length > MAX_EVENTS_RENDERED && embeds.length) {
    const extra = events.length - MAX_EVENTS_RENDERED;
    try {
      embeds[embeds.length - 1].setFooter({ text: `quantlab · economic calendar · +${extra} more not shown` });
    } catch { /* */ }
  }
  const payloads = [];
  for (let i = 0; i < embeds.length; i += MAX_EMBEDS_PER_MSG) {
    payloads.push({ embeds: embeds.slice(i, i + MAX_EMBEDS_PER_MSG) });
  }
  return payloads;
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
  let events = null;
  let changed = false;

  for (const guildId of Object.keys(config)) {
    const settings = config[guildId]?.econCalSettings;
    if (!settings?.enabled || !settings.channelId) continue;
    if (!isFeatureEnabled(guildId, 'econ_calendar')) continue;

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
        if (now - target > STALE_MS) continue;

        const built = buildReminderEmbed(e, offset, guild);
        if (!built) continue;
        const content = settings.roleId ? `<@&${settings.roleId}>` : undefined;
        const mentions = settings.roleId ? { roles: [settings.roleId] } : { parse: [] };
        if (built.v2 && built.payload) {
          await channel.send({ ...built.payload, content, allowedMentions: mentions }).catch(() => {});
        } else if (built.embed) {
          await channel.send({ content, embeds: [built.embed], files: built.files || [], allowedMentions: mentions }).catch(() => {});
        }
      }

      const releaseKey = `${e.id}#release`;
      if (now >= e.timestamp && !firedSet.has(releaseKey)) {
        firedSet.add(releaseKey);
        guildChanged = true;
        if (now - e.timestamp <= STALE_MS) {
          const built = buildReleaseEmbed(e, guild);
          if (built) {
            if (built.v2 && built.payload) {
              await channel.send({ ...built.payload, allowedMentions: { parse: [] } }).catch(() => {});
            } else if (built.embed) {
              await channel.send({ embeds: [built.embed], files: built.files || [], allowedMentions: { parse: [] } }).catch(() => {});
            }
          }
        }
      }
    }

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
