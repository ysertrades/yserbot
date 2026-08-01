'use strict';

/**
 * web/moderation.js
 *
 * The moderation surface, for the panel.
 *
 * Reports, the case log, per-member warnings and the settings that govern
 * them. All of it existed only as slash commands and channel messages, which
 * means a report is noticed when someone happens to be looking at the report
 * channel, and a member's history is only visible by running /warnings against
 * them one at a time.
 *
 * Acting on a report goes through utils/modActions — the same path /warn and
 * the report card's buttons use — so a case number, a DM and a mod-log entry
 * are produced identically wherever the decision was made.
 */

const { readJson, writeJson } = require('../utils/jsonStorage');
const reports = require('../utils/reports');
const modActions = require('../utils/modActions');
const { getAutoModSettings } = require('../utils/modConfig');
const { humanAge } = require('../utils/linkInsight');

const CASE_ICON = { warn: '⚠️', kick: '👢', ban: '🔨', timeout: '🔇', mute: '🔇', unban: '🔓', unmute: '🔊' };

/** When a Discord id was minted — every snowflake carries its own timestamp. */
function snowflakeTime(id) {
  try { return Number((BigInt(id) >> 22n) + 1420070400000n); }
  catch { return NaN; }
}

const nameOf = (guild, id, fallback) =>
  guild?.members?.cache?.get(id)?.displayName || fallback || id;

function describeReport(r, guild) {
  const history = reports.historyFor(r.guildId, r.targetId);
  const warns = modActions.warningsFor(r.guildId, r.targetId).length;
  return {
    id: r.id,
    targetId: r.targetId,
    targetName: nameOf(guild, r.targetId, r.targetTag),
    targetTag: r.targetTag,
    reporterName: nameOf(guild, r.reporterId, r.reporterTag),
    reason: r.reason,
    link: r.link,
    status: r.status,
    action: r.action,
    handledBy: r.handledBy,
    handledAt: r.handledAt,
    createdAt: r.createdAt,
    // Whether they are still here decides which actions are even possible.
    inServer: !!guild?.members?.cache?.get(r.targetId),
    accountAge: humanAge(snowflakeTime(r.targetId)),
    priorReports: history.total - (r.status === 'open' ? 1 : 0),
    priorActioned: history.actioned,
    warnings: warns,
  };
}

/** Everything the Moderation screen shows. */
function read(guildId, guild) {
  const config = readJson('config.json', {})[guildId] || {};
  const automod = getAutoModSettings(guildId);
  const cases = modActions.casesFor(guildId);

  // Newest first, and capped — the full log can run to thousands of entries
  // and nothing on screen can use them all.
  const recentCases = cases.slice(-30).reverse().map(c => ({
    id: c.id,
    type: c.type,
    icon: CASE_ICON[c.type] || '•',
    userId: c.userId,
    userName: nameOf(guild, c.userId, c.userTag),
    moderator: c.moderatorTag || 'unknown',
    reason: c.reason || '',
    at: c.timestamp || null,
  }));

  // Members with at least one warning, worst first — the list a moderator
  // actually wants, rather than one lookup at a time through /warnings.
  const byUser = new Map();
  for (const c of cases) {
    if (c.type !== 'warn') continue;
    const seen = byUser.get(c.userId) || { userId: c.userId, tag: c.userTag, count: 0, last: 0 };
    seen.count++;
    seen.last = Math.max(seen.last, c.timestamp || 0);
    seen.tag = c.userTag || seen.tag;
    byUser.set(c.userId, seen);
  }
  const warned = [...byUser.values()]
    .map(w => ({ ...w, name: nameOf(guild, w.userId, w.tag) }))
    .sort((a, b) => b.count - a.count || b.last - a.last);

  const warnSettings = config.warnSettings || {};

  return {
    reports: {
      open: reports.open(guildId).map(r => describeReport(r, guild)),
      handled: reports.handled(guildId, 15).map(r => describeReport(r, guild)),
      channelId: config.reportChannel || null,
      channel: (config.reportChannel && guild?.channels?.cache?.get(config.reportChannel)?.name) || null,
      roleId: config.reportRole || null,
    },
    cases: recentCases,
    caseTotal: cases.length,
    warned,
    warnSettings: {
      threshold: Number(warnSettings.threshold) || 0,
      action: warnSettings.action || 'kick',
      muteMinutes: Math.round((Number(warnSettings.muteDuration) || 3600000) / 60000),
    },
    filters: {
      badWords: !!automod.badWords,
      linkFilter: !!automod.linkFilter,
      mentionSpam: !!automod.mentionSpamProtection,
      customWords: automod.customWords || [],
    },
    logChannelId: config.logsChannel || null,
  };
}

/* ─── acting on a report ─────────────────────────────────────────────────── */

