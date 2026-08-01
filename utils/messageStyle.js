'use strict';

/**
 * messageStyle.js
 *
 * The wording and the colour of every message the bot sends on its own.
 *
 * The Composer covers messages *you* write and post. This covers the other
 * kind — the ones the bot sends because something happened: a warning card, a
 * mod-log entry, the DM a banned member gets, the goodbye when someone leaves,
 * the level-up. Those were hard-coded in nine different files, so changing the
 * colour of a warning meant editing source and redeploying, and nobody outside
 * this repository could change them at all.
 *
 * Now they are a catalogue. Each entry names what the message is, where it is
 * sent, which parts can be edited and what the factory wording is; a guild's
 * changes are stored as a patch on top, so an entry the panel has never been
 * opened for behaves exactly as it did before this file existed.
 *
 * Two rules hold everything together:
 *
 *   · Nothing here may throw. EmbedBuilder validates and throws on a bad
 *     colour or an over-long title, and a message the bot *has* to send —
 *     the DM before a ban, the mod-log entry — must never be lost to a typo
 *     somebody made in a web form three weeks earlier. Every setter is
 *     guarded and every value is clamped on the way in as well.
 *
 *   · A message that is turned off returns null rather than an empty embed,
 *     so the caller skips the send entirely instead of posting a blank card.
 */

const { EmbedBuilder } = require('discord.js');
const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'message_styles.json';

/* ─── what can be edited ─────────────────────────────────────────────────── */

/**
 * Shapes.
 *
 * `action` is the small card a moderation action leaves in the channel: an
 * avatar and a line, then the reason. It has no room for a footer or a
 * timestamp and gaining one would undo the point of it.
 *
 * `card` is a full embed — title, body, footer, thumbnail, timestamp.
 */
const SHAPES = {
  action: ['enabled', 'color', 'title', 'body'],
  card:   ['enabled', 'color', 'title', 'body', 'footer', 'thumbnail', 'timestamp'],
};

// Tokens every entry understands, on top of the ones it lists for itself.
const COMMON_TOKENS = ['{user}', '{server}'];

/**
 * The moderation cards have no on/off switch on purpose.
 *
 * Every one of them is a slash command's reply, and Discord requires a reply —
 * a switch here would look like "stop announcing warnings" and actually mean
 * "make /warn fail". Only messages the bot sends unprompted can be turned off.
 */
const ACTION_PARTS = ['color', 'title', 'body'];

const action = (label, blurb, color, done, extra = {}) => ({
  group: 'Moderation',
  label,
  blurb,
  shape: 'action',
  parts: ACTION_PARTS,
  tokens: ['{reason}'],
  defaults: { enabled: true, color, title: `{user} ${done}`, body: '**Reason:** {reason}' },
  ...extra,
});

/**
 * A card for one social platform.
 *
 * Four near-identical entries whose only real differences are the name and
 * the brand colour, so they are generated rather than written out four times
 * and then drifting apart. There is no on/off switch here: whether a platform
 * posts at all is the Social screen's business — each watched account has its
 * own switch there, and a second one here that meant something subtly
 * different would only be confusing.
 */
const social = (key, name, color, blurb) => ({
  [`social.${key}`]: {
    group: 'Social',
    label: name,
    blurb,
    shape: 'card',
    // The heading goes in the author row rather than the title, because that
    // is the only slot on a Discord embed that can carry a picture beside the
    // words — and the picture is the platform's own mark. A title with an
    // emoji glued to the front was the nearest thing before there was one.
    iconInAuthor: true,
    parts: ['color', 'title', 'body', 'footer', 'thumbnail', 'timestamp'],
    tokens: ['{author}', '{handle}', '{title}', '{text}', '{url}', '{platform}'],
    titleLabel: 'Heading',
    bodyLabel: 'Body',
    bodyHint: 'Leave {url} in somewhere — it is what makes the card followable. Add {text} if you want the post\'s own words under it.',
    defaults: {
      enabled: true, color,
      title: `{author} on ${name}`,
      // The post's title, and nothing else. A caption arrives as whatever the
      // poster wrote — a YouTube description is a wall of channel links and
      // disclaimers, an Instagram one is thirty hashtags — and pasting that
      // under the headline buries the one line anyone reads. {text} is still
      // a token, so a server that wants the caption can put it back.
      body: '**[{title}]({url})**',
      footer: `${name} • {handle}`,
      // Off, so the post's picture goes across the bottom of the card instead
      // of into the little square in the corner. A video thumbnail or a photo
      // post *is* the post; shrinking it to a corner tile makes it decoration.
      thumbnail: false, timestamp: true,
    },
  },
});

