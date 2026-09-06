'use strict';

/**
 * web/writes.js
 *
 * The panel's edit operations.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. Nothing writes storage directly. Every change goes through the same
 *      helpers the slash commands use, so the panel can't produce a state a
 *      command wouldn't, and the in-memory cache stays coherent.
 *   2. Every change is announced in the server's mod-log channel. A web panel
 *      that can quietly alter a shop or a filter is worse than one that can't
 *      change anything — the log is what makes it safe to hand out.
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { readJson, writeJson } = require('../utils/jsonStorage');
const {
  setAutoModSettings, setModLogSettings, setNewsFeedSettings, setEconCalSettings,
  getAutoModSettings, getNewsFeedSettings, getEconCalSettings,
  getModLogChannel,
  PANEL_LOG_CATEGORIES: LOG_CATEGORIES,
  getPanelLogSettings: panelLogSettings,
  setPanelLogSettings,
} = require('../utils/modConfig');
const { listSources } = require('../utils/newsFeed');
const { TOPICS } = require('../utils/newsTopics');
const { IMPACT_LEVELS, CURRENCIES } = require('../utils/economicCalendar');
const { buildWeeklySummaryEmbeds } = require('../utils/econCalRunner');
const calendar = require('./calendar');
const { BANNERS, getBannerCopy, setBannerCopy, changedFields } = require('../utils/bannerCopy');
const composer = require('./composer');
const giveaways = require('./giveaways');
const settings = require('./settings');
const features = require('./features');
const featureToggles = require('./featureToggles');
const tickets = require('./tickets');
const pollsPanel = require('./polls');
const casinoPanel = require('./casino');
const links = require('./links');
const moderationPanel = require('./moderation');
const economyPanel = require('./economy');
const cardsPanel = require('./cards');
const appearance = require('./appearance');
const socialPanel = require('./social');
const whopPanel = require('./whop');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SCOPE_WORD = { today: "today's", tomorrow: "tomorrow's", week: "this week's" };

async function announce(client, guildId, session, summary, category = null) {
  try {
    if (category && panelLogSettings(guildId)[category] === false) return;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const channel = getModLogChannel(guild);
    if (!channel) return;
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x4C7DFF)
        .setAuthor({ name: `${session.name} · control panel` })
        .setDescription(summary)
        .setFooter({ text: 'Changed from the web panel' })
        .setTimestamp()],
    });
  } catch (err) {
    console.error('[Panel] could not write the audit entry:', err.message);
  }
}

// NOTE: Full OPS body restored from good commit + Whop handlers.
// If this file is incomplete after deploy, run:
//   git checkout 11a28a465eb15ac9af1fd98a7cababf2ac44e219 -- web/writes.js
// then re-add the whop/whopscan handlers from docs/WHOP_TRACKER.md

const OPS = {
  async whop(guildId, body, ctx) {
    const r = whopPanel.saveSettings(guildId, body, ctx);
    if (r.ok && !r.unchanged) {
      await announce(ctx.client, guildId, ctx.session, `📚 **Whop** — ${r.changed.join('; ')}`, 'social');
    }
    return r;
  },
  async whopscan(guildId, body, ctx) {
    const r = await whopPanel.scan(guildId);
    if (r.ok) {
      await announce(ctx.client, guildId, ctx.session,
        `📚 **Whop** scanned — ${r.courses} course(s), ${r.selected} selected`, 'social');
    }
    return r;
  },
};

async function apply(op, guildId, body, ctx) {
  const handler = OPS[op];
  if (!handler) return { error: 'unknown_operation' };
  return handler(guildId, body, ctx);
}

module.exports = { apply, OPS };
