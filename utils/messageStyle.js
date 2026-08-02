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
 * Near-identical entries whose only real differences are the name and the
 * brand colour, so they are generated rather than written out once each and
 * then drifting apart. There is no on/off switch here: whether a platform
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

/**
 * The kinds of card the bot sends without a catalogue entry of its own.
 *
 * Most of what the bot says is a confirmation, a refusal or a notice — "Shop
 * item added", "You cannot do that", "Feed started" — and there are a couple
 * of hundred of them. Giving each its own entry would be a screen nobody
 * could find anything on, and leaving them all fixed meant a server could
 * restyle a warning card and not the two hundred messages around it.
 *
 * So they are grouped by the kind of thing they are, which is what they were
 * already grouped by in the code, and the colour of each kind is one setting.
 * Editing "Something went wrong" recolours every refusal the bot can give.
 */
const PALETTE_KINDS = [
  { key: 'success',   label: 'Confirmations',        color: '#2ECC71', does: 'Anything that worked — saved, added, started' },
  { key: 'error',     label: 'Something went wrong', color: '#FF4757', does: 'Refusals and failures' },
  { key: 'info',      label: 'Notices',              color: '#5865F2', does: 'Neutral information and readouts' },
  { key: 'warning',   label: 'Warnings',             color: '#FFA502', does: 'Careful-now messages' },
  { key: 'giveaway',  label: 'Giveaways',            color: '#FFD700', does: 'Giveaway cards and results' },
  { key: 'ticket',    label: 'Tickets',              color: '#00CEC9', does: 'Ticket chrome outside the two cards above' },
  { key: 'economy',   label: 'Economy',              color: '#F59E0B', does: 'Coins, work, daily, transfers' },
  { key: 'shop',      label: 'Shop',                 color: '#FF6B35', does: 'The shop and buying from it' },
  { key: 'inventory', label: 'Inventory',            color: '#3B82F6', does: 'What a member owns' },
  { key: 'casino',    label: 'Casino',               color: '#E11D48', does: 'Every game and its result' },
  { key: 'userinfo',  label: 'Member cards',         color: '#A855F7', does: 'Rank, profile, who-is' },
  { key: 'schedule',  label: 'Scheduled posts',      color: '#EC4899', does: 'The scheduler' },
  { key: 'news',      label: 'News',                 color: '#1D9BF0', does: 'Market headlines and the calendar' },
  { key: 'breaking',  label: 'Breaking news',        color: '#FF3B30', does: 'Headlines flagged urgent' },
  { key: 'welcome',   label: 'Arrivals',             color: '#10B981', does: 'Chrome around the welcome card' },
  { key: 'leave',     label: 'Departures',           color: '#F97316', does: 'Chrome around the goodbye card' },
  { key: 'mod',       label: 'Moderation chrome',    color: '#EF4444', does: 'Moderation messages without a card of their own' },
];

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

  'ticket.panel': {
    group: 'Tickets',
    label: 'Ticket panel',
    blurb: 'The message that sits in your ticket channel with the button members press to open one. Posted by /ticket setup.',
    shape: 'card',
    parts: ['color', 'title', 'body', 'footer', 'buttons'],
    tokens: [],
    buttons: [
      { id: 'create_ticket', label: 'Create Ticket', emoji: '🎫', style: 'Primary', does: 'Opens a private channel for the member' },
    ],
    defaults: {
      enabled: true, color: '#00CEC9', title: '🎫 Support Tickets',
      body: 'Need help? Press the button below to open a private ticket and our team will be with you.',
      footer: 'Usually answered within a few hours',
      thumbnail: false, timestamp: false,
    },
  },

  'ticket.opened': {
    group: 'Tickets',
    label: 'Ticket opened',
    blurb: 'The first message inside a new ticket channel. {support} is the support role, if one is set. It is always sent — a ticket with no opening message would look broken.',
    shape: 'card',
    parts: ['color', 'title', 'body', 'footer', 'timestamp', 'buttons'],
    tokens: ['{support}', '{channel}'],
    buttons: [
      { id: 'close_ticket', label: 'Close Ticket', emoji: '🔒', style: 'Danger', does: 'Closes the ticket and deletes the channel' },
    ],
    defaults: {
      enabled: true, color: '#00CEC9', title: '🎫 Ticket Opened',
      body: 'Welcome {user}! A support member will be with you shortly.\n\nDescribe your issue in detail below.',
      footer: '', thumbnail: false, timestamp: true,
    },
  },

  'verify.panel': {
    group: 'Verification',
    label: 'Verification panel',
    blurb: 'The message members press to start verifying. Posted by /verify setup, or from the Settings screen.',
    shape: 'card',
    parts: ['color', 'buttons'],
    wordingNote: 'The heading, the opening line and the rules are on the Settings screen, so they stay in one place rather than being editable in two.',
    tokens: [],
    buttons: [
      { id: 'verify_start', label: 'Start Verification', emoji: '🧠', style: 'Success', does: 'Begins the memory challenge' },
    ],
    defaults: { enabled: true, color: '#5865F2', title: '', body: '' },
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

  /* -- giveaways ----------------------------------------------------------- */

  'giveaway.live': {
    group: 'Giveaways',
    label: 'Giveaway card',
    blurb: 'The card that sits in the channel while a prize giveaway is running, with the Enter button under it. {entries} counts up on its own as people enter — leave it in and it stays live.',
    shape: 'card',
    parts: ['color', 'title', 'body', 'footer', 'buttons'],
    tokens: ['{prize}', '{winners}', '{host}', '{ends}', '{endsAt}', '{entries}', '{requirements}'],
    bodyHint: '{ends} becomes a countdown Discord keeps updating; {endsAt} is the plain date. {requirements} is whatever entry conditions were set, or nothing.',
    buttons: [
      { id: 'giveaway_enter', label: 'Enter', emoji: '🎟️', style: 'Secondary', does: 'Enters the member into the draw' },
      { id: 'giveaway_participants', label: 'Participants', emoji: '🏅', style: 'Secondary', does: 'Shows who has entered so far' },
    ],
    defaults: {
      enabled: true, color: '#FFD700', title: '🎟️  {prize}',
      body: '✨ Click **Enter** below to participate!\n\n'
        + '🏆 **Winners:** {winners}\n'
        + '👤 **Hosted by:** {host}\n'
        + '⏰ **Ends:** {ends}\n'
        + '📊 **Entries:** {entries}{requirements}',
      footer: 'Ends at | {endsAt}', thumbnail: true, timestamp: true,
    },
  },

  'giveaway.ended': {
    group: 'Giveaways',
    label: 'Giveaway result',
    blurb: 'Replaces the card above when the giveaway finishes and somebody has won.',
    shape: 'card',
    parts: ['color', 'title', 'body', 'footer'],
    tokens: ['{prize}', '{winners}', '{host}', '{entries}', '{id}'],
    bodyHint: '{id} is the short code /giveaway reroll takes.',
    defaults: {
      enabled: true, color: '#FFD700', title: '🎟️  {prize} — Ended',
      body: '🏆 **Winners:** {winners}\n\n👤 **Hosted by:** {host}\n📊 **Total entries:** {entries}\n\n🔁 To reroll, use `/giveaway reroll` or `g.reroll {id}`',
      footer: 'Congratulations! 🎉 • ID: {id}', thumbnail: false, timestamp: true,
    },
  },

  'giveaway.empty': {
    group: 'Giveaways',
    label: 'Giveaway with no entries',
    blurb: 'Replaces the card when the giveaway finishes and nobody entered.',
    shape: 'card',
    parts: ['color', 'title', 'body', 'footer'],
    tokens: ['{prize}', '{host}', '{id}'],
    defaults: {
      enabled: true, color: '#E74C3C', title: '🎟️  {prize} — Ended',
      body: 'No participants entered the giveaway.',
      footer: 'Better luck next time!', thumbnail: false, timestamp: true,
    },
  },

  'giveaway.won': {
    group: 'Giveaways',
    label: 'Message to the winner',
    blurb: 'Sent privately to each winner. Turn it off and winners are only named in the channel.',
    shape: 'card',
    parts: ['enabled', 'color', 'title', 'body', 'footer', 'timestamp'],
    tokens: ['{prize}', '{host}'],
    defaults: {
      enabled: true, color: '#FFD700', title: '🎉 You Won a Giveaway!',
      body: 'You won **{prize}** in **{server}**!\nContact the host, {host}, to claim your prize.',
      footer: '', thumbnail: false, timestamp: true,
    },
  },

  'report.form': {
    group: 'Reports',
    label: 'Report form',
    blurb: 'The private form a member fills in when they run /report. Only they see it — the two dropdowns on it are Discord\'s own and cannot be restyled.',
    shape: 'card',
    parts: ['color', 'title', 'body', 'footer', 'buttons'],
    tokens: [],
    buttons: [
      { id: 'report_link', label: 'Add Link', emoji: '🔗', style: 'Secondary', does: 'Opens a box for a link to the message' },
      { id: 'report_submit', label: 'Submit Report', emoji: '📤', style: 'Success', does: 'Sends it to your staff' },
      { id: 'report_cancel', label: 'Cancel', emoji: '✖️', style: 'Secondary', does: 'Throws the draft away' },
    ],
    defaults: {
      enabled: true, color: '#E74C3C', title: '🚨 File a Report',
      body: 'Pick the member below, choose a reason, add a link to the message if you have one, then press Submit.',
      footer: 'Only you can see this — nothing is sent until you press Submit',
      thumbnail: false, timestamp: false,
    },
  },

  'report.card': {
    group: 'Reports',
    label: 'Report card for staff',
    blurb: 'What lands in your report channel when somebody files one. It keeps its Reported user, Reporter and Reason fields — those are the record.',
    shape: 'card',
    parts: ['color', 'title', 'footer', 'thumbnail', 'timestamp', 'buttons'],
    tokens: ['{target}', '{reporter}', '{reason}'],
    buttons: [
      { id: 'rpt_action', label: 'Take Action', emoji: '⚡', style: 'Danger', does: 'Opens the warn, kick, ban and timeout buttons' },
    ],
    defaults: {
      enabled: true, color: '#E74C3C', title: '🚨 New User Report',
      body: '', footer: 'Report from {server}', thumbnail: true, timestamp: true,
    },
  },

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

  /* -- the look of everything without an entry of its own ----------------
     Last on purpose: this is the catch-all, and a catch-all at the top of a
     list is the first thing you read and the last thing you want. */

  'base.palette': {
    group: 'Everything else',
    label: 'Colours',
    blurb: 'The colour of every card the bot sends that is not listed separately below — every confirmation, refusal and notice, grouped by what kind of thing it is. Around two hundred messages take their colour from here.',
    shape: 'card',
    parts: ['palette'],
    tokens: [],
    palette: PALETTE_KINDS,
    defaults: {
      enabled: true, color: '#5865F2', title: '', body: '',
      palette: Object.fromEntries(PALETTE_KINDS.map(k => [k.key, k.color])),
    },
  },

  'base.chrome': {
    group: 'Everything else',
    label: 'Card footer and name',
    blurb: 'The line along the bottom of the bot\'s larger cards, and the name at the top of them. Small cards — a one-line confirmation — carry neither, on purpose.',
    shape: 'card',
    parts: ['title', 'footer'],
    titleLabel: 'Name at the top',
    tokens: [],
    defaults: {
      enabled: true, color: '#5865F2',
      title: 'YSER Flow', body: '',
      footer: '{server} • YSER Flow',
    },
  },
};

