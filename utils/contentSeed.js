'use strict';

/**
 * contentSeed.js
 *
 * Idempotently seeds the starter embed templates into every guild the bot
 * is in, once on startup, through the live storage backend (MongoDB in
 * production) — writing data/*.json directly would only affect the local
 * fallback, not the database the bot actually reads.
 *
 * Each template is handed out once per guild (see SEEDED_FILE), so a
 * template an admin deleted stays deleted. The shop catalog and the economy
 * showcase that used to be seeded here went with the economy.
 */

const { readJson, writeJson } = require('./jsonStorage');

const EMBEDS_FILE = 'embeds.json';

const REPORT_GUIDE_TEMPLATE = {
  embeds: [{
    title: null,
    description: 'Run `/report` any time you need to flag a member to the mod team — pick the user, a reason, and (optionally) a link, then submit.',
    color: '#E74C3C',
    footer: 'QuantLab Moderation',
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

const FUTURES_OPEN_TEMPLATE = {
  embeds: [{
    title: null,
    description: null,
    color: '#4C7DFF',
    footer: null,
    footerIcon: null,
    thumbnail: null,
    image: 'dynamic:futuresOpen',
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
    color: '#FA4516',
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
  'report-guide':      REPORT_GUIDE_TEMPLATE,
  'nyse-open':         NYSE_OPEN_TEMPLATE,
  'futures-open':      FUTURES_OPEN_TEMPLATE,
  'risk-guide':        RISK_GUIDE_TEMPLATE,
  'newsfeed-guide':    NEWSFEED_GUIDE_TEMPLATE,
  'tradingview-banner': TRADINGVIEW_BANNER_TEMPLATE,
  'whop-banner':        WHOP_BANNER_TEMPLATE,
};

// The "already seeded before this field changed" problem: seedEmbedTemplates() only fills in templates
// that don't exist yet, so a field tweak like removing the nyse-open
// footer needs to be force-applied to copies already sitting in a guild's
// embeds.json, scoped to exactly the known template/field pairs listed here.
const EMBED_TEMPLATE_MIGRATIONS = {
  'nyse-open':      { footer: null },
  'risk-guide':     { footer: null },
  'newsfeed-guide': { footer: null },
  // Seeded green before the banner was restyled to Whop's own orange — the
  // sidebar would otherwise stay green against an orange card.
  'whop-banner':    { color: '#FA4516' },
};

// guildId -> [seed template names that guild has been given]. A seed is
// handed out once. "Missing" used to mean "add it", so a starter template
// somebody deleted came back on every restart.
const SEEDED_FILE = 'content_seeded.json';

function seedEmbedTemplates() {
  const all = readJson(EMBEDS_FILE, {});
  const seeded = readJson(SEEDED_FILE, {});
  let changed = false, seededChanged = false;

  for (const guildId of Object.keys(all)) {
    const given = new Set(Array.isArray(seeded[guildId]) ? seeded[guildId] : []);
    for (const [name, template] of Object.entries(TEMPLATE_SEEDS)) {
      if (given.has(name)) continue;           // handed out before: respect a delete
      given.add(name);
      seededChanged = true;
      if (all[guildId][name]) continue;        // already there (seeded before this record existed)
      all[guildId][name] = JSON.parse(JSON.stringify(template));
      changed = true;
    }
    seeded[guildId] = [...given];
  }

  if (changed) writeJson(EMBEDS_FILE, all);
  if (seededChanged) writeJson(SEEDED_FILE, seeded);
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

// Guilds that have never had any embed activity have no key in embeds.json
// yet, so seeding from that file's keys alone would skip a brand-new guild —
// bootstrap one from the client's guild list too.
function ensureGuildEntries(client) {
  const embeds = readJson(EMBEDS_FILE, {});
  let changed = false;
  for (const guild of client.guilds.cache.values()) {
    if (!embeds[guild.id]) { embeds[guild.id] = {}; changed = true; }
  }
  if (changed) writeJson(EMBEDS_FILE, embeds);
}

function seedDefaultContent(client) {
  ensureGuildEntries(client);
  const embedSeeded = seedEmbedTemplates();
  const embedsFixed = migrateEmbedTemplates();
  if (embedSeeded) console.log('[CONTENT SEED] Added missing embed templates.');
  if (embedsFixed) console.log('[CONTENT SEED] Updated existing embed templates to the current defaults.');
}

module.exports = { seedDefaultContent, TEMPLATE_SEEDS };
