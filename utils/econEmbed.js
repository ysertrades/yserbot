'use strict';

// The server's brand name (Settings → Brand), QuantLab by default.
const B = () => { try { return require('./brand').current().name || 'QuantLab'; } catch { return 'QuantLab'; } };

/**
 * Economic-calendar embeds as a compact grid (Discord inline fields).
 * Max 3 events per horizontal row. One forecast/previous code box per event.
 */

const { EmbedBuilder } = require('discord.js');
const messageStyle = require('./messageStyle');

const FLAG = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CAD: '🇨🇦',
  AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭', CNY: '🇨🇳',
};

const IMPACT_DOT = {
  High: '🔴', Medium: '🟠', Low: '🟡', Holiday: '⚪',
};

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MAX_INLINE = 3;
const MAX_FIELDS = 24;

function impactColor(guildId, impact) {
  try {
    const palette = messageStyle.paletteFor(guildId, 'econ.impact');
    const hex = palette?.[impact];
    if (hex && /^#?[0-9a-fA-F]{6}$/.test(String(hex))) {
      return parseInt(String(hex).replace('#', ''), 16);
    }
  } catch { /* */ }
  const map = { High: 0xC45C5C, Medium: 0xC4A35C, Low: 0x8A90A0, Holiday: 0x6B7280 };
  return map[impact] || 0x9397EE;
}

function toDisplay(timestampMs) {
  return new Date(timestampMs - 4 * 60 * 60000);
}

function formatWhen(timestampMs) {
  const d = toDisplay(timestampMs);
  return {
    dateLine: `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`,
    timeLine: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} (UTC-04:00)`,
    dayName: WEEKDAY[d.getUTCDay()],
    mon: MONTH[d.getUTCMonth()],
    date: d.getUTCDate(),
  };
}

function codeBox(lines) {
  const body = lines.filter(Boolean).join('\n').replace(/```/g, "'''");
  return '```\n' + body + '\n```';
}

function eventField(e) {
  const flag = FLAG[e.currency] || '🏳️';
  const when = formatWhen(e.timestamp);
  const impact = IMPACT_DOT[e.impact] || '•';
  const title = `${e.currency} — ${e.title}`;
  const name = `${flag} ${title}`.slice(0, 256);

  const forecast = e.forecast != null && String(e.forecast).trim() !== '' ? String(e.forecast).trim() : null;
  const previous = e.previous != null && String(e.previous).trim() !== '' ? String(e.previous).trim() : null;
  const boxLines = [
    forecast != null ? `Forecast: ${forecast}` : null,
    previous != null ? `Previous: ${previous}` : null,
  ].filter(Boolean);

  const parts = [
    `📅 ${when.dayName}, ${when.dateLine}`,
    `🕐 ${when.timeLine}`,
    `${impact} **${String(e.impact || 'Low').toUpperCase()}**`,
  ];
  if (boxLines.length) parts.push(codeBox(boxLines));

  return {
    name,
    value: parts.join('\n').slice(0, 1024),
    inline: true,
  };
}

function topImpact(events) {
  if (events.some(e => e.impact === 'High')) return 'High';
  if (events.some(e => e.impact === 'Medium')) return 'Medium';
  return events[0]?.impact || 'Low';
}

function padFieldsToRow(fields) {
  const out = fields.slice();
  const rem = out.length % MAX_INLINE;
  if (rem === 0) return out;
  for (let i = rem; i < MAX_INLINE; i++) {
    out.push({ name: '\u200b', value: '\u200b', inline: true });
  }
  return out;
}

function titleFor(mode, events, extra = {}) {
  if (mode === 'week') return 'High Impact news This week';
  if (mode === 'release') {
    return events.length > 1 ? `🔴 Released now · ${events.length} prints` : '🔴 Released now';
  }
  if (mode === 'reminder') {
    const m = extra.minutes != null ? extra.minutes : '?';
    return events.length > 1
      ? `⏰ In ${m}m · ${events.length} releases`
      : `⏰ In ${m}m`;
  }
  if (extra.dayLabel) return `📌 ${extra.dayLabel}`;
  if (events[0]) {
    const w = formatWhen(events[0].timestamp);
    return `📌 High impact · ${w.dayName}, ${w.mon} ${w.date}`;
  }
  return '📌 High impact';
}

