'use strict';

/**
 * modLogTheme.js — every embed in a server's mod log is dark.
 *
 * The mod log is written from a dozen places: sendModLog and postCustomLog,
 * the panel's audit entries, automod, purge, reports, giveaway alerts, join
 * and leave logs, buttons that edit their own log message, and whatever is
 * added next. Rather than set a colour in each (and miss one), this sits at
 * the one place they all pass through: sending or editing a message in the
 * channel configured as that server's mod log. Anything with embeds that
 * goes there gets the dark colour, whatever colour it was built with.
 *
 * install() wraps send on the text-capable channel classes, Message#edit,
 * and the component/modal interaction update(), once.
 */

const { readJson } = require('./jsonStorage');

const DARK = 0x111214;
const DONE = Symbol.for('quantbot.modLogTheme');

function isModLog(guildId, channelId, parentId) {
  if (!guildId || !channelId) return false;
  const id = readJson('config.json', {})[guildId]?.logsChannel;
  return !!id && (id === channelId || id === parentId);
}

/** A copy of the message options with every embed set to the dark colour. */
function darken(options) {
  if (!options || typeof options !== 'object' || !Array.isArray(options.embeds) || !options.embeds.length) return options;
  const { EmbedBuilder } = require('discord.js');
  const embeds = options.embeds.map(e => {
    try {
      if (!e) return e;
      if (typeof e.setColor === 'function' && e.data) return EmbedBuilder.from(e.toJSON ? e.toJSON() : e.data).setColor(DARK);
      if (typeof e.toJSON === 'function') return { ...e.toJSON(), color: DARK };   // a received Embed
      return { ...e, color: DARK };                                                 // plain object
    } catch { return e; }
  });
  return { ...options, embeds };
}

function wrap(proto, method, where) {
  if (!proto || typeof proto[method] !== 'function' || proto[method][DONE]) return false;
  const original = proto[method];
  const wrapped = function (options, ...rest) {
    try {
      const { guildId, channelId, parentId } = where(this) || {};
      if (isModLog(guildId, channelId, parentId)) options = darken(options);
    } catch { /* never block a send over a colour */ }
    return original.call(this, options, ...rest);
  };
  wrapped[DONE] = true;
  proto[method] = wrapped;
  return true;
}

function install() {
  const d = require('discord.js');
  const channelWhere = ch => ({ guildId: ch.guildId || ch.guild?.id, channelId: ch.id, parentId: ch.parentId });
  const n = [
    ...['TextChannel', 'NewsChannel', 'ThreadChannel', 'VoiceChannel', 'StageChannel'].map(k => wrap(d[k]?.prototype, 'send', channelWhere)),
    wrap(d.Message?.prototype, 'edit', m => ({ guildId: m.guildId, channelId: m.channelId, parentId: m.channel?.parentId })),
    ...['MessageComponentInteraction', 'ModalSubmitInteraction'].map(k => wrap(d[k]?.prototype, 'update', i => ({ guildId: i.guildId, channelId: i.channelId, parentId: i.channel?.parentId }))),
  ].filter(Boolean).length;
  return n;
}

module.exports = { install, darken, isModLog, DARK };
