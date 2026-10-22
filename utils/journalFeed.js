'use strict';

/**
 * Journal feed: an outside trading journal (a site the bot does not run) sends
 * each trade it logs to a signed webhook, and the bot posts it as a card in the
 * server's chosen channel. An edit on the site updates the same card; a delete
 * crosses it out.
 *
 * The contract the site implements (docs/journal-feed.md has the full guide):
 *   POST /hooks/journal/<feed id>, JSON body, with two headers:
 *     X-Timestamp  unix seconds when it was sent
 *     X-Signature  sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with the feed secret>
 *   body: { event: 'trade.created' | 'trade.updated' | 'trade.deleted' | 'ping', id, ...trade }
 *
 * Each feed's secret is made here, shown in the panel once, and stored like the
 * Whop key: in the bot's own storage, never in a message.
 */

const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonStorage');
const v2 = require('./componentsV2');

const FILE = 'journalfeed.json';
const MAX_FEEDS = 5;
const MAX_POSTS = 3000;          // trade id -> card, kept per feed for edits and deletes
const SKEW_SEC = 300;            // a signed request older (or newer) than this is refused
const EVENTS = ['trade.created', 'trade.updated', 'trade.deleted', 'ping'];
const GREEN = 0x3ccf7a, RED = 0xf87171, GREY = 0x8b8b92, AMBER = 0xf5b84b;

const newId = () => crypto.randomBytes(12).toString('base64url');
const newSecret = () => `jf_${crypto.randomBytes(32).toString('base64url')}`;
const mask = (s) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : null);

function all() { return readJson(FILE, {}); }
function feedsOf(guildId) { return (all()[guildId]?.feeds || []).filter(Boolean); }
function saveFeeds(guildId, feeds) { const a = all(); a[guildId] = { ...(a[guildId] || {}), feeds }; writeJson(FILE, a); }
/** finds a feed by its id across every server: the webhook URL carries only that */
function findFeed(feedId) {
  if (!/^[\w-]{10,40}$/.test(String(feedId || ''))) return null;
  for (const [guildId, g] of Object.entries(all())) {
    const f = (g?.feeds || []).find((x) => x && x.id === feedId);
    if (f) return { guildId, feed: f };
  }
  return null;
}
function updateFeed(guildId, feedId, patch) {
  const feeds = feedsOf(guildId), i = feeds.findIndex((f) => f.id === feedId);
  if (i < 0) return null;
  feeds[i] = typeof patch === 'function' ? patch(feeds[i]) : { ...feeds[i], ...patch };
  saveFeeds(guildId, feeds);
  return feeds[i];
}

/** what the panel sees: never the secret itself, only its ends */
function view(guildId, guild, baseUrl) {
  return feedsOf(guildId).map((f) => ({
    id: f.id, name: f.name, enabled: f.enabled !== false, channelId: f.channelId,
    channelName: (f.channelId && guild?.channels?.cache?.get(f.channelId)?.name) || null,
    url: `${baseUrl}/hooks/journal/${f.id}`, secretMask: mask(f.secret), createdAt: f.createdAt,
    count: f.count || 0, lastAt: f.lastAt || null, lastError: f.lastError || null, lastEvent: f.lastEvent || null,
    recent: (f.recent || []).slice(0, 6),
  }));
}