const CATALOGUE = {
  /* -- the cards a moderation action leaves in the channel ---------------- */

  'mod.warn': action('Warning issued',
    'Posted in the channel when a moderator runs /warn, or when the report card\'s Warn button is pressed.',
    '#F1C40F', 'has been warned'),

  'mod.kick': action('Member kicked',
    'Posted in the channel when a member is kicked.', '#E67E22', 'has been kicked'),

  'mod.ban': action('Member banned',
    'Posted in the channel when a member is banned.', '#E74C3C', 'has been banned'),

  'mod.unban': action('Member unbanned',
    'Posted when a ban is lifted.', '#2ECC71', 'has been unbanned'),

  'mod.mute': action('Member timed out',
    'Posted when a member is timed out. {duration} is how long it lasts — "10 minutes".',
    '#9B59B6', 'has been timed out', {
      tokens: ['{reason}', '{duration}'],
      defaults: {
        enabled: true, color: '#9B59B6', title: '{user} has been timed out',
        body: '**Reason:** {reason}\n**For:** {duration}',
      },
    }),

  'mod.unmute': action('Timeout lifted',
    'Posted when a timeout is ended early.', '#2ECC71', 'can talk again'),

  'mod.warnclear': action('Warnings cleared',
    'Posted when a member\'s warnings are forgiven. {count} reads as "3 warnings" — the number and the word together, so it is right at one as well.',
    '#2ECC71', 'has a clean slate', {
      tokens: ['{count}'],
      defaults: {
        enabled: true, color: '#2ECC71', title: '{user} has a clean slate',
        body: '**Cleared:** {count}',
      },
    }),

  'mod.purge': action('Clearing messages',
    'The short "working on it" card while /purge is deleting. It is replaced by the one below as soon as the delete finishes.',
    '#4C7DFF', 'is being cleaned up after', {
      tokens: ['{count}'],
      defaults: {
        enabled: true, color: '#4C7DFF', title: '{user} is being cleaned up after',
        body: '**Clearing:** up to {count}',
      },
    }),

  'mod.purged': action('Messages cleared',
    'Posted when /purge finishes. {count} reads as "12 messages".',
    '#2ECC71', 'had messages cleared', {
      tokens: ['{count}'],
      defaults: {
        enabled: true, color: '#2ECC71', title: '{user} had messages cleared',
        body: '**Deleted:** {count}',
      },
    }),

  /* -- the record ---------------------------------------------------------- */

  'log.action': {
    group: 'Records',
    label: 'Mod-log entry',
    blurb: 'The full entry written to your log channel for every manual action. This is the record, so it keeps its User, Moderator and Reason fields — the colour is taken from the matching card above.',
    shape: 'card',
    parts: ['enabled', 'title', 'footer', 'thumbnail', 'timestamp'],
    tokens: ['{action}', '{moderator}', '{reason}', '{case}'],
    defaults: {
      enabled: true, color: '#95A5A6', title: '{ACTION}',
      body: '', footer: 'Case #{case}', thumbnail: true, timestamp: true,
    },
  },

  'dm.action': {
    group: 'Records',
    label: 'Message to the member',
    blurb: 'Sent to the member privately, before a kick or a ban removes them. {action} becomes warned, kicked, banned, timed out, and so on. The colour is taken from the matching card above.',
    shape: 'card',
    parts: ['enabled', 'title', 'body', 'footer', 'thumbnail', 'timestamp'],
    tokens: ['{action}', '{reason}', '{case}', '{duration}'],
    defaults: {
      enabled: true, color: '#95A5A6', title: 'Action taken in {server}',
      body: 'You have been **{action}** in **{server}**.',
      footer: 'If you believe this is a mistake, contact the server staff.',
      thumbnail: true, timestamp: true,
    },
  },

  /* -- coming and going ---------------------------------------------------- */

  'member.welcome': {
    group: 'Members',
    label: 'Welcome card',
    blurb: 'Posted in your welcome channel when someone joins. The card itself is drawn in Studio — this is its colour and the line above it.',
    shape: 'card',
    parts: ['enabled', 'color', 'body'],
    bodyLabel: 'Line above the card',
    bodyHint: 'Leave {user} in to ping them. Clear it for no message above the card.',
    tokens: ['{members}'],
    defaults: { enabled: true, color: '#10B981', title: '', body: '{user}' },
  },

  'member.leave': {
    group: 'Members',
    label: 'Goodbye',
    blurb: 'Posted in your leave channel when someone goes.',
    shape: 'card',
    parts: ['enabled', 'color', 'title', 'footer', 'thumbnail', 'timestamp'],
    wordingNote: 'The sentence in the middle is the Leave message on the Settings screen, so it stays in one place.',
    tokens: ['{members}'],
    defaults: {
      enabled: true, color: '#F97316', title: '🍂 A Leaf Has Fallen', body: '',
      footer: 'Farewell from {server} 🍂', thumbnail: true, timestamp: true,
    },
  },

  'member.levelup': {
    group: 'Members',
    label: 'Level up',
    blurb: 'Posted in the channel where they were talking when they reach a new level.',
    shape: 'action',
    parts: ['enabled', 'color', 'title', 'body'],
    tokens: ['{level}', '{xp}', '{messages}'],
    defaults: { enabled: true, color: '#3498DB', title: '{user} levelled up', body: '**Level {level}** 🎉' },
  },

  /* -- the rest ------------------------------------------------------------ */

  'ticket.opened': {
    group: 'Tickets',
    label: 'Ticket opened',
    blurb: 'The first message inside a new ticket channel. {support} is the support role, if one is set. It is always sent — a ticket with no opening message would look broken.',
    shape: 'card',
    parts: ['color', 'title', 'body', 'footer', 'timestamp'],
    tokens: ['{support}', '{channel}'],
    defaults: {
      enabled: true, color: '#00CEC9', title: '🎫 Ticket Opened',
      body: 'Welcome {user}! A support member will be with you shortly.\n\nDescribe your issue in detail below.',
      footer: '', thumbnail: false, timestamp: true,
    },
  },

  'verify.success': {
    group: 'Verification',
    label: 'Verified',
    blurb: 'Shown to a member the moment they pass the memory check.',
    shape: 'card',
    parts: ['color', 'title', 'footer', 'timestamp'],
    wordingNote: 'The sentence in the middle is the Welcome line in the verification settings.',
    tokens: ['{role}'],
    defaults: {
      enabled: true, color: '#2ECC71', title: '✅ Verified!', body: '',
      footer: '', thumbnail: false, timestamp: false,
    },
  },

  /* -- social ------------------------------------------------------------- */

  ...social('youtube', 'YouTube', '#FF0000',
    'Posted when a watched YouTube channel publishes. {title} is the video title.'),
  ...social('tiktok', 'TikTok', '#FE2C55',
    'Posted when a watched TikTok account puts something out.'),
  ...social('instagram', 'Instagram', '#E1306C',
    'Posted when a watched Instagram account puts something out.'),
  ...social('twitter', 'X', '#0F1419',
    'Posted when a watched X account posts. The colour is X\'s own black — not quite #000000, because Discord reads a colour of exactly zero as "no colour" and draws its grey instead.'),

  'report.submitted': {
    group: 'Reports',
    label: 'Report sent',
    blurb: 'What the person who filed a report sees once it reaches your staff. Only they see it.',
    shape: 'card',
    parts: ['color', 'title', 'body', 'footer', 'timestamp'],
    tokens: ['{target}'],
    defaults: {
      enabled: true, color: '#2ECC71', title: '✅ Report Submitted',
      body: 'Your report against {target} has been sent to the moderation team.\n\nThank you for helping keep the server safe.',
      footer: '', thumbnail: false, timestamp: true,
    },
  },
};

