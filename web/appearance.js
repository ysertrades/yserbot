'use strict';

/**
 * web/appearance.js
 *
 * The panel side of the message catalogue.
 *
 * The Composer covers messages you write and post yourself. This covers the
 * other kind — the ones the bot sends because something happened. All the
 * substance is in utils/messageStyle.js, which the bot itself reads; this file
 * only shapes it for a screen and checks what comes back.
 *
 * The preview is drawn in the browser, not here. It has to keep up with every
 * keystroke, and a round trip per character would be both slow and a lot of
 * requests for something nobody has saved yet. What travels from here is the
 * stored values and the stand-in names below, so the two sides at least agree
 * on what a {token} is worth.
 */

const messageStyle = require('../utils/messageStyle');

/** Stand-in values so a preview reads like a real message rather than braces. */
const SAMPLE = {
  user: 'Mike',
  server: 'your server',
  reason: 'posted an invite',
  moderator: 'You',
  action: 'warned',
  case: '7',
  count: '3 warnings',
  duration: '10 minutes',
  level: '12',
  xp: '4,820',
  messages: '316',
  members: '1,204',
  support: '@Support',
  channel: '#ticket-0004',
  role: '@Verified',
  target: '@someone',
  // The social cards. Without these every line of a YouTube or TikTok preview
  // has nothing but empty tokens in it, so every line is dropped and the
  // preview shows a bare colour bar — which is not what gets sent at all.
  author: 'YSER Trades',
  handle: '@ysertrades',
  title: 'How I plan my week',
  text: 'The full breakdown, start to finish.',
  url: 'https://youtu.be/example',
  platform: 'YouTube',
  // The news cards. Same reasoning as the social ones above — every line of
  // these is tokens, so without stand-ins the preview is a bare colour bar.
  headline: 'Fed holds rates steady, signals two cuts this year',
  source: 'Financial Juice',
  via: 'reuters.com',
  readmore: '🔗 **[Read on reuters.com](https://reuters.com)**',
  context: 'Live Market News',
  // The calendar. {time} and {relative} are Discord timestamp markup in a
  // real card; the preview is drawn in the browser, which cannot render that
  // — so the stand-ins are what those two would come out as.
  event: 'Core CPI m/m',
  currency: 'USD',
  impact: 'High',
  minutes: '15',
  time: '8:30 AM',
  relative: 'in 15 minutes',
  forecast: '0.3%',
  previous: '0.2%',
  scope: "This Week's",
  when: 'this week',
  day: 'Monday, August 3',
  date: '3',
  count: '11',
};

/** What one entry looks like once a guild's changes are folded in. */
function describe(guildId, entry, changed) {
  return { ...entry, values: messageStyle.styleFor(guildId, entry.key), changed };
}

function read(guildId) {
  const changed = new Set(messageStyle.customised(guildId));
  const entries = messageStyle.catalogue().map(e => describe(guildId, e, changed.has(e.key)));

  // Grouped in catalogue order rather than alphabetically: Moderation first
  // because it is what people come here to change, then the record it writes,
  // then everything else.
  const groups = [];
  for (const entry of entries) {
    let g = groups.find(x => x.name === entry.group);
    if (!g) { g = { name: entry.group, entries: [] }; groups.push(g); }
    g.entries.push(entry);
  }

  return { groups, changedCount: changed.size, sample: SAMPLE };
}

function save(guildId, body) {
  const key = typeof body?.key === 'string' ? body.key : '';
  if (!Object.hasOwn(messageStyle.CATALOGUE, key)) return { error: 'unknown_message' };

  const patch = {};
  for (const part of messageStyle.partsOf(key)) {
    if (Object.hasOwn(body, part)) patch[part] = body[part];
  }
  if (Object.keys(patch).length === 0) return { ok: true, unchanged: true, key };

  const before = messageStyle.styleFor(guildId, key);
  const result = messageStyle.setStyle(guildId, key, patch);
  if (result.error) return result;

  const changed = Object.keys(patch).filter(p => before[p] !== result.style[p]);
  if (changed.length === 0) return { ok: true, unchanged: true, key, label: result.label };
  return { ...result, changed };
}

function reset(guildId, body) {
  const key = typeof body?.key === 'string' ? body.key : '';
  if (!Object.hasOwn(messageStyle.CATALOGUE, key)) return { error: 'unknown_message' };
  return messageStyle.resetStyle(guildId, key);
}

module.exports = { read, save, reset, SAMPLE };
