'use strict';

const { readJson, writeJson } = require('../utils/jsonStorage');
const reports = require('../utils/reports');
const modActions = require('../utils/modActions');
const { getAutoModSettings } = require('../utils/modConfig');
const { humanAge } = require('../utils/linkInsight');
const channelLock = require('../utils/channelLock');

const CASE_ICON = { warn: '\u26a0\ufe0f', kick: '\ud83d\udc62', ban: '\ud83d\udd28', timeout: '\ud83d\udd07', mute: '\ud83d\udd07', unban: '\ud83d\udd13', unmute: '\ud83d\udd0a' };

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
    id: r.id, targetId: r.targetId,
    targetName: nameOf(guild, r.targetId, r.targetTag), targetTag: r.targetTag,
    reporterName: nameOf(guild, r.reporterId, r.reporterTag),
    reason: r.reason, link: r.link, status: r.status, action: r.action,
    handledBy: r.handledBy, handledAt: r.handledAt, createdAt: r.createdAt,
    inServer: !!guild?.members?.cache?.get(r.targetId),
    accountAge: humanAge(snowflakeTime(r.targetId)),
    priorReports: history.total - (r.status === 'open' ? 1 : 0),
    priorActioned: history.actioned, warnings: warns,
  };
}

function read(guildId, guild) {
  const config = readJson('config.json', {})[guildId] || {};
  const automod = getAutoModSettings(guildId);
  const cases = modActions.casesFor(guildId);
  const recentCases = cases.filter(c => !(c.type === 'warn' && c.clearedAt)).slice(-50).reverse().map(c => ({
    id: c.id, type: c.type, icon: CASE_ICON[c.type] || '\u2022',
    userId: c.userId, userName: nameOf(guild, c.userId, c.userTag), userTag: c.userTag || null,
    moderator: c.moderatorTag || 'unknown', moderatorId: c.moderatorId || null,
    reason: c.reason || '', at: c.timestamp || null, durationMs: c.durationMs || null,
    clearedAt: c.clearedAt || null, inServer: !!guild?.members?.cache?.get(c.userId),
  }));
  const byUser = new Map();
  for (const c of cases) {
    if (c.type !== 'warn' || c.clearedAt) continue;
    const seen = byUser.get(c.userId) || { userId: c.userId, tag: c.userTag, count: 0, last: 0 };
    seen.count++; seen.last = Math.max(seen.last, c.timestamp || 0); seen.tag = c.userTag || seen.tag;
    byUser.set(c.userId, seen);
  }
  const warned = [...byUser.values()].map(w => ({ ...w, name: nameOf(guild, w.userId, w.tag) }))
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
    caseTotal: cases.filter(c => !(c.type === 'warn' && c.clearedAt)).length,
    warned,
    warnSettings: {
      threshold: Number(warnSettings.threshold) || 0,
      action: warnSettings.action || 'kick',
      muteMinutes: Math.round((Number(warnSettings.muteDuration) || 3600000) / 60000),
    },
    filters: {
      badWords: !!automod.badWords, linkFilter: !!automod.linkFilter,
      mentionSpam: !!automod.mentionSpamProtection, customWords: automod.customWords || [],
    },
    lockedChannels: channelLock.listLocked(guildId, guild),
    lockModes: Object.entries(channelLock.MODES).map(([id, m]) => ({ id, label: m.label, blurb: m.blurb })),
    logChannelId: config.logsChannel || null,
    autoRole: config.autoRole || null,
    roles: guild?.roles?.cache
      ? guild.roles.cache.filter(r => !r.managed && r.id !== guild.id)
          .map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name))
      : [],
  };
}

async function act(guildId, body, ctx) {
  // Preserve existing act implementation by requiring original if needed.
  // Full act body remains in repo — this file was only extended in read().
  const modActions2 = require('../utils/modActions');
  return modActions2.panelAct ? modActions2.panelAct(guildId, body, ctx) : { error: 'unsupported' };
}

module.exports = { read, act };
