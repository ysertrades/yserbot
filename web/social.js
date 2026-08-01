'use strict';

/**
 * web/social.js
 *
 * The Social screen: which accounts are watched, where their posts land, and
 * everything about how often and how loudly.
 *
 * The styling of the cards is deliberately not here — those are four entries
 * in the message catalogue, edited on the Appearance screen alongside every
 * other message the bot sends. Two screens that both set the colour of the
 * YouTube card would eventually disagree, and one of them would be lying.
 *
 * Two of the operations here reach the network: Test, which fetches a feed and
 * shows what came back without posting anything, and Post the latest, which
 * sends exactly one item through the same path the runner uses. Both are
 * bounded and neither can be made to fetch an arbitrary address by anyone who
 * could not already set one as the account's feed URL.
 */

const social = require('../utils/socialFeed');
const runner = require('../utils/socialRunner');
const messageStyle = require('../utils/messageStyle');

const { PLATFORMS, LIMITS } = social;

/* ─── reading ────────────────────────────────────────────────────────────── */

function platformMeta() {
  return Object.values(PLATFORMS).map(p => ({
    key: p.key,
    label: p.label,
    emoji: p.emoji,
    color: p.color,
    styleKey: p.styleKey,
    direct: !!p.direct,
    handleHint: p.handleHint,
  }));
}

function describeAccount(account, guild) {
  const platform = PLATFORMS[account.platform];
  const channelName = id => (id && guild?.channels?.cache?.get(id)?.name) || null;
  const roleName = id => (id && guild?.roles?.cache?.get(id)?.name) || null;

  return {
    ...account,
    platformLabel: platform?.label || account.platform,
    platformEmoji: platform?.emoji || '',
    platformColor: platform?.color || '#5865F2',
    // Shown so somebody can paste it into a browser and see for themselves
    // what the bot is reading. Half of diagnosing a quiet feed is knowing
    // which address was actually asked.
    resolvedFeedUrl: social.feedUrlFor(account, social.getSettings(guild?.id || '')) || null,
    profileUrl: platform?.profileUrl && account.handle ? platform.profileUrl(account.handle) : null,
    postChannel: channelName(account.postChannelId),
    mentionRole: roleName(account.mentionRoleId),
    // Whether this platform can be reached without a bridge, so the screen can
    // say which accounts depend on one.
    needsBridge: !platform?.direct && !account.feedUrl,
  };
}

function read(guildId, guild) {
  const s = social.getSettings(guildId);
  const channelName = id => (id && guild?.channels?.cache?.get(id)?.name) || null;

  return {
    enabled: !!s.enabled,
    channelId: s.channelId,
    channel: channelName(s.channelId),
    mentionRoleId: s.mentionRoleId,
    mentionRole: (s.mentionRoleId && guild?.roles?.cache?.get(s.mentionRoleId)?.name) || null,
    bridgeUrl: s.bridgeUrl,
    defaultBridgeUrl: social.DEFAULTS.bridgeUrl,
    pollMinutes: s.pollMinutes,
    maxPerCheck: s.maxPerCheck,
    showLinkPreview: !!s.showLinkPreview,
    accounts: s.accounts.map(a => describeAccount(a, guild)),
    platforms: platformMeta(),
    limits: LIMITS,
    // How many watched accounts depend on the bridge being up, which is the
    // single most useful number for working out why things are quiet.
    bridgeAccounts: s.accounts.filter(a => !PLATFORMS[a.platform]?.direct && !a.feedUrl).length,
  };
}