function buildGridEmbeds(guildId, events, { mode = 'day', minutes = null, dayLabel = null } = {}) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  if (!list.length) return [];

  const chunks = [];
  for (let i = 0; i < list.length; i += MAX_FIELDS) {
    chunks.push(list.slice(i, i + MAX_FIELDS));
  }

  return chunks.map((chunk, idx) => {
    const fields = padFieldsToRow(chunk.map(eventField));
    const embed = new EmbedBuilder()
      .setColor(impactColor(guildId, topImpact(chunk)))
      .setTitle(idx === 0 ? titleFor(mode, chunk, { minutes, dayLabel }) : `${titleFor(mode, chunk, { minutes, dayLabel })} · cont.`)
      .addFields(fields);

    if (mode === 'week' && idx === chunks.length - 1) {
      embed.setFooter({ text: (B().toLowerCase() + ' · economic calendar') });
    }
    return embed;
  });
}

function buildSingleEventEmbed(guildId, e, opts = {}) {
  const embeds = buildGridEmbeds(guildId, [e], {
    mode: opts.mode || 'day',
    minutes: opts.minutes,
  });
  const embed = embeds[0];
  if (!embed) return null;
  if (opts.title) embed.setTitle(String(opts.title));
  if (opts.footer) embed.setFooter({ text: String(opts.footer) });
  return embed;
}

