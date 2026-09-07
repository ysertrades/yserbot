'use strict';

/**
 * Structured economic-calendar embeds (text only — no PNG).
 * No generic "News Update" title, no footer — just the event block.
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

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function formatWhen(timestampMs) {
  const d = new Date(timestampMs - 4 * 60 * 60000);
  return {
    dateLine: `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`,
    timeLine: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} (UTC-04:00)`,
  };
}

function eventBlock(e) {
  const flag = FLAG[e.currency] || '🏳️';
  const when = formatWhen(e.timestamp);
  const impact = IMPACT_DOT[e.impact] || '•';
  const lines = [
    `${flag} **${e.currency} — ${e.title}**`,
    `📅 ${when.dateLine}`,
    `🕐 ${when.timeLine}`,
    `${impact} **${String(e.impact || 'Low').toUpperCase()}** impact`,
  ];
  const forecast = e.forecast != null && String(e.forecast).trim() !== '' ? String(e.forecast) : null;
  const previous = e.previous != null && String(e.previous).trim() !== '' ? String(e.previous) : null;
  if (forecast || previous) {
    const box = [
      forecast != null ? `Forecast: ${forecast}` : null,
      previous != null ? `Previous: ${previous}` : null,
    ].filter(Boolean).map(l => `> ${l}`).join('\n');
    lines.push('', box);
  }
  return lines.join('\n');
}

/**
 * @param {string} guildId
 * @param {object} e event
 * @param {{ title?: string|null, footer?: string|null }} [opts]
 *   title/footer default off (null). Pass a string only if a caller needs one.
 */
function buildSingleEventEmbed(guildId, e, opts = {}) {
  const title = opts.title === undefined ? null : opts.title;
  const footer = opts.footer === undefined ? null : opts.footer;

  const embed = new EmbedBuilder()
    .setColor(impactColor(guildId, e.impact))
    .setDescription(eventBlock(e).slice(0, 4090));

  if (title) embed.setTitle(String(title));
  if (footer) embed.setFooter({ text: String(footer) });

  return embed;
}

module.exports = { impactColor, eventBlock, buildSingleEventEmbed, FLAG, IMPACT_DOT };
