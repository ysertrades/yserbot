'use strict';

/**
 * socialRunner.js
 *
 * Checks each watched account on its own schedule and posts what is new.
 *
 * The shape of this is deliberately unlike the news feed's. That one polls a
 * single endpoint every twenty seconds and fans it out to every guild, which
 * is right when everyone is reading the same feed. Here every guild watches
 * different accounts through addresses that are mostly somebody else's
 * goodwill, so the rules are the opposite:
 *
 *   · one account is checked at a time, with a pause between, rather than
 *     twenty requests leaving at once — a shared bridge answers a burst with
 *     a rate limit, and a rate limit is how a feed goes quiet;
 *
 *   · an account that fails keeps its cursor and records why, so the panel
 *     can say "HTTP 503" beside its name instead of showing nothing and
 *     leaving someone to guess;
 *
 *   · a failing account backs off on its own without slowing the others, and
 *     a newly added one is checked on the next tick rather than waiting out
 *     the full interval.
 */

const social = require('./socialFeed');
const messageStyle = require('./messageStyle');
const { readJson } = require('./jsonStorage');

// How often the runner wakes. Each account is then checked only if its own
// interval has elapsed, so this is a floor on responsiveness, not the poll
// rate anyone is actually being charged for.
const TICK_MS = 60_000;

// Between two outbound requests in the same tick. A bridge shared by everyone
// on the internet will answer a burst with a 429, and then nothing arrives
// for an hour.
const GAP_MS = 1_500;

// After a failure, wait longer before trying again — doubling each time up to
// an hour. An account whose handle was typed wrong should not be asking a
// third party for it every ten minutes forever.
const BACKOFF_START_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Where the platform's mark is served from.
 *
 * Discord's CDN fetches an author icon itself, so this has to be an address
 * reachable from outside — the panel's own, which is the same address the
 * login link uses. Null when there is not one, and the card simply goes
 * without a picture.
 */
function markUrl(platform) {
  const base = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!base || !/^https?:\/\//i.test(base) || !platform?.mark) return null;
  return `${base}/social/${platform.mark}-128.png`;
}

function backoffFor(failures) {
  if (!failures) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * (2 ** (failures - 1)));
}

/** Is this account due? */
function isDue(account, settings, now) {
  if (!account.enabled) return false;
  const every = settings.pollMinutes * 60_000;
  const wait = Math.max(every, backoffFor(account.failures || 0));
  return now - (account.lastCheckedAt || 0) >= wait;
}

/**
 * Builds the card for one post.
 *
 * All of it comes from the Appearance catalogue, so a server that has
 * restyled its YouTube card gets its own wording here without this file
 * knowing anything about it.
 */
function buildPostEmbed(guildId, account, item) {
  const platform = social.PLATFORMS[account.platform];
  const name = account.label || item.author || account.handle || platform.label;

  const embed = messageStyle.build(guildId, platform.styleKey, {
    // The platform's own mark, beside the heading. Discord fetches this from
    // the panel, so it only appears when the panel has a public address —
    // without one the heading is drawn on its own rather than broken.
    iconURL: markUrl(platform),
    thumbnailURL: item.image,
    // When it was published, not when we noticed. A card that says "just now"
    // for a video from yesterday is worse than no timestamp at all.
    at: item.published instanceof Date ? item.published : null,
    tokens: {
      author: name,
      user: name,
      handle: account.handle || '',
      title: item.title || '',
      text: item.text || '',
      url: item.link || '',
      platform: platform.label,
      server: '',
    },
  });
  if (!embed) return null;

  // The picture belongs across the card, not in the corner — a video
  // thumbnail or a photo post is the content, not decoration. The catalogue's
  // thumbnail switch decides which of the two it gets.
  const style = messageStyle.styleFor(guildId, platform.styleKey);
  if (item.image && !style.thumbnail) {
    try { embed.setImage(item.image); } catch { /* a URL Discord refuses is not worth the card */ }
  }
  return embed;
}

/** Where this account posts, and who it pings. */
function targetFor(guild, account, settings) {
  const channelId = account.postChannelId || settings.channelId;
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased?.()) return null;
  const roleId = account.mentionRoleId || settings.mentionRoleId;
  return { channel, roleId };
}

