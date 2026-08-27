'use strict';

/**
 * featureToggles.js
 *
 * A per-guild on/off switch for whole modules of the bot — not the wording
 * of one message (that's messageStyle.js), the module itself: /work stops
 * working, XP stops being earned, the news feed stops posting.
 *
 * Grouped coarsely on purpose. A server deciding "no casino here" is one
 * flip, not seven individual command lookups — and the group is what a
 * moderator actually thinks in when they say "turn off the economy stuff."
 *
 * Two things read this file:
 *   - `commands`: gated centrally in events/interactionCreate.js, right next
 *     to the existing permission check — one command name maps to at most
 *     one group.
 *   - `passive`: gated individually, at the few places in the bot something
 *     happens without a slash command at all (XP on a message, the news
 *     feed's own scheduler, a join card). Each call site checks the group
 *     key directly with isFeatureEnabled().
 *
 * A command not listed here is never gated — /help, /config and the like
 * stay reachable no matter what's switched off, on purpose: turning
 * everything off must never lock an admin out of turning it back on.
 *
 * Storage: config[guildId].features[key] === false is the only state kept.
 * Enabled is the default and is never written — a guild that has never
 * touched this looks identical to one where every switch is deliberately
 * on, and the file doesn't grow for servers that never open this screen.
 */

const { readJson, writeJson } = require('./jsonStorage');

const FEATURE_GROUPS = [
  {
    key: 'economy', label: 'Economy',
    description: 'Wallet, bank, daily/weekly pay, jobs, the shop, transfers, and /rob.',
    commands: ['bank', 'daily', 'give-coins', 'rob', 'shop', 'shopsettings', 'transfer', 'work', 'jobs', 'lottery'],
  },
  {
    key: 'casino', label: 'Casino',
    description: 'Every casino game and the coin-giveaway wheel.',
    commands: ['casino', 'casino-settings', 'coinsgiveaway'],
  },
  {
    key: 'fishing_mining', label: 'Fishing & Mining',
    description: '/fish and /mine.',
    commands: ['fish', 'mine'],
  },
  {
    key: 'trivia', label: 'Trivia',
    description: 'The /trivia game.',
    commands: ['trivia'],
  },
  {
    key: 'leveling', label: 'Leveling & Ranks',
    description: 'XP on messages, level-up announcements, /rank, /leaderboard, and level roles.',
    commands: ['rank', 'leaderboard', 'levelsettings'],
    passive: true,
  },
  {
    key: 'cards', label: 'Collectible Cards',
    description: 'Random card drops in chat and the /cards collection.',
    commands: ['cards', 'cardsettings'],
    passive: true,
  },
  {
    key: 'tickets', label: 'Support Tickets',
    description: 'The /ticket panel and ticket channels.',
    commands: ['ticket'],
  },
  {
    key: 'giveaways', label: 'Giveaways',
    description: 'The /giveaway system.',
    commands: ['giveaway'],
  },
  {
    key: 'verification', label: 'Member Verification',
    description: 'The /verify gate.',
    commands: ['verify'],
  },
  {
    key: 'newsfeed', label: 'Market News Feed',
    description: 'Live Financial Juice headlines — the /newsfeed command and the scheduled poster both stop.',
    commands: ['newsfeed'],
    passive: true,
  },
  {
    key: 'econ_calendar', label: 'Economic Calendar',
    description: 'Release reminders — the /econcal command and the scheduled poster both stop.',
    commands: ['econcal'],
    passive: true,
  },
  {
    key: 'risk_tools', label: 'Risk Tools',
    description: 'The /risk position-size calculator.',
    commands: ['risk'],
  },
  {
    key: 'moderation_actions', label: 'Moderation Actions',
    description: 'Warn, kick, ban, mute/timeout, purge, and channel lock.',
    commands: ['warn', 'warnings', 'clearwarnings', 'warn-settings', 'kick', 'ban', 'unban', 'mute', 'unmute', 'purge', 'lock', 'unlock'],
  },
  {
    key: 'automod', label: 'Auto-Moderation',
    description: 'Bad-word and link filtering on every message.',
    commands: ['automod'],
    passive: true,
  },
  {
    key: 'reports', label: 'User Reports',
    description: 'The /report system.',
    commands: ['report'],
  },
  {
    key: 'polls', label: 'Polls',
    description: 'The /poll command.',
    commands: ['poll'],
  },
  {
    key: 'autoreply', label: 'Auto-Responder',
    description: 'Keyword-triggered replies to messages.',
    commands: ['autoreply'],
    passive: true,
  },
  {
    key: 'scheduler', label: 'Scheduled Posts',
    description: 'The /schedule system.',
    commands: ['schedule'],
  },
  {
    key: 'welcome_leave', label: 'Welcome & Leave Messages',
    description: 'The join card, the join coin bonus, and the leave message. No command of its own — set the channels in Settings.',
    commands: [],
    passive: true,
  },
];

const COMMAND_TO_GROUP = new Map();
for (const g of FEATURE_GROUPS) for (const c of g.commands) COMMAND_TO_GROUP.set(c, g.key);

/** Which feature group (if any) gates this slash command. */
function groupForCommand(commandName) {
  return COMMAND_TO_GROUP.get(commandName) || null;
}

/** Enabled is the default — only an explicit `false` turns a group off. */
function isFeatureEnabled(guildId, key) {
  const flags = readJson('config.json', {})[guildId]?.features;
  return flags?.[key] !== false;
}

function readFlags(guildId) {
  return readJson('config.json', {})[guildId]?.features || {};
}

/**
 * @param {string} guildId
 * @param {Record<string, boolean>} updates - group key -> desired enabled state
 * @returns {{ok: true, changed: string[]}}
 */
function setFeatures(guildId, updates) {
  const config = readJson('config.json', {});
  if (!config[guildId]) config[guildId] = {};
  if (!config[guildId].features) config[guildId].features = {};
  const flags = config[guildId].features;
  const known = new Set(FEATURE_GROUPS.map(g => g.key));
  const changed = [];

  for (const [key, enabled] of Object.entries(updates)) {
    if (!known.has(key)) continue;
    const was = flags[key] !== false;
    const want = !!enabled;
    if (was === want) continue;
    if (want) delete flags[key]; else flags[key] = false;
    const label = FEATURE_GROUPS.find(g => g.key === key)?.label || key;
    changed.push(`${label} ${want ? 'on' : 'off'}`);
  }

  if (!changed.length) return { unchanged: true };
  if (Object.keys(flags).length === 0) delete config[guildId].features;
  writeJson('config.json', config);
  return { ok: true, changed };
}

module.exports = {
  FEATURE_GROUPS, groupForCommand, isFeatureEnabled, readFlags, setFeatures,
};
