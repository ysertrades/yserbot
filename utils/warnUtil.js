'use strict';

const { readJson, writeJson } = require('./jsonStorage');
const { sendModLog, dmUser } = require('./modLog');

/**
 * Records a warning case and applies the server's configured auto-punish
 * threshold, exactly like `/warn` does. Shared so automated sources (the
 * bad-word filter) feed into the same warning count and threshold as manual
 * `/warn` calls, instead of running a second, disconnected system.
 *
 * `moderator` is `{ id, tag }` — a real staff member for `/warn`, or a
 * synthetic `{ id: client.user.id, tag: 'Auto-Mod' }` for automated warns.
 */
async function issueWarning(guild, moderator, targetUser, member, reason) {
  const cases      = readJson('cases.json', {});
  const guildCases = cases[guild.id] || [];
  const caseId     = guildCases.length + 1;
  guildCases.push({ id: caseId, type: 'warn', userId: targetUser.id, userTag: targetUser.tag, moderatorId: moderator.id, moderatorTag: moderator.tag, reason, timestamp: Date.now() });
  cases[guild.id] = guildCases;
  writeJson('cases.json', cases);

  const warnCount = guildCases.filter(c => c.type === 'warn' && c.userId === targetUser.id).length;

  await dmUser(targetUser, 'warn', guild, reason, { caseId });
  await sendModLog(guild, 'warn', targetUser, moderator, reason, { caseId });

  let autoPunish = null;
  const config       = readJson('config.json', {});
  const warnSettings = config[guild.id]?.warnSettings;
  if (member && warnSettings?.threshold && warnCount >= warnSettings.threshold) {
    const action = warnSettings.action || 'kick';
    try {
      if (action === 'kick') {
        await member.kick(`Auto-punish: reached ${warnSettings.threshold} warnings`);
      } else if (action === 'ban') {
        await guild.members.ban(targetUser.id, { reason: `Auto-punish: reached ${warnSettings.threshold} warnings` });
      } else if (action === 'mute') {
        const duration = warnSettings.muteDuration || 3600000;
        await member.timeout(duration, `Auto-punish: reached ${warnSettings.threshold} warnings`);
      }
      autoPunish = { action, threshold: warnSettings.threshold };
    } catch { /* missing permissions / role hierarchy — warning itself still stands */ }
  }

  return { caseId, warnCount, autoPunish };
}

module.exports = { issueWarning };