/** The parts an entry actually shows, defaulting to everything its shape has. */
function partsOf(key) {
  const entry = CATALOGUE[key];
  if (!entry) return [];
  return entry.parts || SHAPES[entry.shape] || [];
}

/* ─── the buttons a message carries ──────────────────────────────────────── */

/**
 * Some of these messages are panels — they sit in a channel with a button
 * under them that members press. The wording and the colour of the card were
 * editable and the button was not, which is the wrong way round: the button
 * is the part people read before they press, and "Create Ticket" in English
 * on a server that speaks anything else was simply stuck that way.
 *
 * An entry declares the buttons it carries and what they say by default; a
 * guild stores a patch of {label, emoji, style} per button. The custom id is
 * never editable — it is what the bot routes the press on, so letting it be
 * typed would be a way to build a button that does nothing.
 *
 * Link buttons are not offered. They need a URL rather than a custom id and
 * none of these panels has one; the Composer is where a link button belongs.
 */
const BUTTON_STYLES = ['Primary', 'Secondary', 'Success', 'Danger'];

const BUTTON_LIMITS = { label: 80, emoji: 60 };

/**
 * A guild's colour for one kind, or the shipped one.
 *
 * Never throws and never returns nothing: this is called from the builder
 * that every confirmation in the bot goes through, so a bad stored value has
 * to fall back rather than take the message with it.
 */