/* ── the signature ── */
function verify(feed, headers, raw) {
  const ts = Number(headers['x-timestamp']);
  const sig = String(headers['x-signature'] || '').replace(/^sha256=/i, '').trim();
  if (!ts || !sig) return 'missing_signature';
  const now = Date.now() / 1000, sec = ts > 1e12 ? ts / 1000 : ts;   // seconds, or milliseconds by mistake
  if (Math.abs(now - sec) > SKEW_SEC) return 'stale_timestamp';
  if (!/^[0-9a-f]{64}$/i.test(sig)) return 'bad_signature';
  const want = crypto.createHmac('sha256', feed.secret).update(`${headers['x-timestamp']}.`).update(raw).digest();
  const got = Buffer.from(sig, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want) ? null : 'bad_signature';
}
/** for the guide and the panel's test: how the site signs */
function sign(secret, timestamp, raw) {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`;
}

/* ── the trade, read defensively: a site may send numbers as strings, or leave things out ── */
const str = (v, n) => (v === null || v === undefined || v === '' ? null : String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n) || null);
const num = (v) => { if (v === null || v === undefined || v === '') return null; const x = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(x) ? x : null; };
function readTrade(b) {
  const pnl = num(b.pnl ?? b.profit ?? b.netPnl);
  const outcome = String(b.outcome || '').toLowerCase();
  return {
    id: str(b.id ?? b.tradeId, 100), trader: str(b.trader ?? b.user ?? b.author, 60), symbol: str(b.symbol ?? b.instrument ?? b.ticker, 24),
    side: /^s|sell/i.test(String(b.side ?? b.direction ?? '')) ? 'Short' : /^l|buy/i.test(String(b.side ?? b.direction ?? '')) ? 'Long' : null,
    pnl, r: num(b.r ?? b.rMultiple), qty: num(b.qty ?? b.size ?? b.contracts), entry: num(b.entry ?? b.entryPrice), exit: num(b.exit ?? b.exitPrice),
    setup: str(b.setup ?? b.strategy, 80), session: str(b.session, 40), notes: str(b.notes ?? b.note ?? b.comment, 900),
    outcome: ['win', 'loss', 'be', 'breakeven', 'missed'].includes(outcome) ? (outcome === 'breakeven' ? 'be' : outcome) : (pnl == null ? null : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be'),
    image: /^https:\/\/\S+$/i.test(String(b.image ?? b.screenshot ?? '')) ? String(b.image ?? b.screenshot).slice(0, 600) : null,
    url: /^https:\/\/\S+$/i.test(String(b.url ?? b.link ?? '')) ? String(b.url ?? b.link).slice(0, 500) : null,
    at: (() => { const t = Date.parse(b.at ?? b.time ?? b.closedAt ?? ''); return Number.isFinite(t) ? t : Date.now(); })(),
  };
}

/* ── the card ── */
const money = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const OUT = { win: ['WIN', '🟢', GREEN], loss: ['LOSS', '🔴', RED], be: ['BREAKEVEN', '🟡', AMBER], missed: ['MISSED', '⚪', GREY] };
function card(t, feed, { event = 'trade.created', deleted = false } = {}) {
  const [word, dot, accent] = OUT[t.outcome] || ['TRADE', '🔵', GREY];
  const head = `-# ${feed.name || 'Journal'} · ${event === 'trade.updated' ? 'trade updated' : 'new trade'}${t.trader ? ` · ${t.trader}` : ''}`;
  const title = `${dot} **${t.symbol || 'Trade'}**${t.side ? ` ${t.side}` : ''} · **${money(t.pnl)}**${t.r != null ? ` · ${t.r > 0 ? '+' : ''}${t.r}R` : ''}`;
  const facts = [
    t.entry != null || t.exit != null ? `\`${t.entry ?? '—'} → ${t.exit ?? '—'}\`` : null,
    t.qty != null ? `${t.qty}×` : null, t.setup, t.session,
  ].filter(Boolean).join('  ·  ');
  const parts = [v2.text(deleted ? `${head}\n### ~~${title.replace(/\*\*/g, '')}~~` : `${head}\n### ${title}`)];
  if (facts && !deleted) parts.push(v2.text(facts));
  if (t.notes && !deleted) parts.push(v2.separator({ spacing: 1 }), v2.text(`> ${t.notes.replace(/\n+/g, '\n> ')}`));
  if (t.image && !deleted) parts.push(v2.media(t.image));
  parts.push(v2.separator({ divider: false, spacing: 1 }),
    v2.text(deleted ? '-# 🗑️ Deleted on the journal' : `-# ${word} · <t:${Math.round(t.at / 1000)}:f>`));
  const top = [v2.container(parts, deleted ? GREY : accent)];
  if (t.url && !deleted) top.push(v2.row(v2.button({ label: 'Open in the journal', url: t.url })));
  // nobody can ping the server through a trade note
  return { ...v2.payload(top), allowedMentions: { parse: [] } };
}

/**
 * Handles one delivery that already passed the signature check. Returns
 * { status, body } for the HTTP answer. Idempotent: the same created trade
 * sent twice (a retry) posts one card.
 */