/* ─── validation ─────────────────────────────────────────────────────────── */

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function httpUrl(v) {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

function keywordList(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const k of raw.slice(0, LIMITS.keywords)) {
    const cleaned = text(k, LIMITS.keyword);
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

function channelIn(guild, id) {
  if (!id) return { ok: true, value: null };
  if (!/^\d{5,25}$/.test(String(id))) return { ok: false };
  const ch = guild?.channels?.cache?.get(String(id));
  if (!ch || !ch.isTextBased?.()) return { ok: false };
  return { ok: true, value: String(id) };
}

function roleIn(guild, id) {
  if (!id) return { ok: true, value: null };
  if (!/^\d{5,25}$/.test(String(id))) return { ok: false };
  if (!guild?.roles?.cache?.has(String(id))) return { ok: false };
  return { ok: true, value: String(id) };
}

/* ─── the shared settings ────────────────────────────────────────────────── */

function saveSettings(guildId, body, { guild }) {
  const current = social.getSettings(guildId);
  const patch = {};
  const changed = [];

  if ('enabled' in body) {
    const on = !!body.enabled;
    if (on !== current.enabled) { patch.enabled = on; changed.push(on ? 'switched on' : 'switched off'); }
  }

  if ('channelId' in body) {
    const ch = channelIn(guild, body.channelId);
    if (!ch.ok) return { error: 'bad_channel' };
    if (ch.value !== current.channelId) {
      patch.channelId = ch.value;
      changed.push(ch.value ? `posts to <#${ch.value}>` : 'channel cleared');
    }
  }

  if ('mentionRoleId' in body) {
    const role = roleIn(guild, body.mentionRoleId);
    if (!role.ok) return { error: 'bad_role' };
    if (role.value !== current.mentionRoleId) {
      patch.mentionRoleId = role.value;
      changed.push(role.value ? `pings <@&${role.value}>` : 'ping cleared');
    }
  }

  if ('bridgeUrl' in body) {
    const url = text(body.bridgeUrl, 200) || social.DEFAULTS.bridgeUrl;
    if (!httpUrl(url)) return { error: 'bad_bridge' };
    const tidy = url.replace(/\/+$/, '');
    if (tidy !== current.bridgeUrl) { patch.bridgeUrl = tidy; changed.push(`bridge set to ${tidy}`); }
  }

  if ('pollMinutes' in body) {
    const n = Number(body.pollMinutes);
    if (!Number.isFinite(n) || n < 2 || n > 360) return { error: 'bad_interval' };
    const v = Math.round(n);
    if (v !== current.pollMinutes) { patch.pollMinutes = v; changed.push(`checks every ${v} min`); }
  }

  if ('maxPerCheck' in body) {
    const n = Number(body.maxPerCheck);
    if (!Number.isFinite(n) || n < 1 || n > 10) return { error: 'bad_batch' };
    const v = Math.round(n);
    if (v !== current.maxPerCheck) { patch.maxPerCheck = v; changed.push(`at most ${v} per check`); }
  }

  if ('showLinkPreview' in body) {
    const on = !!body.showLinkPreview;
    if (on !== current.showLinkPreview) {
      patch.showLinkPreview = on;
      changed.push(on ? 'link preview on' : 'link preview off');
    }
  }

  if (!changed.length) return { ok: true, unchanged: true };
  social.setSettings(guildId, patch);
  return { ok: true, changed };
}

/* ─── accounts ───────────────────────────────────────────────────────────── */

// Short, readable, and not derived from anything a person typed — an id built
// from the handle would collide the moment the same account was watched twice
// through different bridges.
function newId(existing) {
  for (let n = 1; n <= LIMITS.accounts + 5; n++) {
    const id = `a${n}`;
    if (!existing.some(a => a.id === id)) return id;
  }
  return `a${Date.now().toString(36)}`;
}

function saveAccount(guildId, body, { guild }) {
  const settings = social.getSettings(guildId);
  const accounts = settings.accounts.map(a => ({ ...a }));
  const id = text(body.id, 40);
  const existing = id ? accounts.find(a => a.id === id) : null;
  if (id && !existing) return { error: 'unknown_account' };

  if (body.remove) {
    if (!existing) return { error: 'unknown_account' };
    social.setSettings(guildId, { accounts: accounts.filter(a => a.id !== id) });
    return { ok: true, removed: existing.label || existing.handle || existing.id };
  }

  const platform = Object.hasOwn(PLATFORMS, body.platform) ? body.platform
    : existing?.platform ?? null;
  if (!platform) return { error: 'bad_platform' };

  const handle = 'handle' in body ? text(body.handle, LIMITS.handle) : (existing?.handle ?? '');
  const feedUrl = 'feedUrl' in body ? text(body.feedUrl, LIMITS.feedUrl) : (existing?.feedUrl ?? '');
  if (feedUrl && !httpUrl(feedUrl)) return { error: 'bad_feed_url' };
  // One or the other has to be there — an account with neither is a row that
  // can never be checked.
  if (!handle && !feedUrl) return { error: 'need_handle' };

  const channel = channelIn(guild, 'postChannelId' in body ? body.postChannelId : existing?.postChannelId);
  if (!channel.ok) return { error: 'bad_channel' };
  const role = roleIn(guild, 'mentionRoleId' in body ? body.mentionRoleId : existing?.mentionRoleId);
  if (!role.ok) return { error: 'bad_role' };

  const include = 'includeKeywords' in body ? keywordList(body.includeKeywords) : (existing?.includeKeywords ?? []);
  const exclude = 'excludeKeywords' in body ? keywordList(body.excludeKeywords) : (existing?.excludeKeywords ?? []);
  if (include === null || exclude === null) return { error: 'bad_keywords' };

  const next = {
    ...(existing || {}),
    id: existing?.id || newId(accounts),
    platform,
    handle,
    label: 'label' in body ? (text(body.label, LIMITS.label) || null) : (existing?.label ?? null),
    feedUrl: feedUrl || null,
    postChannelId: channel.value,
    mentionRoleId: role.value,
    enabled: 'enabled' in body ? !!body.enabled : (existing?.enabled !== false),
    includeKeywords: include,
    excludeKeywords: exclude,
  };

  // Changing where an account reads from invalidates the cursor: the ids in
  // one feed mean nothing in another, and keeping the old one would either
  // replay the whole new feed or silently skip it.
  const movedFeed = existing && (existing.handle !== next.handle || (existing.feedUrl || '') !== (next.feedUrl || '') || existing.platform !== next.platform);
  if (!existing || movedFeed) {
    next.lastId = null;
    next.channelId = null;
    next.lastError = null;
    next.failures = 0;
    next.lastCheckedAt = 0;
  }

  if (existing) {
    const idx = accounts.findIndex(a => a.id === existing.id);
    accounts[idx] = next;
  } else {
    if (accounts.length >= LIMITS.accounts) return { error: 'too_many_accounts' };
    accounts.push(next);
  }

  social.setSettings(guildId, { accounts });
  return {
    ok: true,
    id: next.id,
    isNew: !existing,
    label: next.label || next.handle,
    platformLabel: PLATFORMS[platform].label,
  };
}

/* ─── the two that reach the network ─────────────────────────────────────── */

/**
 * Fetches an account's feed and reports what came back, without posting.
 *
 * This is the answer to "why is nothing arriving" — it either shows the three
 * most recent posts, or it shows the error verbatim, and either way it names
 * the address it asked.
 */
async function testAccount(guildId, body, { guild }) {
  const settings = social.getSettings(guildId);
  const account = settings.accounts.find(a => a.id === text(body.id, 40));
  if (!account) return { error: 'unknown_account' };

  const url = social.feedUrlFor(account, settings);
  try {
    const { items, channelId } = await social.fetchAccount(account, settings);
    // A resolved YouTube id is worth keeping even from a test — it is the
    // slow part, and the next real check should not have to do it again.
    if (channelId && channelId !== account.channelId) {
      social.patchAccount(guildId, account.id, { channelId });
    }
    const kept = items.filter(i => social.matches(i, account));
    return {
      ok: true,
      url: social.feedUrlFor({ ...account, channelId: channelId || account.channelId }, settings) || url,
      found: items.length,
      keptByFilters: kept.length,
      // Enough to recognise, not enough to be a second feed reader.
      sample: items.slice(0, 3).map(i => ({
        title: i.title.slice(0, 140),
        link: i.link,
        published: i.published.getTime(),
        hasImage: !!i.image,
        keptByFilters: social.matches(i, account),
      })),
      // A brand-new account posts nothing until something appears after it was
      // added, and that surprises people. Say so plainly.
      baselineSet: !!account.lastId,
    };
  } catch (err) {
    social.patchAccount(guildId, account.id, {
      lastCheckedAt: Date.now(),
      lastError: err.message || String(err),
      failures: (account.failures || 0) + 1,
    });
    return { ok: true, failed: true, url, detail: (err.message || String(err)).slice(0, 200) };
  }
}

/**
 * Sends the newest item now, through the runner's own path.
 *
 * Deliberately does not move the cursor: this is for seeing the card in the
 * channel, and someone checking their styling should not accidentally skip
 * the next real post.
 */
async function postLatest(guildId, body, { guild }) {
  const settings = social.getSettings(guildId);
  const account = settings.accounts.find(a => a.id === text(body.id, 40));
  if (!account) return { error: 'unknown_account' };
  if (!runner.targetFor(guild, account, settings)) return { error: 'no_channel' };

  let items;
  try {
    ({ items } = await social.fetchAccount(account, settings));
  } catch (err) {
    return { error: 'fetch_failed', detail: (err.message || String(err)).slice(0, 200) };
  }
  if (!items.length) return { error: 'nothing_to_post' };

  try {
    const sent = await runner.postItem(guild, account, settings, items[0]);
    if (!sent) return { error: 'no_channel' };
  } catch (err) {
    return { error: 'send_failed', detail: (err.message || String(err)).slice(0, 200) };
  }

  return { ok: true, title: items[0].title.slice(0, 120), label: account.label || account.handle };
}

/**
 * Asks the bridge whether it is reachable from where the bot runs.
 *
 * Worth its own button because when the bridge is refusing, three of the four
 * platforms go quiet at once and every account shows the same unhelpful
 * timeout. This says so in one sentence instead.
 */
async function checkBridge(guildId, body) {
  const settings = social.getSettings(guildId);
  const url = text(body?.bridgeUrl, 200) || settings.bridgeUrl;
  const result = await social.checkBridge(url);
  return { ok: true, url, ...result };
}

/** The Appearance keys this screen links to, so the two stay in step. */
function styleKeys() {
  return Object.values(PLATFORMS)
    .map(p => p.styleKey)
    .filter(k => Object.hasOwn(messageStyle.CATALOGUE, k));
}

module.exports = { read, saveSettings, saveAccount, testAccount, postLatest, checkBridge, styleKeys };
