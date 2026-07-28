'use strict';

// Polls Financial Juice's public RSS feed (financialjuice.com/feed.ashx) for
// real-time market-moving headlines and relays new ones into each guild's
// configured news channel as they're published. No API key / paid tier
// needed — it's a free, public feed that updates within seconds of a
// headline going out.

const { readJson, writeJson } = require('./jsonStorage');
const { createEmbed } = require('./embedBuilder');

const FEED_URL          = 'https://www.financialjuice.com/feed.ashx';
const POLL_INTERVAL_MS  = 20_000;
const MAX_POST_PER_TICK = 8; // safety cap so a feed gap never dumps a huge backlog at once
const BREAKING_PATTERN  = /\b(breaking|urgent)\b/i;

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeEntities(m[1]) : '';
}

// Returns items newest-first, matching the feed's own order.
function parseFeedItems(xml) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const items = [];
  for (const block of blocks) {
    const guid = extractTag(block, 'guid');
    const rawTitle = extractTag(block, 'title');
    if (!guid || !rawTitle) continue;
    const title = rawTitle.replace(/^FinancialJuice:\s*/i, '').trim();
    const link = extractTag(block, 'link');
    const pubDateRaw = extractTag(block, 'pubDate');
    const pubDate = pubDateRaw ? new Date(pubDateRaw) : new Date();
    items.push({ guid, title, link, pubDate: isNaN(pubDate) ? new Date() : pubDate });
  }
  return items;
}

async function fetchFeedItems() {
  const res = await fetch(FEED_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YSERFlowBot/1.0)' } });
  if (!res.ok) throw new Error(`Financial Juice feed request failed: ${res.status}`);
  const xml = await res.text();
  return parseFeedItems(xml);
}

function buildNewsEmbed(item) {
  const isBreaking = BREAKING_PATTERN.test(item.title);
  const embed = createEmbed(isBreaking ? 'breaking' : 'news', {
    title: isBreaking ? '🔴 BREAKING — Financial Juice' : '📰 Financial Juice',
    description: item.link ? `[${item.title}](${item.link})` : item.title,
    footer: 'Financial Juice • Live Market News',
  });
  embed.setTimestamp(item.pubDate);
  return embed;
}

async function runTick(client) {
  const items = await fetchFeedItems();
  if (items.length === 0) return;

  const config = readJson('config.json', {});
  let changed = false;

  for (const guildId of Object.keys(config)) {
    const settings = config[guildId]?.newsFeedSettings;
    if (!settings?.enabled || !settings.channelId) continue;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(settings.channelId);
    if (!channel || !channel.isTextBased()) continue;

    let toPost;
    if (!settings.lastGuid) {
      // Just enabled — establish a baseline silently instead of dumping the
      // whole current feed window into the channel.
      toPost = [];
    } else {
      const idx = items.findIndex(it => it.guid === settings.lastGuid);
      toPost = idx === -1 ? items.slice(0, MAX_POST_PER_TICK) : items.slice(0, idx);
    }

    if (toPost.length > MAX_POST_PER_TICK) toPost = toPost.slice(0, MAX_POST_PER_TICK);

    if (toPost.length > 0) {
      const chronological = [...toPost].reverse();
      for (const item of chronological) {
        await channel.send({ embeds: [buildNewsEmbed(item)] }).catch(() => {});
      }
    }

    settings.lastGuid = items[0].guid;
    changed = true;
  }

  if (changed) writeJson('config.json', config);
}

// Safe to call once after the client is ready.
function startNewsFeedRunner(client) {
  const tick = () => runTick(client).catch(err => console.error('[NEWSFEED RUNNER ERROR]', err));
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { startNewsFeedRunner, parseFeedItems };