/**
 * Posts one item. Returns true when it actually went out.
 *
 * Kept apart from the polling so the panel's "post the latest one now" button
 * can use exactly the same path — a test that goes through different code
 * from the real thing is a test of the wrong thing.
 */
async function postItem(guild, account, settings, raw) {
  const target = targetFor(guild, account, settings);
  if (!target) return false;

  // The feed points at a small copy — YouTube's is 480×360, drawn across the
  // whole width of the card. Finding the full-size one costs a HEAD request,
  // so it happens here rather than in the parser: once per post that actually
  // goes out, not once per item in every feed we read.
  const item = raw.image
    ? { ...raw, image: await social.sharpestImage(raw.image) }
    : raw;

  const embed = buildPostEmbed(guild.id, account, item);
  if (!embed) return false;

  const bits = [];
  if (target.roleId) bits.push(`<@&${target.roleId}>`);
  // Off by default: Discord unfurls a link in the message text into a second
  // card under ours, and two cards for one post looks like a bug.
  if (settings.showLinkPreview && item.link) bits.push(item.link);
  const content = bits.join(' ') || undefined;

  await target.channel.send({
    content,
    embeds: [embed],
    allowedMentions: target.roleId ? { roles: [target.roleId] } : { parse: [] },
  });
  return true;
}

/** Checks one account and posts anything new. Never throws. */
async function checkAccount(client, guildId, account) {
  const settings = social.getSettings(guildId);
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { skipped: 'no-guild' };

  const now = Date.now();
  let result;
  try {
    result = await social.fetchAccount(account, settings);
  } catch (err) {
    social.patchAccount(guildId, account.id, {
      lastCheckedAt: now,
      lastError: err.message || String(err),
      failures: (account.failures || 0) + 1,
    });
    return { error: err.message || String(err) };
  }

  const { items, channelId, feedPath } = result;
  const patch = {
    lastCheckedAt: now,
    lastError: null,
    failures: 0,
    // Remembered so the handle lookup happens once rather than every check.
    ...(channelId && channelId !== account.channelId ? { channelId } : {}),
    // And which of the candidate addresses answered, so the next check starts
    // with the one that worked instead of walking the list again.
    ...(feedPath && feedPath !== account.feedPath ? { feedPath } : {}),
  };

  const fresh = social.newItems(items, account, settings.maxPerCheck);
  let posted = 0;

  // Oldest first, so a burst reads in the order it was published.
  for (const item of [...fresh].reverse()) {
    try {
      if (await postItem(guild, account, settings, item)) posted++;
    } catch (err) {
      console.error(`[SOCIAL] ${guildId}/${account.id} post failed:`, err.message);
    }
  }

  // The cursor moves to the newest item the feed carried, not the newest one
  // posted — otherwise anything a keyword filter removed would be re-examined
  // and re-filtered on every check for as long as it stayed in the feed.
  patch.lastId = items[0].id;
  if (posted) {
    patch.lastPostedAt = now;
    patch.posts = (account.posts || 0) + posted;
  }
  social.patchAccount(guildId, account.id, patch);
  return { posted, checked: items.length };
}

async function runTick(client) {
  const stored = readJson(social.FILE, {});
  const now = Date.now();

  for (const guildId of Object.keys(stored)) {
    const settings = social.getSettings(guildId);
    if (!settings.enabled) continue;
    if (!client.guilds.cache.has(guildId)) continue;

    for (const account of settings.accounts) {
      if (!isDue(account, settings, now)) continue;
      await checkAccount(client, guildId, account);
      // One at a time, with a pause. Slower on purpose.
      await sleep(GAP_MS);
    }
  }
}

let timer = null;

function startSocialRunner(client) {
  const tick = () => runTick(client).catch(err => console.error('[SOCIAL RUNNER]', err));
  tick();
  timer = setInterval(tick, TICK_MS);
  return timer;
}

function stopSocialRunner() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startSocialRunner, stopSocialRunner, runTick,
  checkAccount, postItem, buildPostEmbed, targetFor, isDue, backoffFor, markUrl,
  TICK_MS, GAP_MS,
};