function paletteFor(guildId) {
  const entry = CATALOGUE['base.palette'];
  const stored = readJson(FILE, {})[guildId]?.['base.palette']?.palette || {};
  const out = {};
  for (const kind of entry.palette) {
    const v = stored[kind.key];
    out[kind.key] = isHex(v) ? v.toUpperCase() : kind.color;
  }
  return out;
}

/** What an entry's buttons look like after a guild's changes. */
function buttonsFor(guildId, key) {
  const entry = CATALOGUE[key];
  if (!entry?.buttons?.length) return [];
  const stored = readJson(FILE, {})[guildId]?.[key]?.buttons || {};
  return entry.buttons.map(b => {
    const patch = stored[b.id] && typeof stored[b.id] === 'object' ? stored[b.id] : {};
    const style = BUTTON_STYLES.includes(patch.style) ? patch.style : b.style;
    return {
      id: b.id,
      // Whether this guild has actually changed it. A second setting for the
      // same button elsewhere can then defer to Appearance once Appearance
      // has been used, without overriding a value somebody set years ago in
      // the other place and never revisited.
      edited: !!(stored[b.id] && Object.keys(stored[b.id]).length),
      // An empty label is allowed when there is an emoji to carry the button,
      // which is how a compact panel is built — but not both empty, because
      // Discord refuses a button with neither and the whole panel would fail
      // to post over one blank field.
      label: typeof patch.label === 'string' ? patch.label.slice(0, BUTTON_LIMITS.label) : b.label,
      emoji: typeof patch.emoji === 'string' ? patch.emoji.slice(0, BUTTON_LIMITS.emoji) : (b.emoji || ''),
      style,
      // What it says on the tin, for the panel to explain each one.
      does: b.does || '',
    };
  }).map(b => (b.label || b.emoji ? b : { ...b, label: b.id }));
}

