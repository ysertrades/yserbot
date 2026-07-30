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
  coin_boost_bronze:   { name: 'Bronze Coin Boost', price: 2000,  type: 'coin_boost',      emoji: '🥉', description: '1.5× earnings from work, jobs, fishing, mining, trivia & daily (1 hour)', multiplier: 1.5, durationMs: 1 * HOUR },
  coin_boost_silver:   { name: 'Silver Coin Boost', price: 8000,  type: 'coin_boost',      emoji: '🥈', description: '1.75× earnings from work, jobs, fishing, mining, trivia & daily (1 hour)', multiplier: 1.75, durationMs: 1 * HOUR },
  coin_boost_gold:     { name: 'Gold Coin Boost',   price: 20000, type: 'coin_boost',      emoji: '🥇', description: '2× earnings from work, jobs, fishing, mining, trivia & daily (1 hour)', multiplier: 2, durationMs: 1 * HOUR },
  coin_boost_platinum: { name: 'Platinum Coin Boost', price: 50000, type: 'coin_boost',    emoji: '💠', description: '2.5× earnings from work, jobs, fishing, mining, trivia & daily (1 hour)', multiplier: 2.5, durationMs: 1 * HOUR },
  vip_casino_pass:     { name: 'VIP Casino Pass',   price: 30000, type: 'vip_casino_pass', emoji: '👑', description: 'Doubles your personal casino max bet', multiplier: 2, durationMs: 6 * HOUR },
  badge_star:          { name: 'Rising Star',       price: 5000,  type: 'badge', emoji: '⭐', description: 'A shiny star badge for your /rank card', badgeIcon: 'star' },
  badge_shield:        { name: 'Trusted Trader',    price: 10000, type: 'badge', emoji: '🛡️', description: 'A shield badge for your /rank card', badgeIcon: 'shield' },
  badge_flame:         { name: 'On Fire',           price: 15000, type: 'badge', emoji: '🔥', description: 'A flame badge for your /rank card', badgeIcon: 'flame' },
  badge_crown:         { name: 'VIP Status',        price: 25000, type: 'badge', emoji: '👑', description: 'A crown badge for your /rank card', badgeIcon: 'crown' },
  badge_diamond:       { name: 'Diamond Hands',     price: 40000, type: 'badge', emoji: '💎', description: 'A diamond badge for your /rank card', badgeIcon: 'diamond' },
  mystery_box:         { name: 'Mystery Box',       price: 15000, type: 'mystery_box', emoji: '🎁', description: 'Could be a dud, could be a 50,000 coin jackpot!' },
  cooldown_skip:       { name: 'Cooldown Skip',     price: 25000, type: 'cooldown_skip', emoji: '⏩', description: 'For 2 minutes, bypasses cooldowns on fishing, mining, trivia, work, jobs, casino games & the wheel\'s daily spin cap', durationMs: 2 * 60 * 1000 },
};

