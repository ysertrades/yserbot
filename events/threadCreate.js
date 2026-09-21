'use strict';

const { Events } = require('discord.js');
const { isFeatureEnabled } = require('../utils/featureToggles');
const levelingEngine = require('../utils/levelingEngine');

module.exports = {
  name: Events.ThreadCreate,
  async execute(thread) {
    const guildId = thread.guild?.id;
    if (!guildId) return;
    if (!isFeatureEnabled(guildId, 'leveling')) return;
    try {
      await levelingEngine.processThreadCreate(thread);
    } catch (err) {
      console.warn('[Leveling] threadCreate:', err.message || err);
    }
  },
};