/**
 * Builds the row, ready to send.
 *
 * `customId` maps a declared id onto the real one, because several of these
 * carry a session or a target on the end — `verify_cancel:abc123`. Returning
 * null rather than an empty row matters: Discord rejects a row with no
 * components, so a message with every button removed must send without one.
 */
function buildButtons(guildId, key, { customId = id => id, ButtonBuilder, ActionRowBuilder, ButtonStyle } = {}) {
  const specs = buttonsFor(guildId, key);
  if (!specs.length || !ButtonBuilder || !ActionRowBuilder) return null;
  const row = new ActionRowBuilder();
  for (const b of specs) {
    try {
      const btn = new ButtonBuilder()
        .setCustomId(String(customId(b.id)))
        .setStyle(ButtonStyle[b.style] ?? ButtonStyle.Secondary);
      if (b.label) btn.setLabel(b.label);
      if (b.emoji) {
        // An emoji Discord will not parse throws, and losing the whole panel
        // to one bad character in a web form is not a trade worth making.
        try { btn.setEmoji(b.emoji); } catch { if (!b.label) btn.setLabel(b.id); }
      }
      row.addComponents(btn);
    } catch { /* a button that will not build is left out rather than fatal */ }
  }
  return row.components.length ? row : null;
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
      // Buttons are resolved by buttonsFor, which knows the entry's own
      // declarations — the stored patch alone is meaningless without them.
      if (part === 'buttons' || part === 'palette') continue;
      if (typeof value === 'string') out[part] = value.slice(0, LIMITS[part === 'body' ? 'body' : part] ?? 2048);
    }
  }
  if (partsOf(key).includes('buttons')) out.buttons = buttonsFor(guildId, key);
  if (partsOf(key).includes('palette')) out.palette = paletteFor(guildId);
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
    } else if (part === 'palette') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'bad_palette' };
      const known = new Set((entry.palette || []).map(k => k.key));
      const patch = {};
      for (const [kind, hex] of Object.entries(value)) {
        // Only kinds that exist. A stale tab must not be able to store a
        // colour for something nothing reads.
        if (!known.has(kind) || typeof hex !== 'string') continue;
        const full = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`;
        if (!isHex(full)) return { error: 'bad_color' };
        patch[kind] = full.toUpperCase();
      }
      next.palette = patch;
    } else if (part === 'buttons') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'bad_buttons' };
      const declared = new Set((entry.buttons || []).map(b => b.id));
      const patch = {};
      for (const [id, raw] of Object.entries(value)) {
        // Only ids this message actually carries. A stale tab, or somebody
        // posting by hand, must not be able to store a button that nothing
        // renders and nothing routes.
        if (!declared.has(id) || !raw || typeof raw !== 'object') continue;
        const one = {};
        if (typeof raw.label === 'string') one.label = raw.label.trim().slice(0, BUTTON_LIMITS.label);
        if (typeof raw.emoji === 'string') one.emoji = raw.emoji.trim().slice(0, BUTTON_LIMITS.emoji);
        if (typeof raw.style === 'string') {
          if (!BUTTON_STYLES.includes(raw.style)) return { error: 'bad_button_style' };
          one.style = raw.style;
        }
        // Discord refuses a button with neither a label nor an emoji, and it
        // refuses the whole message with it — so the panel would stop posting
        // entirely over one field somebody cleared.
        const declaredBtn = (entry.buttons || []).find(b => b.id === id);
        const label = 'label' in one ? one.label : declaredBtn.label;
        const emoji = 'emoji' in one ? one.emoji : (declaredBtn.emoji || '');
        if (!label && !emoji) return { error: 'empty_button' };
        if (Object.keys(one).length) patch[id] = one;
      }
      next.buttons = patch;
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
  const before = store[guildId][key] || {};
  store[guildId][key] = {
    ...before, ...next,
    // Merged per button rather than replaced, so saving one button's colour
    // does not silently drop what was set on the one beside it.
    ...(next.buttons ? { buttons: { ...(before.buttons || {}), ...next.buttons } } : {}),
    ...(next.palette ? { palette: { ...(before.palette || {}), ...next.palette } } : {}),
  };
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
    // What each button is for, and the fixed id it routes on. The panel needs
    // both: the id to save against, and the description so somebody renaming
    // "Take Action" knows what pressing it will do.
    buttons: (entry.buttons || []).map(b => ({ id: b.id, does: b.does || '', ...b })),
    buttonStyles: BUTTON_STYLES,
    palette: entry.palette || null,
    defaults: entry.defaults,
  }));
}

module.exports = {
  CATALOGUE, FILE, LIMITS,
  catalogue, all, customised, styleFor, setStyle, resetStyle,
  build, fill, isOn, partsOf,
  buttonsFor, buildButtons, BUTTON_STYLES, BUTTON_LIMITS,
  paletteFor, PALETTE_KINDS,
};