// A couple of these items' durations changed after they'd already been
// seeded into live guilds (seedShopDefaults() only fills in items that
// don't exist yet, so it never touches one already there) — this forces
// exactly the durationMs/description fields on these known ids back in
// sync with the policy above, without touching anything an admin actually
// customized (price, name, multiplier, etc.) on those same items.
const DURATION_MIGRATIONS = {
  coin_boost_bronze:   { durationMs: STARTER_ITEMS.coin_boost_bronze.durationMs, description: STARTER_ITEMS.coin_boost_bronze.description },
  coin_boost_silver:   { durationMs: STARTER_ITEMS.coin_boost_silver.durationMs, description: STARTER_ITEMS.coin_boost_silver.description },
  coin_boost_gold:     { durationMs: STARTER_ITEMS.coin_boost_gold.durationMs, description: STARTER_ITEMS.coin_boost_gold.description },
  coin_boost_platinum: { durationMs: STARTER_ITEMS.coin_boost_platinum.durationMs, description: STARTER_ITEMS.coin_boost_platinum.description },
  cooldown_skip:       { durationMs: STARTER_ITEMS.cooldown_skip.durationMs, description: STARTER_ITEMS.cooldown_skip.description },
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

const REPORT_GUIDE_TEMPLATE = {
  embeds: [{
    title: null,
    description: 'Run `/report` any time you need to flag a member to the mod team — pick the user, a reason, and (optionally) a link, then submit.',
    color: '#E74C3C',
    footer: 'YSER Flow Moderation',
    footerIcon: null,
    thumbnail: null,
    image: 'dynamic:reportGuide',
    fields: [],
    titleUrl: null,
    authorName: null,
    authorIcon: null,
    authorUrl: null,
    timestamp: false,
  }],
};

const NYSE_OPEN_TEMPLATE = {
  embeds: [{
    title: null,
    description: null,
    color: '#2ECC71',
    footer: null,
    footerIcon: null,
    thumbnail: null,
    image: 'dynamic:nyseOpen',
    fields: [],
    titleUrl: null,
    authorName: null,
    authorIcon: null,
    authorUrl: null,
    timestamp: false,
  }],
};

const RISK_GUIDE_TEMPLATE = {
  embeds: [{
    title: null,
    description: null,
    color: '#3498DB',
    footer: null,
    footerIcon: null,
    thumbnail: null,
    image: 'dynamic:riskGuide',
    fields: [],
    titleUrl: null,
    authorName: null,
    authorIcon: null,
    authorUrl: null,
    timestamp: false,
  }],
};

const NEWSFEED_GUIDE_TEMPLATE = {
  embeds: [{
    title: null,
    description: null,
    color: '#1D9BF0',
    footer: null,
    footerIcon: null,
    thumbnail: null,
    image: 'dynamic:newsfeedGuide',
    fields: [],
    titleUrl: null,
    authorName: null,
    authorIcon: null,
    authorUrl: null,
    timestamp: false,
  }],
};

const TRADINGVIEW_BANNER_TEMPLATE = {
  embeds: [{
    title: null,
    description: null,
    color: '#2962FF',
    footer: null,
    footerIcon: null,
    thumbnail: null,
    image: 'dynamic:tradingViewBanner',
    fields: [],
    titleUrl: null,
    authorName: null,
    authorIcon: null,
    authorUrl: null,
    timestamp: false,
  }],
};

const WHOP_BANNER_TEMPLATE = {
  embeds: [{
    title: null,
    description: null,
    color: '#16DE80',
    footer: null,
    footerIcon: null,
    thumbnail: null,
    image: 'dynamic:whopBanner',
    fields: [],
    titleUrl: null,
    authorName: null,
    authorIcon: null,
    authorUrl: null,
    timestamp: false,
  }],
};

const TEMPLATE_SEEDS = {
  'economy-showcase': ECONOMY_SHOWCASE_TEMPLATE,
  'report-guide':      REPORT_GUIDE_TEMPLATE,
  'nyse-open':         NYSE_OPEN_TEMPLATE,
  'risk-guide':        RISK_GUIDE_TEMPLATE,
  'newsfeed-guide':    NEWSFEED_GUIDE_TEMPLATE,
  'tradingview-banner': TRADINGVIEW_BANNER_TEMPLATE,
  'whop-banner':        WHOP_BANNER_TEMPLATE,
};

// Same "already seeded before this field changed" problem as
// DURATION_MIGRATIONS below — seedEmbedTemplates() only fills in templates
// that don't exist yet, so a field tweak like removing the nyse-open
// footer needs to be force-applied to copies already sitting in a guild's
// embeds.json, scoped to exactly the known template/field pairs listed here.
const EMBED_TEMPLATE_MIGRATIONS = {
  'nyse-open':      { footer: null },
  'risk-guide':     { footer: null },
  'newsfeed-guide': { footer: null },
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

function migrateDurations() {
  const data = readJson(SHOP_FILE, {});
  let changed = false;

  for (const guildId of Object.keys(data)) {
    const items = data[guildId]?.items;
    if (!items) continue;
    for (const [id, patch] of Object.entries(DURATION_MIGRATIONS)) {
      const item = items[id];
      if (!item) continue;
      if (item.durationMs !== patch.durationMs || item.description !== patch.description) {
        Object.assign(item, patch);
        changed = true;
      }
    }
  }

  if (changed) writeJson(SHOP_FILE, data);
  return changed;
}

function seedEmbedTemplates() {
  const all = readJson(EMBEDS_FILE, {});
  let changed = false;

  for (const guildId of Object.keys(all)) {
    for (const [name, template] of Object.entries(TEMPLATE_SEEDS)) {
      if (all[guildId][name]) continue;
      all[guildId][name] = JSON.parse(JSON.stringify(template));
      changed = true;
    }
  }

  if (changed) writeJson(EMBEDS_FILE, all);
  return changed;
}

function migrateEmbedTemplates() {
  const all = readJson(EMBEDS_FILE, {});
  let changed = false;

  for (const guildId of Object.keys(all)) {
    for (const [name, patch] of Object.entries(EMBED_TEMPLATE_MIGRATIONS)) {
      const embed = all[guildId]?.[name]?.embeds?.[0];
      if (!embed) continue;
      for (const [field, value] of Object.entries(patch)) {
        if (embed[field] !== value) { embed[field] = value; changed = true; }
      }
    }
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
  const shopSeeded       = seedShopDefaults();
  const durationsFixed   = migrateDurations();
  const embedSeeded      = seedEmbedTemplates();
  const embedsFixed      = migrateEmbedTemplates();
  if (shopSeeded)     console.log('[CONTENT SEED] Added missing starter shop items.');
  if (durationsFixed) console.log('[CONTENT SEED] Updated coin_boost/cooldown_skip durations to the current defaults.');
  if (embedSeeded)    console.log('[CONTENT SEED] Added missing embed templates.');
  if (embedsFixed)    console.log('[CONTENT SEED] Updated existing embed templates to the current defaults.');
}

module.exports = { seedDefaultContent, STARTER_ITEMS, TEMPLATE_SEEDS };
