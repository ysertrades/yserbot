'use strict';

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

const MAX_INLINE = 3;       // Discord shows at most 3 inline fields per row
const MAX_FIELDS = 24;      // keep under 25; multiples of 3 look clean

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

/** One event → one inline field (name + value). */
function eventField(e) {
  const flag = FLAG[e.currency] || '🏳️';
  const when = formatWhen(e.timestamp);
  const impact = IMPACT_DOT[e.impact] || '•';
  const title = `${e.currency} — ${e.title}`;
  // Field names max 256
  const name = `${flag} ${title}`.slice(0, 256);

  const forecast = e.forecast != null && String(e.forecast).trim() !== '' ? String(e.forecast).trim() : null;
  const previous = e.previous != null && String(e.previous).trim() !== '' ? String(e.previous).trim() : null;
  const boxLines = [
    forecast != null ? `Forecast: ${forecast}` : null,
    previous != null ? `Previous: ${previous}` : null,
  ].filter(Boolean);

  const parts = [
    `📅 ${when.dateLine}`,
    `🕐 ${when.timeLine}`,
    `${impact} **${String(e.impact || 'Low').toUpperCase()}** impact`,
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
  // Discord only wraps every 3 inline fields — pad leftovers so a short row
  // doesn't stretch a single card across the full width awkwardly.
  const out = fields.slice();
  const rem = out.length % MAX_INLINE;
  if (rem === 0) return out;
  for (let i = rem; i < MAX_INLINE; i++) {
    out.push({ name: '\u200b', value: '\u200b', inline: true });
  }
  return out;
}

/**
 * @param {'week'|'day'|'release'|'reminder'} mode
 */
function titleFor(mode, events, extra = {}) {
  if (mode === 'week') return 'High Impact news This week';
  if (mode === 'release') {
    return events.length > 1 ? `🔴 Releasing now · ${events.length} prints` : '🔴 Releasing now';
  }
  if (mode === 'reminder') {
    const m = extra.minutes != null ? extra.minutes : '?';
    return events.length > 1
      ? `⏰ In ${m}m · ${events.length} releases`
      : `⏰ In ${m}m`;
  }
  // day
  if (extra.dayLabel) return `📌 ${extra.dayLabel}`;
  if (events[0]) {
    const w = formatWhen(events[0].timestamp);
    return `📌 High impact · ${w.dayName}, ${w.mon} ${w.date}`;
  }
  return '📌 High impact';
}

/**
 * Build one or more embeds packing events in rows of up to 3.
 * @returns {import('discord.js').EmbedBuilder[]}
 */
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
      embed.setFooter({ text: 'quantlab · economic calendar' });
    }
    return embed;
  });
}

/** Back-compat single event */
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

module.exports = {
  impactColor,
  eventField,
  buildGridEmbeds,
  buildSingleEventEmbed,
  titleFor,
  FLAG,
  IMPACT_DOT,
  MAX_INLINE,
};
