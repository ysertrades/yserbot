'use strict';

const { Events } = require('discord.js');
const { isFeatureEnabled } = require('../utils/featureToggles');

module.exports = {
  name: Events.ThreadCreate,
  async execute(thread) {
    try {
      const guildId = thread.guild?.id;
      if (!guildId) return;
      if (!isFeatureEnabled(guildId, 'leveling')) return;
      const leveling = require('../utils/levelingEngine');
      leveling.handleThreadCreate(thread);
    } catch (err) {
      console.error('[XP threadCreate]', err);
    }
  },
};
