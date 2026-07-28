'use strict';

const { readJson, writeJson } = require('./jsonStorage');
const { createEmbed } = require('./embedBuilder');
const { getWeekEvents, filterEvents } = require('./economicCalendar');

const TICK_INTERVAL_MS   = 5_000;   // tight enough to hit the release post within a few seconds of the exact minute
const REMINDER_OFFSETS   = [15, 10, 5]; // minutes before release
const STALE_MS           = 5 * 60 * 1000;      // reminders/releases more than this late are skipped, not fired stale
const WEEKLY_STALE_MS    = 6 * 60 * 60 * 1000; // weekly summary can catch up up to 6h late (a restart shouldn't eat it)
const FIRED_KEY_TTL_MS   = 9 * 24 * 60 * 60 * 1000; // prune fired-keys older than ~9 days (past any event they could reference)

const IMPACT_COLOR = { High: 0xEF4444, Medium: 0xF59E0B, Low: 0x95A5A6, Holiday: 0x8B5CF6 };
const IMPACT_ICON  = { High: '🔴', Medium: '🟠', Low: '⚪', Holiday: '🎌' };

function fmtEvent(e) {
  const ts = Math.floor(e.timestamp / 1000);
  const parts = [`${IMPACT_ICON[e.impact] || '⚪'} **${e.currency}** — ${e.title}`, `<t:${ts}:t> (<t:${ts}:R>)`];
  if (e.forecast) parts.push(`Forecast: \`${e.forecast}\``);
  if (e.previous) parts.push(`Previous: \`${e.previous}\``);
  return parts.join('\n');
}

function buildReminderEmbed(e, offset, guild) {
  return createEmbed('warning', {
    color: IMPACT_COLOR[e.impact] || 0x95A5A6,
    title: `⏰ Releasing in ${offset} Minutes`,
    description: fmtEvent(e),
    footer: `${guild.name} • Economic Calendar`,
  }).setTimestamp(null);
}

function buildReleaseEmbed(e, guild) {
  return createEmbed('info', {
    color: IMPACT_COLOR[e.impact] || 0x95A5A6,
    title: '📊 Releasing Now',
    description: fmtEvent(e),
    footer: `${guild.name} • Economic Calendar`,
  }).setTimestamp(null);
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Splits into multiple embeds (grouped by day) so a full week of events never
// overflows a single embed's 4096-char description limit. `title`/`emptyText`
// let callers reuse this for a single-day ("Today"/"Tomorrow") summary too.
function buildWeeklySummaryEmbeds(events, guild, title = '📅 This Week\'s Economic Calendar', emptyText = 'No matching events this week.') {
  if (events.length === 0) {
    return [createEmbed('info', { title, description: emptyText, footer: `${guild.name} • Economic Calendar` })];
  }

  const byDay = new Map();
  for (const e of events) {
    const key = e.date.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }

  const embeds = [];
  let current = null;
  for (const [dayKey, dayEvents] of byDay) {
    const dayName = WEEKDAY_NAMES[new Date(dayEvents[0].timestamp).getUTCDay()];
    const header = `**${dayName}, ${dayKey}**`;
    const lines = dayEvents.map(fmtEvent);
    const block = `${header}\n${lines.join('\n\n')}`;

    if (!current || (current.data.description.length + block.length + 2) > 3800) {
      current = createEmbed('info', {
        title: embeds.length === 0 ? title : `${title} (cont.)`,
        description: block,
        footer: `${guild.name} • Economic Calendar`,
      });
      embeds.push(current);
    } else {
      current.setDescription(`${current.data.description}\n\n${block}`);
    }
  }
  return embeds.slice(0, 10); // Discord's per-message embed cap
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

        const embed = buildReminderEmbed(e, offset, guild);
        const content = settings.roleId ? `<@&${settings.roleId}>` : undefined;
        await channel.send({ content, embeds: [embed], allowedMentions: settings.roleId ? { roles: [settings.roleId] } : { parse: [] } }).catch(() => {});
      }

      const releaseKey = `${e.id}#release`;
      if (now >= e.timestamp && !firedSet.has(releaseKey)) {
        firedSet.add(releaseKey);
        guildChanged = true;
        if (now - e.timestamp <= STALE_MS) {
          const embed = buildReleaseEmbed(e, guild);
          await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
        }
      }
    }

    // Weekly summary auto-post
    const wp = settings.weeklyPost;
    if (wp?.enabled) {
      const slot = currentWeekSlot(wp.weekday, wp.hour, wp.minute, wp.offsetMinutes || 0, now);
      if (now >= slot && (!settings.lastWeeklyPostAt || settings.lastWeeklyPostAt < slot) && (now - slot) <= WEEKLY_STALE_MS) {
        const embeds = buildWeeklySummaryEmbeds(filtered, guild);
        await channel.send({ embeds }).catch(() => {});
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