async function deliver(client, guildId, feed, body) {
  const event = String(body.event || '');
  if (!EVENTS.includes(event)) return { status: 400, body: { error: 'unknown_event', detail: `event must be one of ${EVENTS.join(', ')}` } };
  const note = (patch) => updateFeed(guildId, feed.id, (f) => ({ ...f, ...patch, lastAt: Date.now(), lastEvent: event }));
  if (event === 'ping') { note({ lastError: null }); return { status: 200, body: { ok: true, pong: true } }; }
  if (feed.enabled === false) return { status: 409, body: { error: 'feed_paused', detail: 'This feed is paused in the panel.' } };
  const t = readTrade(body);
  if (!t.id) return { status: 400, body: { error: 'missing_id', detail: 'Every trade needs a stable id.' } };
  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels?.cache?.get(feed.channelId) || (feed.channelId ? await guild?.channels?.fetch(feed.channelId).catch(() => null) : null);
  if (!channel?.isTextBased?.()) { note({ lastError: 'The channel is gone. Pick another in the panel.' }); return { status: 410, body: { error: 'no_channel' } }; }
  const lock = `${feed.id}:${t.id}`;
  if (inflight.has(lock)) return { status: 409, body: { error: 'in_progress', detail: 'This trade is being posted right now. Retry in a moment.' } };
  inflight.add(lock);
  const known = (feed.posts || {})[t.id];
  // written against the stored feed as it is now, so two deliveries at once never drop each other's card
  const remember = (messageId) => updateFeed(guildId, feed.id, (f) => {
    const p = { ...(f.posts || {}), [t.id]: { m: messageId, c: channel.id, at: Date.now() } }, k = Object.keys(p);
    if (k.length > MAX_POSTS) for (const x of k.slice(0, k.length - MAX_POSTS)) delete p[x];
    return { ...f, posts: p, count: (f.count || 0) + ((f.posts || {})[t.id] ? 0 : 1), lastError: null, lastAt: Date.now(), lastEvent: event,
      recent: [{ id: t.id, symbol: t.symbol, pnl: t.pnl, event, at: Date.now() }, ...(f.recent || [])].slice(0, 12) };
  });
  try {
    if (known && event !== 'trade.created') {   // an edit or a delete: the card it already posted changes
      const msg = await channel.messages.fetch(known.m).catch(() => null);
      if (msg) { await msg.edit(card(t, feed, { event, deleted: event === 'trade.deleted' })); remember(msg.id); return { status: 200, body: { ok: true, updated: true, messageId: msg.id } }; }
    }
    if (known && event === 'trade.created') return { status: 200, body: { ok: true, duplicate: true, messageId: known.m } };   // a retry: already posted
    if (event === 'trade.deleted') return { status: 200, body: { ok: true, ignored: 'never posted' } };
    const msg = await channel.send(card(t, feed, { event }));
    remember(msg.id);
    return { status: 200, body: { ok: true, messageId: msg.id } };
  } catch (e) {
    const why = /Missing (Permissions|Access)/i.test(e.message) ? `The bot can't post in #${channel.name}. Give it View, Send Messages and Embed Links there.` : String(e.message).slice(0, 200);
    note({ lastError: why });
    return { status: 502, body: { error: 'discord_failed', detail: why } };
  } finally { inflight.delete(lock); }
}
const inflight = new Set();

/* ── the panel's operations ── */
function create(guildId, { name, channelId }) {
  const feeds = feedsOf(guildId);
  if (feeds.length >= MAX_FEEDS) return { error: 'too_many', detail: `Up to ${MAX_FEEDS} journal feeds per server.` };
  const f = { id: newId(), secret: newSecret(), name: str(name, 40) || 'Journal', channelId: String(channelId), enabled: true, createdAt: Date.now(), count: 0, posts: {}, recent: [] };
  saveFeeds(guildId, [...feeds, f]);
  return { ok: true, feedId: f.id, secret: f.secret };
}
function rotate(guildId, feedId) { const secret = newSecret(), f = updateFeed(guildId, feedId, { secret, lastError: null }); return f ? { ok: true, feedId, secret } : { error: 'no_feed' }; }
function remove(guildId, feedId) { const feeds = feedsOf(guildId), next = feeds.filter((f) => f.id !== feedId); if (next.length === feeds.length) return { error: 'no_feed' }; saveFeeds(guildId, next); return { ok: true }; }

module.exports = { FILE, MAX_FEEDS, EVENTS, feedsOf, findFeed, updateFeed, view, verify, sign, readTrade, card, deliver, create, rotate, remove, mask };
