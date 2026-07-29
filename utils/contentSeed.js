'use strict';

/**
 * contentSeed.js
 *
 * Idempotently seeds the starter shop catalog and the economy-showcase
 * embed template into every guild the bot is in, once on startup. This
 * runs inside the live process against whatever storage backend
 * jsonStorage/mongoStorage actually resolves to (MongoDB in production),
 * which is the only way to guarantee the seed lands where the bot is
 * really reading from — writing the same data directly into this repo's
 * data/*.json files only affects the local file-storage fallback, not a
 * separately-running production database.
 *
 * Every entry is only added if missing (checked by id/template name), so
 * this never overwrites a price an admin already changed via
 * /shopsettings, and re-runs on every restart are always safe.
 */

const { readJson, writeJson } = require('./jsonStorage');

const SHOP_FILE   = 'shop.json';
const EMBEDS_FILE = 'embeds.json';
const HOUR = 60 * 60 * 1000;

const STARTER_ITEMS = {
  coin_boost_bronze:   { name: 'Bronze Coin Boost', price: 2000,  type: 'coin_boost',      emoji: '🥉', description: '1.5× earnings from work, jobs, fishing, mining, trivia & daily', multiplier: 1.5, durationMs: 4 * HOUR },
  coin_boost_silver:   { name: 'Silver Coin Boost', price: 8000,  type: 'coin_boost',      emoji: '🥈', description: '1.75× earnings from work, jobs, fishing, mining, trivia & daily', multiplier: 1.75, durationMs: 4 * HOUR },
  coin_boost_gold:     { name: 'Gold Coin Boost',   price: 20000, type: 'coin_boost',      emoji: '🥇', description: '2× earnings from work, jobs, fishing, mining, trivia & daily', multiplier: 2, durationMs: 4 * HOUR },
  coin_boost_platinum: { name: 'Platinum Coin Boost', price: 50000, type: 'coin_boost',    emoji: '💠', description: '2.5× earnings from work, jobs, fishing, mining, trivia & daily', multiplier: 2.5, durationMs: 3 * HOUR },
  vip_casino_pass:     { name: 'VIP Casino Pass',   price: 30000, type: 'vip_casino_pass', emoji: '👑', description: 'Doubles your personal casino max bet', multiplier: 2, durationMs: 6 * HOUR },
  badge_star:          { name: 'Rising Star',       price: 5000,  type: 'badge', emoji: '⭐', description: 'A shiny star badge for your /rank card', badgeIcon: 'star' },
  badge_shield:        { name: 'Trusted Trader',    price: 10000, type: 'badge', emoji: '🛡️', description: 'A shield badge for your /rank card', badgeIcon: 'shield' },
  badge_flame:         { name: 'On Fire',           price: 15000, type: 'badge', emoji: '🔥', description: 'A flame badge for your /rank card', badgeIcon: 'flame' },
  badge_crown:         { name: 'VIP Status',        price: 25000, type: 'badge', emoji: '👑', description: 'A crown badge for your /rank card', badgeIcon: 'crown' },
  badge_diamond:       { name: 'Diamond Hands',     price: 40000, type: 'badge', emoji: '💎', description: 'A diamond badge for your /rank card', badgeIcon: 'diamond' },
  mystery_box:         { name: 'Mystery Box',       price: 15000, type: 'mystery_box', emoji: '🎁', description: 'Could be a dud, could be a 50,000 coin jackpot!' },
  cooldown_skip:       { name: 'Cooldown Skip',     price: 25000, type: 'cooldown_skip', emoji: '⏩', description: 'Instantly resets your fish, mine, trivia, work, jobs & casino cooldowns (2 min cooldown on this item itself)' },
};

const ECONOMY_SHOWCASE_TEMPLATE = {
  embeds: [{
    title: null,
    description: 'Every way to earn, play, and spend coins on **YSER Flow** — fishing, mining, trivia, daily rewards, jobs, the bank, the shop, casino games, and the daily lottery. Use `/help` for the full command list.',
    color: '#5AC8AA',
    footer: 'YSER Flow Economy',
    footerIcon: null,
    thumbnail: null,
    image: 'dynamic:economyShowcase',
    fields: [],
    titleUrl: null,
    authorName: null,
    authorIcon: null,
    authorUrl: null,
    timestamp: false,
  }],
};

function seedShopDefaults() {
  const data = readJson(SHOP_FILE, {});
  let changed = false;

  for (const guildId of Object.keys(data)) {
    if (!data[guildId].items) data[guildId].items = {};
    for (const [id, item] of Object.entries(STARTER_ITEMS)) {
      if (data[guildId].items[id]) continue;
      data[guildId].items[id] = { ...item };
      changed = true;
    }
  }

  if (changed) writeJson(SHOP_FILE, data);
  return changed;
}

function seedEconomyShowcaseTemplate() {
  const all = readJson(EMBEDS_FILE, {});
  let changed = false;

  for (const guildId of Object.keys(all)) {
    if (all[guildId]['economy-showcase']) continue;
    all[guildId]['economy-showcase'] = JSON.parse(JSON.stringify(ECONOMY_SHOWCASE_TEMPLATE));
    changed = true;
  }

  if (changed) writeJson(EMBEDS_FILE, all);
  return changed;
}

// Guilds that have never had *any* config/shop/embed activity won't have a
// key in shop.json/embeds.json yet, so seeding from those files' existing
// keys alone would skip a genuinely brand-new guild — bootstrap one from
// the client's guild list too.
function ensureGuildEntries(client) {
  const shop = readJson(SHOP_FILE, {});
  const embeds = readJson(EMBEDS_FILE, {});
  let shopChanged = false, embedsChanged = false;

  for (const guild of client.guilds.cache.values()) {
    if (!shop[guild.id]) { shop[guild.id] = { items: {} }; shopChanged = true; }
    if (!embeds[guild.id]) { embeds[guild.id] = {}; embedsChanged = true; }
  }

  if (shopChanged) writeJson(SHOP_FILE, shop);
  if (embedsChanged) writeJson(EMBEDS_FILE, embeds);
}

function seedDefaultContent(client) {
  ensureGuildEntries(client);
  const shopSeeded  = seedShopDefaults();
  const embedSeeded = seedEconomyShowcaseTemplate();
  if (shopSeeded)  console.log('[CONTENT SEED] Added missing starter shop items.');
  if (embedSeeded) console.log('[CONTENT SEED] Added missing economy-showcase embed template.');
}

module.exports = { seedDefaultContent, STARTER_ITEMS, ECONOMY_SHOWCASE_TEMPLATE };