/** The parts an entry actually shows, defaulting to everything its shape has. */
function partsOf(key) {
  const entry = CATALOGUE[key];
  if (!entry) return [];
  return entry.parts || SHAPES[entry.shape] || [];
}

/* ─── storage ────────────────────────────────────────────────────────────── */

const LIMITS = { title: 256, body: 4000, footer: 2048 };

const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** The stored patch merged over the factory defaults. Always a full object. */
function styleFor(guildId, key) {
  const entry = CATALOGUE[key];
  if (!entry) return null;
  const stored = readJson(FILE, {})[guildId]?.[key];
  const out = { ...entry.defaults };
  if (stored && typeof stored === 'object') {
    for (const part of partsOf(key)) {
      if (!Object.hasOwn(stored, part)) continue;
      const value = stored[part];
      if (part === 'color') { if (isHex(value)) out.color = value.toUpperCase(); continue; }
      if (part === 'enabled' || part === 'thumbnail' || part === 'timestamp') { out[part] = !!value; continue; }
      if (typeof value === 'string') out[part] = value.slice(0, LIMITS[part === 'body' ? 'body' : part] ?? 2048);
    }
  }
  return out;
}

/** Every entry, merged, for the panel. */
function all(guildId) {
  const out = {};
  for (const key of Object.keys(CATALOGUE)) out[key] = styleFor(guildId, key);
  return out;
}

