'use strict';

const { AttachmentBuilder } = require('discord.js');
const { readJson, writeJson } = require('./jsonStorage');
const { createEmbed } = require('./embedBuilder');
const messageStyle = require('./messageStyle');
const { getWeekEvents, filterEvents } = require('./economicCalendar');
const { generateEconEventCard } = require('./econEventVisual');
const { isFeatureEnabled } = require('./featureToggles');

const TICK_INTERVAL_MS   = 5_000;   // tight enough to hit the release post within a few seconds of the exact minute
const REMINDER_OFFSETS   = [15]; // minutes before release
const STALE_MS           = 5 * 60 * 1000;      // reminders/releases more than this late are skipped, not fired stale
const WEEKLY_STALE_MS    = 6 * 60 * 60 * 1000; // weekly summary can catch up up to 6h late (a restart shouldn't eat it)
const FIRED_KEY_TTL_MS   = 9 * 24 * 60 * 60 * 1000; // prune fired-keys older than ~9 days (past any event they could reference)

/**
 * The colour a reminder and its release are drawn in, by impact.
 *
 * Editable per guild from Appearance ("Impact colours"), falling back to the
 * shipped values — which are exactly the constants this used to hold.
 */
function impactColor(guildId, impact) {
  const palette = messageStyle.paletteFor(guildId, 'econ.impact');
  return palette[impact] || palette.Low || '#8A90A0';
}

/** What the heading and the empty line call the span being posted. */
const SCOPE_WORDS = {
  today:    { scope: "Today's",     when: 'today' },
  tomorrow: { scope: "Tomorrow's",  when: 'tomorrow' },
  week:     { scope: "This Week's", when: 'this week' },
};

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES   = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The event card's time chip and day dividers display in this offset by
// default (no label shown — it's presented as the assumed house timezone,
// not literal UTC) rather than raw UTC, since UTC read confusingly early
// for the audience this is built for.
const DISPLAY_OFFSET_MIN = -4 * 60; // UTC-4

function toDisplayDate(timestampMs) {
  return new Date(timestampMs + DISPLAY_OFFSET_MIN * 60000);
}

function dayKeyOf(e) {
  return toDisplayDate(e.timestamp).toISOString().slice(0, 10);
}

// A light section divider between days in a multi-day (week) view — the
// per-event card already shows its own day/time chip, so this exists purely
// to make a full week scroll like an organized calendar instead of a flat
// stream of cards.
function buildDayHeaderEmbed(e, guild) {
  const d = toDisplayDate(e.timestamp);
  const label = `${WEEKDAY_NAMES[d.getUTCDay()]}, ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
  // Null when the guild has turned dividers off — the caller then runs the
  // days together rather than inserting a blank embed between them.
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

// One generated visual card per event — QuantLab's light "Phantom" card
// style — so a release reads at a glance without anyone having to open
// the image.
function buildEventCard(e, timeLabel) {
  const safeId    = (e.id || 'evt').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  const imageName = `econ_${safeId}_${Date.now()}_${Math.floor(Math.random() * 1e4)}.png`;
  const buf = generateEconEventCard({
    title: e.title, currency: e.currency, impact: e.impact,
    forecast: e.forecast, previous: e.previous, timeLabel,
  });
  return new AttachmentBuilder(buf, { name: imageName });
}

/** Tokens shared by the reminder and the release. */
function eventTokens(e, guild) {
  const ts = Math.floor(e.timestamp / 1000);
  return {
    server: guild.name,
    event: e.title, currency: e.currency, impact: e.impact,
    // Discord's own timestamp markup, so the countdown stays live in the
    // posted message rather than freezing at whatever it said when sent.
    time: `<t:${ts}:t>`, relative: `<t:${ts}:R>`,
    forecast: e.forecast || '', previous: e.previous || '',
  };
}

/**
 * Builds one card, or null when that kind is switched off.
 *
 * The embed is built before the picture, deliberately: drawing an event card
 * is 60-210 ms of blocked thread, and a guild that has turned reminders off
 * should not pay for one it is never going to send.
 */
function buildEventEmbed(key, e, guild, tokens, timeLabel) {
  const embed = messageStyle.build(guild.id, key, {
    color: impactColor(guild.id, e.impact),
    tokens,
  });
  if (!embed) return null;
  const attachment = buildEventCard(e, timeLabel);
  try { embed.setImage(`attachment://${attachment.name}`); } catch { /* card still sends without it */ }
  return { embed, files: [attachment] };
}

function buildReminderEmbed(e, offset, guild) {
  return buildEventEmbed('econ.reminder', e, guild,
    { ...eventTokens(e, guild), minutes: offset }, `IN ${offset} MIN`);
}

function buildReleaseEmbed(e, guild) {
  return buildEventEmbed('econ.release', e, guild, eventTokens(e, guild), 'RELEASING NOW');
}

