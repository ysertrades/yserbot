'use strict';

const { readJson, writeJson } = require('./jsonStorage');

const FILE = 'whop.json';
const API = 'https://api.whop.com/api/v1';
const UA = 'QuantLabBot/1.0 (+https://quantlab.bot)';

const DEFAULTS = {
  enabled: false,
  apiKey: null,
  companyId: null,
  companyRoute: null,
  companyTitle: null,
  pollMinutes: 1,
  onlyVideos: true,
  maxPerCheck: 3,
  buttonLabel: 'Open course',
  catalog: [],
  apps: [],
  log: [],
  lastScanAt: 0,
  lastError: null,
};

function getSettings(guildId) {
  const stored = readJson(FILE, {})[guildId] || {};
  let log = Array.isArray(stored.log) ? stored.log : null;
  if (!log && Array.isArray(stored.courses)) {
    log = stored.courses.filter(c => c.selected).map(c => ({
      id: c.id,
      title: c.title,
      cover: c.cover || null,
      experienceId: c.experienceId || null,
      channelId: stored.channelId || null,
      mentionRoleId: stored.mentionRoleId || null,
      known: {},
      baselined: false,
      addedAt: Date.now(),
    }));
  }
  if (!log) log = [];
  return {
    ...DEFAULTS,
    ...stored,
    catalog: Array.isArray(stored.catalog) ? stored.catalog : (Array.isArray(stored.courses) ? stored.courses : []),
    apps: Array.isArray(stored.apps) ? stored.apps : [],
    log,
    pollMinutes: Math.min(120, Math.max(1, Number(stored.pollMinutes) || 1)),
    maxPerCheck: Math.min(10, Math.max(1, Number(stored.maxPerCheck) || 3)),
    buttonLabel: (stored.buttonLabel || DEFAULTS.buttonLabel).slice(0, 80),
  };
}
