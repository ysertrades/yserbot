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

async function act(guildId, body, { client, session, guild }) {
  const id = String(body.reportId || '');
  const record = reports.get(id);
  if (!record || record.guildId !== guildId) return { error: 'unknown_report' };
  if (record.status !== 'open') return { error: 'already_handled', status: record.status };
  const action = String(body.action || '');
  const by = `${session.name} (control panel)`;
  if (action === 'dismiss') {
    reports.update(id, { status: 'dismissed', handledBy: by, handledAt: Date.now(), action: 'dismiss' });
    await strikeCard(guild, record, `Dismissed by ${by}`, 0x95a5a6);
    return { ok: true, action: 'dismiss', targetTag: record.targetTag, targetId: record.targetId };
  }
  if (!Object.hasOwn(modActions.ACTIONS, action)) return { error: 'bad_action' };
  const fetched = await client.users?.fetch?.(record.targetId).catch(() => null);
  const targetUser = fetched || { id: record.targetId, tag: record.targetTag || record.targetId };
  const member = guild?.members?.cache?.get(record.targetId) || null;
  const minutes = Number(body.timeoutMinutes);
  const result = await modActions.apply({
    guild, moderator: { id: session.uid, tag: by }, targetUser, member, action,
    reason: String(body.reason || '').trim().slice(0, 400) || `Report handled by ${session.name}`,
    durationMs: Number.isInteger(minutes) && minutes > 0 ? Math.min(minutes, 40320) * 60000 : 3600000,
  });
  if (!result.ok) return { error: result.error, detail: result.detail };
  reports.update(id, { status: 'actioned', handledBy: by, handledAt: Date.now(), action });
  await strikeCard(guild, record, `Handled by ${by} — ${result.label}`, 0x2ecc71);
  return { ok: true, action, label: result.label, caseId: result.caseId, targetTag: record.targetTag, targetId: record.targetId };
}

async function strikeCard(guild, record, footer, colour) {
  try {
    if (!record.messageId) return;
    const channel = guild?.channels?.cache?.get(record.channelId);
    if (!channel?.messages?.fetch) return;
    const message = await channel.messages.fetch(record.messageId);
    const { EmbedBuilder } = require('discord.js');
    const updated = EmbedBuilder.from(message.embeds[0]).setColor(colour).setFooter({ text: footer });
    await message.edit({ embeds: [updated], components: [] });
  } catch { /* */ }
}

function clearWarnings(guildId, body, { guild }) {
  const userId = String(body.userId || '');
  if (!/^\d{5,25}$/.test(userId)) return { error: 'bad_user' };
  const removed = modActions.clearWarnings(guildId, userId);
  if (!removed) return { unchanged: true };
  return { ok: true, userId, removed, name: nameOf(guild, userId, userId) };
}

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
      if (n === 0) delete next.threshold; else next.threshold = n;
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
    if (!Number.isInteger(n) || n < 1 || n > 40320) return { error: 'bad_duration' };
    const ms = n * 60000;
    if (ms !== (Number(current.muteDuration) || 3600000)) { next.muteDuration = ms; changed.push(`mute ${n}m`); }
  }
  if (!changed.length) return { unchanged: true };
  config[guildId].warnSettings = next;
  writeJson('config.json', config);
  return { ok: true, changed };
}

function saveAutoRole(guildId, body, { guild }) {
  const incoming = body.roleId;
  const config = readJson('config.json', {});
  if (!config[guildId]) config[guildId] = {};
  const current = config[guildId].autoRole || null;
  let value;
  if (incoming === null || incoming === '') value = null;
  else {
    if (typeof incoming !== 'string' || !guild?.roles?.cache?.has(incoming)) return { error: 'bad_role' };
    value = incoming;
  }
  if (value === current) return { unchanged: true };
  if (value) config[guildId].autoRole = value; else delete config[guildId].autoRole;
  writeJson('config.json', config);
  const roleName = value ? (guild.roles.cache.get(value)?.name || value) : null;
  return { ok: true, roleId: value, roleName, changed: [value ? `auto-role: ${roleName}` : 'auto-role turned off'] };
}

async function modAction(guildId, body, { client, session, guild }) {
  const action = String(body.action || '');
  if (!Object.hasOwn(modActions.ACTIONS, action)) return { error: 'bad_action' };
  const userId = String(body.userId || '').trim();
  if (!/^\d{5,20}$/.test(userId)) return { error: 'bad_user' };
  const reason = String(body.reason || '').trim().slice(0, 400) || `Actioned from control panel by ${session.name}`;
  const minutes = Number(body.timeoutMinutes);
  const durationMs = Number.isInteger(minutes) && minutes > 0 ? Math.min(minutes, 40320) * 60000 : 60 * 60000;
  const fetched = await client.users?.fetch?.(userId).catch(() => null);
  if (!fetched) return { error: 'unknown_user' };
  const member = guild?.members?.cache?.get(userId) || await guild?.members?.fetch?.(userId).catch(() => null);
  const by = `${session.name} (control panel)`;
  const result = await modActions.apply({
    guild, moderator: { id: session.uid, tag: by }, targetUser: fetched, member, action, reason, durationMs,
  });
  if (!result.ok) return { error: result.error, detail: result.detail, caseId: result.caseId };
  return { ok: true, action, label: result.label, caseId: result.caseId, targetId: fetched.id, targetTag: fetched.tag, warnCount: result.warnCount };
}

async function memberRole(guildId, body, { client, session, guild }) {
  const op = String(body.op || '').toLowerCase();
  if (op !== 'add' && op !== 'remove') return { error: 'bad_op' };
  const userId = String(body.userId || '').trim();
  const roleId = String(body.roleId || '').trim();
  if (!/^\d{5,20}$/.test(userId)) return { error: 'bad_user' };
  if (!/^\d{5,20}$/.test(roleId)) return { error: 'bad_role' };
  if (!guild?.roles?.cache?.has(roleId)) return { error: 'unknown_role' };
  const role = guild.roles.cache.get(roleId);
  if (role.managed || role.id === guild.id) return { error: 'role_not_assignable' };
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (!member) return { error: 'not_in_server' };
  try {
    if (op === 'add') await member.roles.add(roleId, `Panel role add by ${session.name}`);
    else await member.roles.remove(roleId, `Panel role remove by ${session.name}`);
  } catch (err) {
    return { error: 'discord_refused', detail: String(err.message || err).slice(0, 140) };
  }
  const roles = [...(member.roles?.cache?.values?.() || [])]
    .filter(r => r.id !== guild.id && !r.managed)
    .sort((a, b) => (b.position || 0) - (a.position || 0))
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor && r.hexColor !== '#000000' ? r.hexColor : null }));
  return { ok: true, op, userId, roleId, roleName: role.name, roles };
}

async function memberDm(guildId, body, { client, session, guild }) {
  const userId = String(body.userId || '').trim();
  const text = String(body.message || '').trim().slice(0, 1800);
  if (!/^\d{5,20}$/.test(userId)) return { error: 'bad_user' };
  if (!text) return { error: 'empty_message' };
  const user = await client.users?.fetch?.(userId).catch(() => null);
  if (!user) return { error: 'unknown_user' };
  try {
    await user.send({ content: text });
  } catch (err) {
    return { error: 'dm_failed', detail: String(err.message || err).slice(0, 140) };
  }
  return { ok: true, userId, tag: user.tag };
}

module.exports = { read, act, clearWarnings, saveWarnSettings, saveAutoRole, modAction, memberRole, memberDm };