async function act(guildId, body, { client, session, guild }) {
  const id = String(body.reportId || '');
  const record = reports.get(id);
  // A report from another server must not be actionable here, however the id
  // was come by.
  if (!record || record.guildId !== guildId) return { error: 'unknown_report' };
  if (record.status !== 'open') return { error: 'already_handled', status: record.status };

  const action = String(body.action || '');
  const by = `${session.name} (control panel)`;

  if (action === 'dismiss') {
    reports.update(id, { status: 'dismissed', handledBy: by, handledAt: Date.now(), action: 'dismiss' });
    await strikeCard(guild, record, `✅ Dismissed by ${by}`, 0x95a5a6);
    return { ok: true, action: 'dismiss', targetTag: record.targetTag, targetId: record.targetId };
  }

  if (!modActions.ACTIONS[action]) return { error: 'bad_action' };

  // Falling back to what the report recorded rather than refusing outright:
  // a deleted or unreachable account is exactly the case where a ban still
  // needs to be possible, and the tag is only wanted for the case record.
  const fetched = await client.users?.fetch?.(record.targetId).catch(() => null);
  const targetUser = fetched || { id: record.targetId, tag: record.targetTag || record.targetId };
  const member = guild?.members?.cache?.get(record.targetId) || null;

  const minutes = Number(body.timeoutMinutes);
  const result = await modActions.apply({
    guild,
    moderator: { id: session.uid, tag: by },
    targetUser, member, action,
    reason: String(body.reason || '').trim().slice(0, 400) || `Report handled by ${session.name}`,
    durationMs: Number.isInteger(minutes) && minutes > 0 ? Math.min(minutes, 40320) * 60000 : 3600000,
  });

  if (!result.ok) return { error: result.error, detail: result.detail };

  reports.update(id, { status: 'actioned', handledBy: by, handledAt: Date.now(), action });
  await strikeCard(guild, record, `✅ Handled by ${by} — ${result.label}`, 0x2ecc71);

  return {
    ok: true, action, label: result.label, caseId: result.caseId,
    targetTag: record.targetTag, targetId: record.targetId,
  };
}

/** Marks the original card in the report channel as dealt with. */
async function strikeCard(guild, record, footer, colour) {
  try {
    if (!record.messageId) return;
    const channel = guild?.channels?.cache?.get(record.channelId);
    if (!channel?.messages?.fetch) return;
    const message = await channel.messages.fetch(record.messageId);
    const { EmbedBuilder } = require('discord.js');
    const updated = EmbedBuilder.from(message.embeds[0]).setColor(colour).setFooter({ text: footer });
    await message.edit({ embeds: [updated], components: [] });
  } catch { /* the card may be gone; the decision itself still stands */ }
}

/* ─── warnings ───────────────────────────────────────────────────────────── */

function clearWarnings(guildId, body, { guild }) {
  const userId = String(body.userId || '');
  if (!/^\d{5,25}$/.test(userId)) return { error: 'bad_user' };
  const removed = modActions.clearWarnings(guildId, userId);
  if (!removed) return { unchanged: true };
  return { ok: true, userId, removed, name: nameOf(guild, userId, userId) };
}

/* ─── settings ───────────────────────────────────────────────────────────── */

function saveWarnSettings(guildId, body) {
  const config = readJson('config.json', {});
  if (!config[guildId]) config[guildId] = {};
  const current = config[guildId].warnSettings || {};
  const next = { ...current };
  const changed = [];

  if ('threshold' in body) {
    const n = Number(body.threshold);
    if (!Number.isInteger(n) || n < 0 || n > 50) return { error: 'bad_threshold' };
    if (n !== (Number(current.threshold) || 0)) {
      // Zero is the off switch — a threshold of nothing would fire on the
      // first warning, which is not what "no auto-punish" should mean.
      if (n === 0) delete next.threshold;
      else next.threshold = n;
      changed.push(n === 0 ? 'auto-punish off' : `auto-punish at ${n} warnings`);
    }
  }
  if ('action' in body) {
    const a = String(body.action);
    if (!['kick', 'ban', 'mute'].includes(a)) return { error: 'bad_action' };
    if (a !== (current.action || 'kick')) { next.action = a; changed.push(`punishment ${a}`); }
  }
  if ('muteMinutes' in body) {
    const n = Number(body.muteMinutes);
    // Discord's own ceiling for a timeout is 28 days.
    if (!Number.isInteger(n) || n < 1 || n > 40320) return { error: 'bad_duration' };
    const ms = n * 60000;
    if (ms !== (Number(current.muteDuration) || 3600000)) { next.muteDuration = ms; changed.push(`mute ${n}m`); }
  }

  if (!changed.length) return { unchanged: true };
  config[guildId].warnSettings = next;
  writeJson('config.json', config);
  return { ok: true, changed };
}

module.exports = { read, act, clearWarnings, saveWarnSettings };