/**
 * Writes one entry's patch.
 *
 * Only the parts the entry actually exposes are kept — a request carrying a
 * footer for a shape that has no footer is not an error, it is just ignored,
 * because otherwise a stale browser tab could store a value nothing reads.
 */
function setStyle(guildId, key, patch) {
  const entry = CATALOGUE[key];
  if (!entry) return { error: 'unknown_message' };
  if (!patch || typeof patch !== 'object') return { error: 'bad_style' };

  const allowed = partsOf(key);
  const next = {};
  for (const part of allowed) {
    if (!Object.hasOwn(patch, part)) continue;
    const value = patch[part];
    if (part === 'color') {
      const hex = typeof value === 'string' ? value.trim() : '';
      const full = hex.startsWith('#') ? hex : `#${hex}`;
      if (!isHex(full)) return { error: 'bad_color' };
      next.color = full.toUpperCase();
    } else if (part === 'enabled' || part === 'thumbnail' || part === 'timestamp') {
      next[part] = !!value;
    } else {
      if (typeof value !== 'string') return { error: 'bad_style' };
      next[part] = value.slice(0, LIMITS[part === 'body' ? 'body' : part] ?? 2048);
    }
  }

  // A card with nothing in it at all would post as a bare colour bar. Turning
  // it off is the way to stop it being sent.
  const merged = { ...styleFor(guildId, key), ...next };
  if (merged.enabled && allowed.includes('title') && allowed.includes('body')
      && !merged.title.trim() && !merged.body.trim()) {
    return { error: 'empty_message' };
  }

  const store = readJson(FILE, {});
  if (!store[guildId]) store[guildId] = {};
  store[guildId][key] = { ...(store[guildId][key] || {}), ...next };
  writeJson(FILE, store);
  return { ok: true, key, label: entry.label, style: styleFor(guildId, key) };
}

/** Drops a guild's changes to one entry, putting it back to the shipped wording. */
function resetStyle(guildId, key) {
  const entry = CATALOGUE[key];
  if (!entry) return { error: 'unknown_message' };
  const store = readJson(FILE, {});
  if (!store[guildId]?.[key]) return { ok: true, key, label: entry.label, unchanged: true, style: styleFor(guildId, key) };
  delete store[guildId][key];
  writeJson(FILE, store);
  return { ok: true, key, label: entry.label, style: styleFor(guildId, key) };
}

/** Which entries this guild has actually changed — the panel marks those. */
function customised(guildId) {
  const stored = readJson(FILE, {})[guildId] || {};
  return Object.keys(stored).filter(k => Object.hasOwn(CATALOGUE, k) && Object.keys(stored[k] || {}).length > 0);
}

/* ─── rendering ──────────────────────────────────────────────────────────── */

/**
 * Substitutes {tokens}, line by line.
 *
 * A token nobody supplied is removed rather than left showing its braces —
 * "{duration}" in the middle of a sentence reads as a bug to whoever receives
 * the message, and they cannot do anything about it.
 *
 * And a line whose tokens *all* came back empty is dropped entirely, because
 * what is left of it is a label for something that is not there: a timeout
 * with no duration would otherwise say "**For:**" and stop, and a mod-log
 * entry with no case number would have a footer reading "Case #".
 *
 * Line by line rather than whole-string so a two-line body keeps the half it
 * still has — the reason stays even when the duration is missing.
 */
function fill(text, tokens = {}) {
  if (!text) return '';

  const resolve = name => {
    if (Object.hasOwn(tokens, name)) {
      const v = tokens[name];
      return v === null || v === undefined ? '' : String(v);
    }
    // {ACTION} and friends: the same token, upper-cased.
    const lower = name.toLowerCase();
    if (name === name.toUpperCase() && Object.hasOwn(tokens, lower)) {
      return String(tokens[lower] ?? '').toUpperCase();
    }
    return '';
  };

  const kept = [];
  for (const line of String(text).split('\n')) {
    let sawToken = false;
    let sawValue = false;
    const filled = line.replace(/\{(\w+)\}/g, (whole, name) => {
      sawToken = true;
      const value = resolve(name);
      if (value !== '') sawValue = true;
      return value;
    });
    if (sawToken && !sawValue) continue;
    kept.push(filled.replace(/[ \t]+$/, ''));
  }

  return kept.join('\n').trim();
}

