'use strict';

/**
 * modEmbed.js
 *
 * The small card a moderation action leaves behind in the channel.
 *
 * These used to be full-size embeds: a title with an emoji, an author line
 * carrying the server name, the person as a mention, then Reason, Case and
 * Total Warns as separate fields, and a footer with the server name again and
 * a timestamp. Nine lines to say somebody was warned, most of it repeating
 * what the rest of the message already said — the case number is in the mod
 * log and in /cases, and Discord puts the time next to the message anyway.
 *
 * So: the person's avatar and what happened on one line, the reason on the
 * next, and nothing else.
 *
 *     ⬤  Mike has been warned
 *        Reason: posted an invite
 *
 * The wording and the colour are no longer written here. They live in the
 * message catalogue (utils/messageStyle.js) so a server can change them from
 * the panel's Appearance screen; the table below is what a guild sees before
 * it has changed anything, and the fallback for anywhere a guild id is not to
 * hand.
 *
 * This is only for the acknowledgement in the channel. The mod-log entry and
 * the report card stay as they are — those are the record, and a record is
 * meant to carry its detail.
 */

const { EmbedBuilder } = require('discord.js');
const messageStyle = require('./messageStyle');

/**
 * What each action reads as, and the colour of the bar down the side.
 *
 * The colour is the one thing worth keeping from the old card: it is free —
 * it costs no height — and it tells a warning apart from a ban at a glance in
 * a busy channel.
 */
const NEUTRAL = 0x4C7DFF;

const ACTIONS = {
  warn:    { done: 'has been warned',            color: 0xF1C40F, key: 'mod.warn' },
  kick:    { done: 'has been kicked',            color: 0xE67E22, key: 'mod.kick' },
  ban:     { done: 'has been banned',            color: 0xE74C3C, key: 'mod.ban' },
  unban:   { done: 'has been unbanned',          color: 0x2ECC71, key: 'mod.unban' },
  timeout: { done: 'has been timed out',         color: 0x9B59B6, key: 'mod.mute' },
  mute:    { done: 'has been timed out',         color: 0x9B59B6, key: 'mod.mute' },
  unmute:  { done: 'can talk again',             color: 0x2ECC71, key: 'mod.unmute' },
  warnclear: { done: 'has a clean slate',        color: 0x2ECC71, key: 'mod.warnclear' },
  purge:     { done: 'is being cleaned up after', color: NEUTRAL, key: 'mod.purge' },
  purged:    { done: 'had messages cleared',      color: 0x2ECC71, key: 'mod.purged' },
  levelup:   { done: 'levelled up',               color: 0x3498DB, key: 'member.levelup' },
};

/** The catalogue key an action name maps to, if it has one. */
function keyFor(action) {
  return Object.hasOwn(ACTIONS, action) ? ACTIONS[action].key : null;
}

/**
 * The card itself.
 *
 * @param {object} opts
 *   title    — the single line at the top, beside the icon
 *   iconURL  — usually the member's avatar; the server's for a channel action
 *   reason   — shown as **Reason:** …, omitted entirely when there is not one
 *   note     — anything that genuinely cannot be left out, on its own line
 *   color
 */
function actionCard({ title, iconURL, reason, note, color = NEUTRAL }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: String(title).slice(0, 256), iconURL: iconURL || undefined });

  const lines = [];
  if (reason) lines.push(`**Reason:** ${String(reason).slice(0, 900)}`);
  if (note) lines.push(note);
  if (lines.length) embed.setDescription(lines.join('\n'));
  return embed;
}

/**
 * The card for something done to a member.
 *
 * The display name rather than a mention: a mention in an embed renders as a
 * blue pill that wraps onto its own line on a phone, which is most of what
 * made the old card tall.
 *
 * `guild` is what lets a server's own wording be used. It is optional and
 * falls back to the member's — a card is never worth losing over a missing
 * argument, so without one the shipped wording is used.
 */
function memberAction({ guild, user, member, action, reason, note, tokens = {} }) {
  const meta = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  const name = member?.displayName || user?.username || user?.tag || 'Someone';
  const icon = (member ?? user)?.displayAvatarURL?.({ size: 64 }) || null;
  const g = guild ?? member?.guild ?? null;

  const key = keyFor(action);
  if (g?.id && key) {
    const built = messageStyle.build(g.id, key, {
      iconURL: icon,
      tokens: { user: name, server: g.name || '', reason: reason || '', ...tokens },
    });
    // null means the server switched this message off. Only the level-up can
    // be switched off, and its one caller checks first — but if a future entry
    // gains a switch, falling back is safer than returning null into an
    // `embeds: [...]`, which Discord rejects outright.
    if (built) {
      if (note) {
        const current = built.data.description || '';
        try { built.setDescription(`${current}${current ? '\n' : ''}${note}`.slice(0, 4096)); } catch {}
      }
      return built;
    }
  }

  return actionCard({
    title: `${name} ${meta ? meta.done : action}`,
    iconURL: icon,
    reason,
    note,
    color: meta ? meta.color : NEUTRAL,
  });
}

/**
 * The card for something done to a channel or to the server, which has no
 * member to show an avatar for.
 */
function serverAction({ guild, title, reason, note, color = NEUTRAL }) {
  return actionCard({
    title,
    iconURL: guild?.iconURL?.({ size: 64 }) || null,
    reason, note, color,
  });
}

/**
 * The colour a server has set for one action, as a number.
 *
 * The mod-log entry and the DM borrow it rather than carrying their own, so
 * changing "warnings are amber" in the panel changes all three at once instead
 * of leaving the log a different colour from the card it belongs to.
 */
function colorFor(guildId, action) {
  const meta = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  const key = keyFor(action);
  if (guildId && key) {
    const hex = messageStyle.styleFor(guildId, key)?.color;
    const n = parseInt(String(hex || '').replace('#', ''), 16);
    if (Number.isFinite(n)) return n;
  }
  return meta ? meta.color : NEUTRAL;
}

module.exports = { actionCard, memberAction, serverAction, colorFor, keyFor, ACTIONS };