const MAX_EMBEDS_PER_MSG  = 9;  // Discord's real cap is 10 — leave headroom for a day-divider embed
const MAX_EVENTS_RENDERED = 30; // hard safety cap so a huge, unfiltered week can't spam dozens of messages

// One visual card per event (no click-to-open needed), batched into
// Discord-message-sized groups — `title`/`emptyText` let callers reuse this
// for a single-day ("Today"/"Tomorrow") summary too. When the event list
// spans more than one calendar day (the "This Week" / scheduled weekly
// post), a day-divider embed is inserted at each day boundary so the whole
// week reads like an organized calendar instead of a flat stream of cards
// — single-day views skip it since every card already shares the same day.
// Returns an array of ready-to-send message payloads ({ embeds, files }).
function buildWeeklySummaryEmbeds(events, guild, scope = 'week') {
  const words = SCOPE_WORDS[scope] || SCOPE_WORDS.week;
  const tokens = { server: guild.name, ...words, count: events.length };

  // A calendar with nothing in it is its own card, rather than the heading
  // with a sentence bolted underneath — the two say different things and a
  // server should be able to word them differently.
  if (events.length === 0) {
    const empty = messageStyle.build(guild.id, 'econ.empty', { tokens });
    return empty ? [{ embeds: [empty], files: [] }] : [];
  }

  const headerEmbed = messageStyle.build(guild.id, 'econ.summary', { tokens });

  // The event cards take the heading's colour, so recolouring the summary
  // recolours the whole run rather than leaving the cards on a stock blue.
  const cardColor = messageStyle.styleFor(guild.id, 'econ.summary').color;

  const capped  = events.slice(0, MAX_EVENTS_RENDERED);
  // Checked once rather than per event: with dividers switched off there is
  // no day boundary to leave room for, so the batches stay full-sized.
  const dividersOn = messageStyle.isOn(guild.id, 'econ.day');
  const multiDay = dividersOn && new Set(capped.map(dayKeyOf)).size > 1;

  const batches = [];
  let curEmbeds = headerEmbed ? [headerEmbed] : [];
  let curFiles  = [];
  let lastDayKey = null;

  function flush() {
    if (curEmbeds.length > 0) batches.push({ embeds: curEmbeds, files: curFiles });
    curEmbeds = [];
    curFiles  = [];
  }

  for (const e of capped) {
    const dayKey     = dayKeyOf(e);
    const dayChanged = multiDay && dayKey !== lastDayKey;
    const needed     = (dayChanged ? 1 : 0) + 1; // day header (maybe) + the event card itself

    if (curEmbeds.length + needed > MAX_EMBEDS_PER_MSG) flush();

    if (dayChanged) {
      const divider = buildDayHeaderEmbed(e, guild);
      if (divider) curEmbeds.push(divider);
      lastDayKey = dayKey;
    }

    const attachment = buildEventCard(e, fmtEventTime(e));
    curFiles.push(attachment);
    const embed = createEmbed('info', { color: cardColor, image: `attachment://${attachment.name}` });
    embed.setTimestamp(null);
    curEmbeds.push(embed);
  }
  flush();

  if (events.length > MAX_EVENTS_RENDERED) {
    const noteEmbed = createEmbed('info', {
      description: `➕ **${events.length - MAX_EVENTS_RENDERED}** more matching events not shown — narrow the impact/currency filters to see them all.`,
    });
    if (batches.length === 0) batches.push({ embeds: [noteEmbed], files: [] });
    else batches[batches.length - 1].embeds.push(noteEmbed);
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
    // The Settings-tab master switch — off means the scheduler stays quiet
    // here too, not just the /econcal command.
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
        if (now - target > STALE_MS) continue; // too late to be useful — mark fired, don't send

        // Null when reminders are switched off in Appearance. Still marked
        // fired above, so switching them back on mid-week announces the
        // releases still to come rather than the ones already gone.
        const built = buildReminderEmbed(e, offset, guild);
        if (!built) continue;
        const { embed, files } = built;
        const content = settings.roleId ? `<@&${settings.roleId}>` : undefined;
        await channel.send({ content, embeds: [embed], files, allowedMentions: settings.roleId ? { roles: [settings.roleId] } : { parse: [] } }).catch(() => {});
      }

      const releaseKey = `${e.id}#release`;
      if (now >= e.timestamp && !firedSet.has(releaseKey)) {
        firedSet.add(releaseKey);
        guildChanged = true;
        if (now - e.timestamp <= STALE_MS) {
          const built = buildReleaseEmbed(e, guild);
          if (built) {
            await channel.send({ embeds: [built.embed], files: built.files, allowedMentions: { parse: [] } }).catch(() => {});
          }
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
