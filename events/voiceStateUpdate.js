'use strict';

const { Events } = require('discord.js');
const { isFeatureEnabled } = require('../utils/featureToggles');
const levelingEngine = require('../utils/levelingEngine');

// guildId:userId -> { channelId, lastTick }
const voiceSessions = new Map();

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    try {
      const guild = newState.guild || oldState.guild;
      if (!guild) return;
      const guildId = guild.id;
      if (!isFeatureEnabled(guildId, 'leveling')) return;

      const member = newState.member || oldState.member;
      if (!member || member.user?.bot) return;
      if (levelingEngine.memberHasNoXpRole(member, levelingEngine.ensureGuild(levelingEngine.loadAll(), guildId).settings)) {
        voiceSessions.delete(`${guildId}:${member.id}`);
        return;
      }

      const key = `${guildId}:${member.id}`;
      const joined = newState.channelId && !newState.deaf && !newState.selfDeaf && !newState.suppress;
      const left = !newState.channelId || newState.deaf || newState.selfDeaf;

      if (joined) {
        voiceSessions.set(key, { channelId: newState.channelId, lastTick: Date.now() });
      } else if (left) {
        voiceSessions.delete(key);
      } else if (newState.channelId) {
        const s = voiceSessions.get(key);
        if (s) s.channelId = newState.channelId;
        else voiceSessions.set(key, { channelId: newState.channelId, lastTick: Date.now() });
      }
    } catch (err) {
      console.warn('[Leveling] voiceStateUpdate:', err.message || err);
    }
  },
};

// Background ticker — awards ~1 minute of presence
if (!global.__quantVoiceXpTicker) {
  global.__quantVoiceXpTicker = setInterval(() => {
    try {
      for (const [key, sess] of voiceSessions.entries()) {
        const [guildId, userId] = key.split(':');
        const now = Date.now();
        if (now - (sess.lastTick || 0) < 55_000) continue;
        sess.lastTick = now;
        const r = levelingEngine.awardVoiceTick(guildId, userId, sess.channelId);
        if (r?.ok && r.levelsGained?.length) {
          // level-up announce is handled by callers elsewhere when present
        }
      }
    } catch (e) {
      /* ignore ticker errors */
    }
  }, 30_000);
  // Allow process exit in tests
  if (global.__quantVoiceXpTicker.unref) global.__quantVoiceXpTicker.unref();
}