function dayKeyOfTs(timestampMs) {
  const d = toDisplay(timestampMs);
  return d.toISOString().slice(0, 10);
}
function eventTextBlock(e) {
  const flag = FLAG[e.currency] || '🏳️';
  const when = formatWhen(e.timestamp);
  const impact = IMPACT_DOT[e.impact] || '•';
  const title = `${flag} **${e.currency} — ${e.title}**`.slice(0, 200);
  const forecast = e.forecast != null && String(e.forecast).trim() !== '' ? String(e.forecast).trim() : null;
  const previous = e.previous != null && String(e.previous).trim() !== '' ? String(e.previous).trim() : null;
  const boxLines = [
    forecast != null ? `Forecast: ${forecast}` : null,
    previous != null ? `Previous: ${previous}` : null,
  ].filter(Boolean);
  const meta = `🕐 ${when.timeLine} · ${impact} **${String(e.impact || 'Low').toUpperCase()}**`;
  const parts = [title, meta];
  if (boxLines.length) parts.push(codeBox(boxLines));
  return parts.join('\n').slice(0, 3800);
}
function dayLabelLine(timestampMs) {
  const d = toDisplay(timestampMs);
  return `-# · ${WEEKDAY[d.getUTCDay()]} · ${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function buildWeeklyV2Payloads(guildId, events, { scope = 'week' } = {}) {
  const { IS_COMPONENTS_V2, text, separator, container, ACCENT_DEFAULT } = require('./componentsV2');
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  const accent = impactColor(guildId, list.length ? topImpact(list) : 'High') || ACCENT_DEFAULT;
  if (!list.length) {
    const words = scope === 'today' ? 'today' : scope === 'tomorrow' ? 'tomorrow' : 'this week';
    return [{
      flags: IS_COMPONENTS_V2,
      components: [container([
        text('-# ' + B().toLowerCase() + ' · economic calendar'),
        separator({ divider: true, spacing: 1 }),
        text(`No matching releases for ${words}.`),
      ], accent)],
      embeds: [],
    }];
  }

  // Chronological by day (first day of the week first)
  const byDay = new Map();
  const sorted = [...list].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const e of sorted) {
    const k = dayKeyOfTs(e.timestamp);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }

  const scopeTitle =
    scope === 'today' ? "Today's releases" :
    scope === 'tomorrow' ? "Tomorrow's releases" :
    'This week';

  const ROW = 3; // events per visual row, then a V2 divider line
  const payloads = [];
  let kids = [];
  let firstInMsg = true;

  const flush = () => {
    if (!kids.length) return;
    payloads.push({ flags: IS_COMPONENTS_V2, components: [container(kids, accent)], embeds: [] });
    kids = [];
    firstInMsg = true;
  };
  const pushHeader = () => {
    if (!firstInMsg) return;
    kids.push(text(`-# ${B().toLowerCase()} · ${scopeTitle} · ${list.length}`));
    kids.push(separator({ divider: true, spacing: 1 }));
    firstInMsg = false;
  };
  const ensureRoom = (need, contLabel) => {
    if (kids.length + need <= 38) return;
    flush();
    pushHeader();
    if (contLabel) {
      kids.push(text(contLabel + ' · cont.'));
      kids.push(separator({ divider: false, spacing: 1 }));
    }
  };

  let dayIndex = 0;
  for (const [, dayEvents] of byDay) {
    pushHeader();
    // Divider between days
    if (dayIndex > 0) {
      ensureRoom(2, null);
      kids.push(separator({ divider: true, spacing: 1 }));
    }
    ensureRoom(2, null);
    kids.push(text(dayLabelLine(dayEvents[0].timestamp)));
    kids.push(separator({ divider: false, spacing: 1 }));

    // Walk events in rows of 3; after each full row add a V2 separator line
    for (let i = 0; i < dayEvents.length; i++) {
      ensureRoom(2, dayLabelLine(dayEvents[i].timestamp));
      kids.push(text(eventTextBlock(dayEvents[i])));
      const endOfRow = ((i + 1) % ROW === 0);
      const lastInDay = (i === dayEvents.length - 1);
      if (endOfRow && !lastInDay) {
        // Visible divider line between rows of 3
        ensureRoom(1, dayLabelLine(dayEvents[i].timestamp));
        kids.push(separator({ divider: true, spacing: 1 }));
      } else if (!lastInDay) {
        // Soft spacing within a row (no hard line)
        ensureRoom(1, dayLabelLine(dayEvents[i].timestamp));
        kids.push(separator({ divider: false, spacing: 1 }));
      }
    }
    dayIndex += 1;
  }
  flush();
  return payloads;
}
function buildAlertV2Payload(guildId, e, mode, { minutes = null } = {}) {
  const { IS_COMPONENTS_V2, text, separator, container } = require('./componentsV2');
  const flag = FLAG[e.currency] || '🏳️';
  const when = formatWhen(e.timestamp);
  const impact = IMPACT_DOT[e.impact] || '•';
  const accent = impactColor(guildId, e.impact);
  const heading = mode === 'release'
    ? '🔴 **Released now**'
    : `⏰ **In ${minutes != null ? minutes : '?'}m**`;
  const title = `${flag} **${e.currency} — ${e.title}**`.slice(0, 200);
  const meta = `🕐 ${when.timeLine} · ${impact} **${String(e.impact || 'Low').toUpperCase()}**`;
  const forecast = e.forecast != null && String(e.forecast).trim() !== '' ? String(e.forecast).trim() : null;
  const previous = e.previous != null && String(e.previous).trim() !== '' ? String(e.previous).trim() : null;
  const boxLines = [
    forecast != null ? `Forecast: ${forecast}` : null,
    previous != null ? `Previous: ${previous}` : null,
  ].filter(Boolean);
  const kids = [
    text(heading),
    separator({ divider: true, spacing: 1 }),
    text(title),
    text(meta),
  ];
  if (boxLines.length) kids.push(text(codeBox(boxLines)));
  kids.push(separator({ divider: true, spacing: 1 }));
  kids.push(text('-# ' + B().toLowerCase() + ' · economic calendar'));
  return { flags: IS_COMPONENTS_V2, components: [container(kids, accent)], embeds: [] };
}

module.exports = {
  impactColor,
  eventField,
  buildGridEmbeds,
  buildSingleEventEmbed,
  buildWeeklyV2Payloads,
  buildAlertV2Payload,
  titleFor,
  FLAG,
  IMPACT_DOT,
  MAX_INLINE,
};