const colorInt = hex => {
  const n = parseInt(String(hex || '').replace('#', ''), 16);
  return Number.isFinite(n) ? n : 0x99AAB5;
};

/**
 * Builds the embed for one message, or null when it is switched off.
 *
 * @param {string} guildId
 * @param {string} key       a catalogue key
 * @param {object} opts
 *   tokens       — {user}, {reason}, … as a plain object
 *   iconURL      — the avatar beside the line on an `action` card
 *   thumbnailURL — used only when the entry has its thumbnail switched on
 *   fields       — extra fields appended after the body (the mod log's record)
 *   color        — overrides the stored colour (the mod log borrows the
 *                  action's, so one colour change covers card, log and DM)
 *   at           — the moment the card is about, when that is not now: a
 *                  social post carries when it was published, which is what
 *                  makes "3 hours ago" under the card mean anything
 */
function build(guildId, key, opts = {}) {
  const entry = CATALOGUE[key];
  if (!entry) return null;
  const style = styleFor(guildId, key);
  if (!style.enabled) return null;

  const { tokens = {}, iconURL = null, thumbnailURL = null, fields = [], color = null, at = null } = opts;
  const title = fill(style.title, tokens).slice(0, 256);
  const body = fill(style.body, tokens).slice(0, 4096);

  const embed = new EmbedBuilder();
  const set = fn => { try { fn(); } catch { /* a bad value must not lose the message */ } };

  set(() => embed.setColor(colorInt(color && isHex(color) ? color : style.color)));

  if (entry.shape === 'action') {
    // The compact card: the line goes in the author slot so the avatar sits
    // beside it, which is what keeps it to one row.
    //
    // The icon is tried first and dropped if it is refused. setAuthor
    // validates the whole object, so a member whose avatar URL came back
    // malformed would otherwise take the line with it — and on this shape the
    // line *is* the message.
    const name = title || 'Update';
    try { embed.setAuthor({ name, iconURL: iconURL || undefined }); }
    catch { set(() => embed.setAuthor({ name })); }
    if (body) set(() => embed.setDescription(body));
    return embed;
  }

  if (entry.iconInAuthor) {
    // Author rather than title: it is the one slot that takes a picture beside
    // the words. The icon is tried first and dropped if Discord refuses it, so
    // a mark that cannot be fetched costs the picture and not the heading.
    if (title) {
      try { embed.setAuthor({ name: title, iconURL: iconURL || undefined }); }
      catch { set(() => embed.setAuthor({ name: title })); }
    }
  } else if (title) {
    set(() => embed.setTitle(title));
  }
  if (body) set(() => embed.setDescription(body));

  for (const f of fields) {
    if (!f?.name || !f?.value) continue;
    set(() => embed.addFields({
      name: String(f.name).slice(0, 256),
      value: String(f.value).slice(0, 1024),
      inline: !!f.inline,
    }));
  }

  const footer = fill(style.footer, tokens).slice(0, 2048);
  if (footer) set(() => embed.setFooter({ text: footer }));
  if (style.thumbnail && thumbnailURL) set(() => embed.setThumbnail(thumbnailURL));
  if (style.timestamp) set(() => embed.setTimestamp(at ?? undefined));

  return embed;
}

/** True when this message is switched on — for callers that skip work first. */
function isOn(guildId, key) {
  const entry = CATALOGUE[key];
  return entry ? styleFor(guildId, key).enabled !== false : false;
}

/** The whole catalogue, shaped for the panel. */
function catalogue() {
  return Object.entries(CATALOGUE).map(([key, entry]) => ({
    key,
    group: entry.group,
    label: entry.label,
    blurb: entry.blurb,
    shape: entry.shape,
    parts: partsOf(key),
    tokens: [...COMMON_TOKENS, ...(entry.tokens || [])],
    titleLabel: entry.titleLabel || null,
    bodyLabel: entry.bodyLabel || 'Body',
    bodyHint: entry.bodyHint || null,
    wordingNote: entry.wordingNote || null,
    defaults: entry.defaults,
  }));
}

module.exports = {
  CATALOGUE, FILE, LIMITS,
  catalogue, all, customised, styleFor, setStyle, resetStyle,
  build, fill, isOn, partsOf,
};
